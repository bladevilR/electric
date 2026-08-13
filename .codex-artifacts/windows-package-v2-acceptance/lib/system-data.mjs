import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const P0_SOURCE_IDS = [
  'user_bid_96',
  'user_default_bid_96',
  'dayahead_user_clearing',
  'dayahead_public_clearing',
  'realtime_public_clearing',
  'realtime_average_price',
  'actual_load_96',
  'settle_day',
];

export const FRONTEND_ROW_FIELDS = [
  'date',
  'pointIndex',
  'timePoint',
  'declarationPower',
  'defaultDeclarationPower',
  'dayAheadPublicPrice',
  'dayAheadUserPrice',
  'realTimeAvgPrice',
  'realTimePointPriceCurrent',
  'actualKwh',
  'settleAmount',
  'sourceTargets',
];

export function compactRow(row) {
  return Object.fromEntries(FRONTEND_ROW_FIELDS.map((field) => [field, row?.[field] ?? null]));
}

export function compactDataset(dataset) {
  return {
    generatedAt: dataset?.generatedAt ?? null,
    quality: dataset?.quality ?? { dates: [], gaps: [], fieldCompleteness: {} },
    sources: dataset?.sources ?? {},
    rows: Array.isArray(dataset?.rows) ? dataset.rows.map(compactRow) : [],
  };
}

export function summarizeDataset(dataset) {
  const compact = compactDataset(dataset);
  const presentSources = P0_SOURCE_IDS.filter((id) => compact.sources[id]);
  const missingSources = P0_SOURCE_IDS.filter((id) => !compact.sources[id]);

  return {
    generatedAt: compact.generatedAt,
    rowCount: compact.rows.length,
    dates: compact.quality.dates ?? [],
    dateCount: compact.quality.dates?.length ?? 0,
    p0SourceCoverage: {
      present: presentSources.length,
      total: P0_SOURCE_IDS.length,
      presentIds: presentSources,
      missingIds: missingSources,
    },
    gapCount: compact.quality.gaps?.length ?? 0,
    gaps: compact.quality.gaps ?? [],
    fieldCompleteness: compact.quality.fieldCompleteness ?? {},
  };
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function readStandardDataset(filePath) {
  return readJson(filePath);
}

export async function writeBrowserDataFile({ sourcePath, outputPath }) {
  const dataset = compactDataset(await readStandardDataset(sourcePath));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `window.TRADING_SYSTEM_DATA = ${JSON.stringify(dataset, null, 2)};\n`,
    'utf8'
  );
  return summarizeDataset(dataset);
}
