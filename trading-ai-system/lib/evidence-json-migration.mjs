import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const VISIBLE_FIELD_DEFINITIONS = Object.freeze({
  realTimeAvgPrice: { unit: '元/MWh', target: 'realtime_average_price' },
  realTimePointPriceCurrent: { unit: '元/MWh', target: 'realtime_point_price' },
  dayAheadPublicPrice: { unit: '元/MWh', target: 'dayahead_public_price' },
  dayAheadUserPrice: { unit: '元/MWh', target: 'dayahead_user_price' },
  dayAheadUserPriceTemporaryYuanPerMwh: { unit: '元/MWh', target: 'dayahead_user_price' },
  dayAheadUserPriceFinalYuanPerMwh: { unit: '元/MWh', target: 'dayahead_user_price' },
  dayAheadUserPriceEffectiveYuanPerMwh: { unit: '元/MWh', target: 'dayahead_user_price' },
  dayAheadUserClearedPowerMw: { unit: 'MW', target: 'dayahead_user_price' },
  dayAheadUserClearingPower: { unit: 'MW', target: 'dayahead_user_price' },
  defaultDeclarationPower: { unit: 'MW', target: 'declaration' },
  declarationPower: { unit: 'MW', target: 'declaration' },
  actualKwh: { unit: 'kWh', target: 'actual_load_96' },
  settleAmount: { unit: '元', target: 'settle_day' },
  temperatureC: { unit: '°C', target: 'weather' },
  temperatureForecastC: { unit: '°C', target: 'weather' },
  actualLoadMw: { unit: 'MW', target: 'actual_load_96' },
  loadForecastMw: { unit: 'MW', target: 'short_system_load_forecast' },
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function readLegacyFile(filePath) {
  try {
    const content = await readFile(filePath);
    return {
      filePath: path.resolve(filePath),
      content,
      sha256: sha256(content),
      value: JSON.parse(content.toString('utf8')),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw new Error(`legacy_json_invalid:${filePath}`);
    throw error;
  }
}

function visibleSourceId(row, definition) {
  const targets = Array.isArray(row.sourceTargets) ? row.sourceTargets.map(String) : [];
  const target = targets.includes(definition.target) ? definition.target : targets[0] || definition.target;
  return `JSPEC:${target}`;
}

function visibleFacts(file) {
  const generatedAt = file.value.generatedAt || new Date(0).toISOString();
  const sourceRevision = `legacy:${file.sha256}`;
  const facts = [];
  for (const row of Array.isArray(file.value.rows) ? file.value.rows : []) {
    const businessDate = row.date || row.businessDate;
    for (const [fieldId, definition] of Object.entries(VISIBLE_FIELD_DEFINITIONS)) {
      if (row[fieldId] === undefined || row[fieldId] === null || row[fieldId] === '') continue;
      const numericValue = Number(row[fieldId]);
      if (!Number.isFinite(numericValue)) continue;
      facts.push({
        sourceId: visibleSourceId(row, definition),
        fieldId,
        businessDate,
        pointIndex: Number(row.pointIndex),
        value: numericValue,
        unit: definition.unit,
        availableAt: generatedAt,
        capturedAt: generatedAt,
        sourceRevision,
      });
    }
  }
  return facts;
}

function pointInTimeFacts(file) {
  return (Array.isArray(file.value.facts) ? file.value.facts : []).map((fact) => ({ ...fact }));
}

function importFile({ store, file, kind }) {
  if (store.hasImportMarker({ sourcePath: file.filePath, sourceSha256: file.sha256 })) {
    return { skipped: true, importedFacts: 0, importedForecastRuns: 0, importedOutcomes: 0 };
  }

  return store.transaction(() => {
    let importedFacts = 0;
    let importedForecastRuns = 0;
    let importedOutcomes = 0;

    if (kind === 'visible_history') {
      importedFacts = store.appendFacts(visibleFacts(file)).inserted;
    } else if (kind === 'point_in_time') {
      importedFacts = store.appendFacts(pointInTimeFacts(file)).inserted;
    } else if (kind === 'forecast_ledger') {
      for (const run of Array.isArray(file.value.runs) ? file.value.runs : []) {
        const existing = store.queryForecastRuns({ forecastRunId: run.forecastRunId })[0];
        if (existing) {
          if (stableJson(existing) !== stableJson({ ...run, executionAllowed: false })) {
            throw new Error(`legacy_forecast_conflict:${run.forecastRunId}`);
          }
          continue;
        }
        store.appendForecastRun(run);
        importedForecastRuns += 1;
      }
    } else if (kind === 'outcome_ledger') {
      importedOutcomes = store.appendOutcomes(Array.isArray(file.value.outcomes) ? file.value.outcomes : []).inserted;
    }

    const summary = { kind, importedFacts, importedForecastRuns, importedOutcomes };
    store.recordImportMarker({
      id: `legacy-import:${sha256(`${file.filePath}\0${file.sha256}`)}`,
      sourcePath: file.filePath,
      sourceSha256: file.sha256,
      summary,
    });
    return { skipped: false, ...summary };
  });
}

export async function migrateLegacyEvidence(options = {}) {
  const store = options.store;
  if (!store || typeof store.transaction !== 'function') throw new Error('evidence_store_required');
  const definitions = [
    ['visibleHistoryPath', 'visible_history'],
    ['pointInTimePath', 'point_in_time'],
    ['forecastLedgerPath', 'forecast_ledger'],
    ['outcomeLedgerPath', 'outcome_ledger'],
  ].filter(([key]) => options[key]);
  const totals = {
    importedFacts: 0,
    importedForecastRuns: 0,
    importedOutcomes: 0,
    skippedFiles: 0,
    missingFiles: 0,
    sourceFiles: 0,
  };

  for (const [key, kind] of definitions) {
    const file = await readLegacyFile(options[key]);
    if (!file) {
      totals.missingFiles += 1;
      continue;
    }
    totals.sourceFiles += 1;
    const result = importFile({ store, file, kind });
    if (result.skipped) totals.skippedFiles += 1;
    totals.importedFacts += result.importedFacts;
    totals.importedForecastRuns += result.importedForecastRuns;
    totals.importedOutcomes += result.importedOutcomes;
  }

  return totals;
}
