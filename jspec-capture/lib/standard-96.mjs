export const P0_TARGET_IDS = [
  'user_bid_96',
  'user_default_bid_96',
  'dayahead_user_clearing',
  'dayahead_public_clearing',
  'realtime_public_clearing',
  'realtime_average_price',
  'actual_load_96',
  'settle_day',
];

export const STANDARD_COLUMNS = [
  'date',
  'pointIndex',
  'timePoint',
  'declarationPower',
  'declarationPowerUpper',
  'declarationPowerLower',
  'declarationStartStopState',
  'declarationPercent',
  'defaultDeclarationPower',
  'defaultDeclarationPowerUpper',
  'defaultDeclarationPowerLower',
  'defaultDeclarationStartStopState',
  'defaultDeclarationPercent',
  'dayAheadUserMediumLongPower',
  'dayAheadUserStandardPower',
  'dayAheadUserSumPower',
  'dayAheadUserClearingPower',
  'dayAheadUserPrice',
  'dayAheadUserPriceFinal',
  'dayAheadUserSouthPrice',
  'dayAheadUserNorthPrice',
  'dayAheadPublicClearingPower',
  'dayAheadPublicPrice',
  'dayAheadPublicSouthPrice',
  'dayAheadPublicNorthPrice',
  'dayAheadPublicSouthNodePrice',
  'dayAheadPublicNorthNodePrice',
  'realTimeSouthPrice',
  'realTimeNorthPrice',
  'realTimeSouthNodePrice',
  'realTimeNorthNodePrice',
  'realTimeSouthReleaseType',
  'realTimeNorthReleaseType',
  'realTimeClearingPower',
  'realTimeAvgPrice',
  'realTimePointPrice',
  'realTimeAvgPriceCurrent',
  'realTimePointPriceCurrent',
  'realTimeAvgPriceFinal',
  'realTimePointPriceFinal',
  'actualKwh',
  'settleAmount',
  'sourceTargets',
  'sourceFiles',
];

function pad2(value) {
  return String(value).padStart(2, '0');
}

export function pointIndexToTimeLabel(index) {
  const numeric = Number(index);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 96) {
    throw new RangeError('point index must be in 1..96');
  }

  const minutes = numeric * 15;
  const hours = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${pad2(hours)}:${pad2(minute)}`;
}

export function normalizeNumeric(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const cleaned = String(value).trim().replace(/,/g, '');
  if (!cleaned || cleaned === '-' || cleaned.toLowerCase() === 'null') {
    return null;
  }

  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeTimePoint(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const withoutUnit = String(value).trim().replace(/\(.+\)$/u, '');
  const match = withoutUnit.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 24) {
    return null;
  }
  if (![0, 15, 30, 45].includes(minutes)) {
    return null;
  }

  return `${pad2(hours)}:${pad2(minutes)}`;
}

export function timePointToIndex(value) {
  const timePoint = normalizeTimePoint(value);
  if (!timePoint) {
    return null;
  }

  const [hours, minutes] = timePoint.split(':').map(Number);
  const index = (hours * 60 + minutes) / 15;
  return Number.isInteger(index) && index >= 1 && index <= 96 ? index : null;
}

export function normalizeDate(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const text = String(value).trim();
  const direct = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (direct) {
    return `${direct[1]}-${pad2(direct[2])}-${pad2(direct[3])}`;
  }

  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    return `${compact[1]}-${compact[2]}-${compact[3]}`;
  }

  return null;
}

function getCaptureData(capture) {
  if (capture?.bodyJson && typeof capture.bodyJson === 'object' && 'data' in capture.bodyJson) {
    return capture.bodyJson.data;
  }
  return capture?.bodyJson ?? capture?.body ?? null;
}

function isRelevantStandardEndpoint(capture, targetId) {
  const url = String(capture?.meta?.url ?? capture?.request?.url ?? '').toLowerCase();
  if (!url) {
    return true;
  }

  let pathName = url;
  try {
    pathName = new URL(url).pathname.toLowerCase();
  } catch {
    pathName = url;
  }

  const endpointByTarget = {
    user_bid_96: ['/mosenergybidinfouser/getmosenergybidinfouser'],
    user_default_bid_96: ['/mosenergybidinfouser/getmosenergybidinfouserdefault'],
    dayahead_user_clearing: ['/dd2jyuserclearingresult/querydd2jyrqclearing'],
    dayahead_public_clearing: ['/dayclearingresult/querytablexrdonlyjiesuan'],
    realtime_public_clearing: ['/curclearingresult/querytablexrdonlyjiesuan'],
    realtime_average_price: ['/realtimeclearingrelease/queryrealtimemaravepricepublic'],
    actual_load_96: ['/electricity/querydailyelectricity'],
    settle_day: ['/trandeclare/querydaysettleresult'],
  };

  return (endpointByTarget[targetId] ?? []).some((fragment) => pathName.endsWith(fragment));
}

function requestDate(capture, fallbackKeys = ['dataTime', 'date']) {
  const request = capture?.meta?.requestBodyJson ?? {};
  for (const key of fallbackKeys) {
    const date = normalizeDate(request[key]);
    if (date) {
      return date;
    }
  }
  return null;
}

function rowDate(row, capture, keys = ['dataDate', 'date', 'dataTime', 'day', 'tradeDate']) {
  for (const key of keys) {
    const date = normalizeDate(row?.[key]);
    if (date) {
      return date;
    }
  }
  return requestDate(capture, ['dataTime', 'date', 'startDate', 'monthTime']);
}

function createRow({ date, timePoint }) {
  const pointIndex = timePointToIndex(timePoint);
  return {
    date,
    pointIndex,
    timePoint,
    declarationPower: null,
    declarationPowerUpper: null,
    declarationPowerLower: null,
    declarationStartStopState: null,
    declarationPercent: null,
    defaultDeclarationPower: null,
    defaultDeclarationPowerUpper: null,
    defaultDeclarationPowerLower: null,
    defaultDeclarationStartStopState: null,
    defaultDeclarationPercent: null,
    dayAheadUserMediumLongPower: null,
    dayAheadUserStandardPower: null,
    dayAheadUserSumPower: null,
    dayAheadUserClearingPower: null,
    dayAheadUserPrice: null,
    dayAheadUserPriceFinal: null,
    dayAheadUserSouthPrice: null,
    dayAheadUserNorthPrice: null,
    dayAheadPublicClearingPower: null,
    dayAheadPublicPrice: null,
    dayAheadPublicSouthPrice: null,
    dayAheadPublicNorthPrice: null,
    dayAheadPublicSouthNodePrice: null,
    dayAheadPublicNorthNodePrice: null,
    realTimeSouthPrice: null,
    realTimeNorthPrice: null,
    realTimeSouthNodePrice: null,
    realTimeNorthNodePrice: null,
    realTimeSouthReleaseType: null,
    realTimeNorthReleaseType: null,
    realTimeClearingPower: null,
    realTimeAvgPrice: null,
    realTimePointPrice: null,
    realTimeAvgPriceCurrent: null,
    realTimePointPriceCurrent: null,
    realTimeAvgPriceFinal: null,
    realTimePointPriceFinal: null,
    actualKwh: null,
    settleAmount: null,
    sourceTargets: [],
    sourceFiles: [],
  };
}

function valueOrNull(value) {
  return value === undefined || value === '' ? null : value;
}

function numericFields(row, mapping) {
  return Object.fromEntries(
    Object.entries(mapping).map(([target, source]) => [target, normalizeNumeric(row?.[source])])
  );
}

function declarationRows(capture, targetId) {
  const data = getCaptureData(capture);
  const rows = Array.isArray(data?.mosDeratePendParamList) ? data.mosDeratePendParamList : [];
  const date = requestDate(capture, ['dataTime', 'date']) ?? normalizeDate(data?.dataTime);
  const prefix = targetId === 'user_bid_96' ? 'declaration' : 'defaultDeclaration';

  return rows
    .map((row) => {
      const timePoint = normalizeTimePoint(row.timeSlot ?? row.timePoint);
      if (!date || !timePoint) {
        return null;
      }

      return {
        date,
        timePoint,
        values: {
          [`${prefix}Power`]: normalizeNumeric(row.power),
          [`${prefix}PowerUpper`]: normalizeNumeric(row.powerUpper),
          [`${prefix}PowerLower`]: normalizeNumeric(row.powerLower),
          [`${prefix}StartStopState`]: valueOrNull(row.startStopState),
          [`${prefix}Percent`]: normalizeNumeric(row.percent),
        },
      };
    })
    .filter(Boolean);
}

function arrayRows(capture, fieldMap) {
  const data = getCaptureData(capture);
  if (!Array.isArray(data)) {
    return [];
  }

  const date = requestDate(capture, ['dataTime', 'date']);
  return data
    .map((row) => {
      const timePoint = normalizeTimePoint(row.timePoint ?? row.timeSlot);
      const resolvedDate = date ?? rowDate(row, capture);
      if (!resolvedDate || !timePoint) {
        return null;
      }

      return {
        date: resolvedDate,
        timePoint,
        values: numericFields(row, fieldMap.numeric ?? {}),
        rawValues: Object.fromEntries(
          Object.entries(fieldMap.raw ?? {}).map(([target, source]) => [target, valueOrNull(row[source])])
        ),
      };
    })
    .filter(Boolean)
    .map((row) => ({
      ...row,
      values: { ...row.values, ...row.rawValues },
    }));
}

function actualLoadRows(capture) {
  const data = getCaptureData(capture);
  const heads = Array.isArray(data?.listTableHead) ? data.listTableHead : [];
  const list = Array.isArray(data?.list) ? data.list : [];
  if (!heads.length || !list.length) {
    return [];
  }

  return list.flatMap((wideRow) =>
    heads
      .map((head, index) => {
        const timePoint =
          normalizeTimePoint(head.label) ??
          normalizeTimePoint(wideRow.timePoint) ??
          pointIndexToTimeLabel(index + 1);
        const date = rowDate(wideRow, capture);
        if (!date || !timePoint) {
          return null;
        }

        return {
          date,
          timePoint,
          values: {
            actualKwh: normalizeNumeric(wideRow[head.prop]),
          },
        };
      })
      .filter(Boolean)
  );
}

function settleRows(capture) {
  const data = getCaptureData(capture);
  const list = Array.isArray(data?.list) ? data.list : [];
  return list
    .map((row) => {
      const date = rowDate(row, capture);
      const timePoint = normalizeTimePoint(row.timePoint ?? row.timeSlot);
      if (!date || !timePoint) {
        return null;
      }

      return {
        date,
        timePoint,
        values: {
          settleAmount: normalizeNumeric(
            row.settleAmount ?? row.amount ?? row.totalFee ?? row.fee ?? row.settlementAmount
          ),
        },
      };
    })
    .filter(Boolean);
}

export function extractRowsFromCapture(capture) {
  const targetId = capture?.businessTarget?.id;
  switch (targetId) {
    case 'user_bid_96':
    case 'user_default_bid_96':
      return declarationRows(capture, targetId);
    case 'dayahead_user_clearing':
      return arrayRows(capture, {
        numeric: {
          dayAheadUserMediumLongPower: 'mediumLongPower',
          dayAheadUserStandardPower: 'standardPower',
          dayAheadUserSumPower: 'sumPower',
          dayAheadUserClearingPower: 'clearingPower',
          dayAheadUserPrice: 'unitPrice',
          dayAheadUserPriceFinal: 'userClearingPriceFinal',
          dayAheadUserSouthPrice: 'southPrice',
          dayAheadUserNorthPrice: 'northPrice',
        },
      });
    case 'dayahead_public_clearing':
      return arrayRows(capture, {
        numeric: {
          dayAheadPublicClearingPower: 'clearingPower',
          dayAheadPublicPrice: 'unitPrice',
          dayAheadPublicSouthPrice: 'southPrice',
          dayAheadPublicNorthPrice: 'northPrice',
          dayAheadPublicSouthNodePrice: 'southJdPrice',
          dayAheadPublicNorthNodePrice: 'northJdPrice',
        },
      });
    case 'realtime_public_clearing':
      return arrayRows(capture, {
        numeric: {
          realTimeSouthPrice: 'southPrice',
          realTimeNorthPrice: 'northPrice',
          realTimeSouthNodePrice: 'southJdPrice',
          realTimeNorthNodePrice: 'northJdPrice',
        },
        raw: {
          realTimeSouthReleaseType: 'southFabuType',
          realTimeNorthReleaseType: 'northFabuType',
        },
      });
    case 'realtime_average_price':
      return arrayRows(capture, {
        numeric: {
          realTimeClearingPower: 'clearingPower',
          realTimeAvgPrice: 'avgPrice',
          realTimePointPrice: 'pointPrice',
          realTimeAvgPriceCurrent: 'avgPriceCurrent',
          realTimePointPriceCurrent: 'pointPriceCurrent',
          realTimeAvgPriceFinal: 'avgPriceFinal',
          realTimePointPriceFinal: 'pointPriceFinal',
        },
      });
    case 'actual_load_96':
      return actualLoadRows(capture);
    case 'settle_day':
      return settleRows(capture);
    default:
      return [];
  }
}

function mergeValue(target, key, value) {
  if (value === null || value === undefined || value === '') {
    return;
  }
  target[key] = value;
}

function uniquePush(array, value) {
  if (value && !array.includes(value)) {
    array.push(value);
  }
}

function sortRows(left, right) {
  return (
    String(left.date).localeCompare(String(right.date)) ||
    Number(left.pointIndex ?? 0) - Number(right.pointIndex ?? 0)
  );
}

function addQualityGaps({ sources, rows, captures }) {
  const gaps = [];
  for (const id of P0_TARGET_IDS) {
    if (!sources[id]) {
      gaps.push({
        id: `${id}_missing`,
        severity: 'high',
        message: `P0 source ${id} was not captured.`,
      });
    }
  }

  for (const [id, source] of Object.entries(sources)) {
    if (P0_TARGET_IDS.includes(id) && source.rows === 0) {
      gaps.push({
        id: `${id}_empty`,
        severity: id === 'actual_load_96' || id === 'settle_day' ? 'medium' : 'high',
        message: `P0 source ${id} was captured but returned no standard rows.`,
      });
    }
  }

  const dateCount = new Set(rows.map((row) => row.date)).size;
  if (dateCount > 1) {
    gaps.push({
      id: 'mixed_dates',
      severity: 'medium',
      message: `Captured rows span ${dateCount} dates. This can be valid, but downstream strategy should not compare day-ahead and real-time rows as the same day without checking date.`,
    });
  }

  const fieldCompleteness = {};
  for (const column of STANDARD_COLUMNS) {
    if (['sourceTargets', 'sourceFiles'].includes(column)) {
      continue;
    }
    fieldCompleteness[column] = rows.filter(
      (row) => row[column] !== null && row[column] !== undefined && row[column] !== ''
    ).length;
  }

  const actualLoadRows = fieldCompleteness.actualKwh ?? 0;
  if (sources.actual_load_96 && actualLoadRows === 0) {
    gaps.push({
      id: 'actual_load_values_missing',
      severity: 'medium',
      message: 'Actual-load endpoint was captured, but no kWh values are available in this capture.',
    });
  }

  return {
    captures: captures.length,
    rows: rows.length,
    dates: [...new Set(rows.map((row) => row.date))].sort(),
    fieldCompleteness,
    gaps,
  };
}

export function buildStandardDataset(captures) {
  const byKey = new Map();
  const sources = {};
  const sortedCaptures = [...captures].sort(
    (left, right) => Number(left?.meta?.index ?? 0) - Number(right?.meta?.index ?? 0)
  );

  for (const capture of sortedCaptures) {
    const targetId = capture?.businessTarget?.id;
    if (!targetId) {
      continue;
    }

    const extractedRows = extractRowsFromCapture(capture);
    const relevantEndpoint = isRelevantStandardEndpoint(capture, targetId);
    if (!relevantEndpoint && extractedRows.length === 0) {
      continue;
    }

    sources[targetId] ??= {
      files: [],
      captures: 0,
      rows: 0,
      endpoint: capture?.meta?.url ?? null,
    };
    sources[targetId].captures += 1;
    sources[targetId].rows += extractedRows.length;
    uniquePush(sources[targetId].files, capture.fileName);

    for (const extracted of extractedRows) {
      const key = `${extracted.date}|${extracted.timePoint}`;
      const existing = byKey.get(key) ?? createRow(extracted);
      for (const [field, value] of Object.entries(extracted.values ?? {})) {
        mergeValue(existing, field, value);
      }
      uniquePush(existing.sourceTargets, targetId);
      uniquePush(existing.sourceFiles, capture.fileName);
      byKey.set(key, existing);
    }
  }

  const rows = [...byKey.values()].sort(sortRows);
  return {
    generatedAt: new Date().toISOString(),
    rows,
    sources,
    quality: addQualityGaps({ sources, rows, captures: sortedCaptures }),
  };
}

export function csvEscape(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const text = Array.isArray(value) ? value.join('|') : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function rowsToCsv(rows, columns = STANDARD_COLUMNS) {
  return [
    columns.map(csvEscape).join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
  ].join('\n');
}

export function summarizeForMachine(dataset) {
  return {
    generatedAt: dataset.generatedAt,
    rowCount: dataset.rows.length,
    dates: dataset.quality.dates,
    sources: dataset.sources,
    gaps: dataset.quality.gaps,
    fieldCompleteness: dataset.quality.fieldCompleteness,
  };
}

export function formatQualityMarkdown(dataset) {
  const lines = [
    '# JSPEC Standard 96 Quality Report',
    '',
    `Generated at: ${dataset.generatedAt}`,
    `Rows: ${dataset.rows.length}`,
    `Dates: ${dataset.quality.dates.length ? dataset.quality.dates.join(', ') : '-'}`,
    '',
    '## Sources',
    '',
    '| Source | Captures | Standard rows | Files |',
    '| --- | ---: | ---: | --- |',
  ];

  for (const id of P0_TARGET_IDS) {
    const source = dataset.sources[id];
    lines.push(
      `| ${id} | ${source?.captures ?? 0} | ${source?.rows ?? 0} | ${
        source?.files?.join('<br>') ?? '-'
      } |`
    );
  }

  lines.push('', '## Field Completeness', '', '| Field | Non-empty rows |', '| --- | ---: |');
  for (const column of STANDARD_COLUMNS) {
    if (['sourceTargets', 'sourceFiles'].includes(column)) {
      continue;
    }
    lines.push(`| ${column} | ${dataset.quality.fieldCompleteness[column] ?? 0} |`);
  }

  lines.push('', '## Gaps', '');
  if (!dataset.quality.gaps.length) {
    lines.push('- None');
  } else {
    for (const gap of dataset.quality.gaps) {
      lines.push(`- [${gap.severity}] ${gap.id}: ${gap.message}`);
    }
  }

  return `${lines.join('\n')}\n`;
}
