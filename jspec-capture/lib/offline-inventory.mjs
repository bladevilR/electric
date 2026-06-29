export const INVENTORY_COLUMNS = [
  'session_id',
  'source_file',
  'endpoint_path',
  'business_area',
  'captured_at',
  'status_code',
  'record_count_guess',
  'has_sensitive_headers',
  'standardized_table',
  'notes',
];

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'x-ticket',
  'x-token',
]);

const REDACTED_VALUES = new Set(['', '[redacted]', 'undefined', 'null']);

function csvEscape(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function getEndpointPath(url) {
  if (!url) {
    return '';
  }

  try {
    return new URL(url).pathname;
  } catch {
    return String(url).split('?')[0];
  }
}

function unwrapData(bodyJson) {
  if (bodyJson == null) {
    return undefined;
  }

  if (Array.isArray(bodyJson)) {
    return bodyJson;
  }

  if (typeof bodyJson !== 'object') {
    return bodyJson;
  }

  for (const key of ['data', 'rows', 'list', 'records', 'result']) {
    if (Object.hasOwn(bodyJson, key)) {
      return bodyJson[key];
    }
  }

  return bodyJson;
}

function findNestedArrays(value, arrays = []) {
  if (!value || typeof value !== 'object') {
    return arrays;
  }

  if (Array.isArray(value)) {
    arrays.push(value);
    for (const item of value) {
      findNestedArrays(item, arrays);
    }
    return arrays;
  }

  for (const child of Object.values(value)) {
    findNestedArrays(child, arrays);
  }
  return arrays;
}

function guessRecordCount(bodyJson) {
  const data = unwrapData(bodyJson);
  if (Array.isArray(data)) {
    return data.length;
  }

  const nestedArrays = findNestedArrays(data);
  const preferred = nestedArrays.find((items) => items.length === 96);
  if (preferred) {
    return preferred.length;
  }

  const longest = nestedArrays.toSorted((left, right) => right.length - left.length)[0];
  return longest?.length ?? 0;
}

function normalizeHeaderValue(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isSafeSensitiveHeaderValue(value) {
  return REDACTED_VALUES.has(normalizeHeaderValue(value));
}

function scanSensitiveHeaders(headers = {}) {
  const unsafeNames = [];
  for (const [name, value] of Object.entries(headers ?? {})) {
    const lowered = String(name).toLowerCase();
    if (SENSITIVE_HEADER_NAMES.has(lowered) && !isSafeSensitiveHeaderValue(value)) {
      unsafeNames.push(lowered);
    }
  }
  return unsafeNames;
}

function classifyBusinessArea({ target, endpointPath }) {
  const targetId = String(target?.id ?? '').toLowerCase();
  const category = String(target?.category ?? '').toLowerCase();
  const path = String(endpointPath ?? '').toLowerCase();

  if (category.includes('declaration') || targetId.includes('bid') || path.includes('mosenergybid')) {
    return 'bid';
  }
  if (
    category.includes('price') ||
    targetId.includes('clearing') ||
    path.includes('clearing') ||
    path.includes('xrdonlyjiesuan')
  ) {
    return 'clearing';
  }
  if (path.includes('contract') || targetId.includes('contract')) {
    return 'contract';
  }
  if (category.includes('settlement') || path.includes('settle') || path.includes('rptprocessinfo')) {
    return 'settlement';
  }
  if (
    category.includes('load') ||
    category.includes('market_context') ||
    path.includes('load') ||
    path.includes('electricity') ||
    path.includes('glbecoparamvalue')
  ) {
    return 'load';
  }
  if (path.includes('notice') || path.includes('tradenotice')) {
    return 'notice';
  }
  if (path.includes('listed') || path.includes('tradeseq')) {
    return 'listed';
  }

  return 'unknown';
}

function inferStandardizedTable({ businessArea, target }) {
  const targetId = String(target?.id ?? '');
  if (
    [
      'user_bid_96',
      'user_default_bid_96',
      'dayahead_user_clearing',
      'dayahead_public_clearing',
      'realtime_public_clearing',
      'realtime_average_price',
      'actual_load_96',
      'settle_day',
    ].includes(targetId)
  ) {
    return 'standard_96_curve';
  }

  if (businessArea === 'bid' || businessArea === 'clearing') {
    return 'standard_96_curve';
  }
  if (businessArea === 'contract') {
    return 'contract_ledger';
  }
  if (businessArea === 'load') {
    return 'market_environment_curve';
  }
  if (businessArea === 'notice' || businessArea === 'listed') {
    return 'trade_notice';
  }
  if (businessArea === 'settlement') {
    return 'settlement_query_inventory';
  }

  return '';
}

function buildNotes({ target, endpointPath, unsafeHeaders }) {
  const notes = [];
  const path = String(endpointPath ?? '').toLowerCase();
  if (!target?.id) {
    notes.push('unclassified');
  }
  if (unsafeHeaders.length) {
    notes.push(`unsafe sensitive headers: ${unsafeHeaders.join(', ')}`);
  }
  if (path.includes('/login') || path.includes('auth')) {
    notes.push('authentication-related endpoint; keep out of committed raw data');
  }
  return notes.join('; ');
}

export function buildInventoryRows({ sessionId, captures }) {
  return captures.map((capture) => {
    const meta = capture.meta ?? {};
    const request = capture.request ?? {};
    const target = capture.businessTarget ?? null;
    const endpointPath = getEndpointPath(meta.url ?? request.url ?? capture.url);
    const unsafeHeaders = [
      ...scanSensitiveHeaders(meta.headers),
      ...scanSensitiveHeaders(meta.requestHeaders ?? request.headers),
    ];
    const businessArea = classifyBusinessArea({ target, endpointPath });

    return {
      session_id: sessionId,
      source_file: capture.fileName,
      endpoint_path: endpointPath,
      business_area: businessArea,
      captured_at: meta.capturedAt ?? capture.capturedAt ?? '',
      status_code: meta.status ?? capture.bodyJson?.status ?? '',
      record_count_guess: guessRecordCount(capture.bodyJson),
      has_sensitive_headers: unsafeHeaders.length > 0,
      standardized_table: inferStandardizedTable({ businessArea, target }),
      notes: buildNotes({ target, endpointPath, unsafeHeaders }),
    };
  });
}

export function formatInventoryCsv(rows) {
  return [
    INVENTORY_COLUMNS.join(','),
    ...rows.map((row) => INVENTORY_COLUMNS.map((column) => csvEscape(row[column])).join(',')),
  ].join('\n');
}

function countBy(rows, key) {
  return rows.reduce((counts, row) => {
    const value = row[key] || 'unknown';
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function markdownCell(value) {
  return String(value ?? '-').replace(/\|/g, '\\|');
}

export function formatSourceEndpointSummary(rows) {
  const byArea = countBy(rows, 'business_area');
  const byEndpoint = countBy(rows, 'endpoint_path');
  const unsafeCount = rows.filter((row) => row.has_sensitive_headers).length;
  const lines = [
    '# JSPEC Offline Source Endpoint Summary',
    '',
    `Total indexed responses: ${rows.length}`,
    `Responses with unsafe sensitive headers: ${unsafeCount}`,
    '',
    '## Business Areas',
    '',
    '| Business area | Responses |',
    '| --- | ---: |',
  ];

  for (const [area, count] of Object.entries(byArea).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    lines.push(`| ${markdownCell(area)} | ${count} |`);
  }

  lines.push('', '## Endpoints', '', '| Endpoint path | Responses |', '| --- | ---: |');
  for (const [endpoint, count] of Object.entries(byEndpoint).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    lines.push(`| \`${markdownCell(endpoint)}\` | ${count} |`);
  }

  lines.push('');
  return lines.join('\n');
}

function getDateDistribution(datasetSummary) {
  if (Array.isArray(datasetSummary?.rows)) {
    return datasetSummary.rows.reduce((counts, row) => {
      if (row.date) {
        counts[row.date] = (counts[row.date] ?? 0) + 1;
      }
      return counts;
    }, {});
  }

  const dates = Array.isArray(datasetSummary?.dates) ? datasetSummary.dates : [];
  const rowCount = Number(datasetSummary?.rowCount ?? 0);
  if (!dates.length) {
    return {};
  }

  if (rowCount > 0 && rowCount % dates.length === 0) {
    const perDate = rowCount / dates.length;
    return Object.fromEntries(dates.map((date) => [date, perDate]));
  }

  return Object.fromEntries(dates.map((date) => [date, null]));
}

function explainRowCount({ rowCount, dates, sourceRowTotal }) {
  if (dates.length && rowCount === dates.length * 96) {
    return `${rowCount} standard row(s) = ${dates.length} date(s) x 96 quarter-hour points. Source row totals (${sourceRowTotal}) count rows before merge/deduplication by date + timePoint.`;
  }

  return `${rowCount} standard row(s). Source row totals (${sourceRowTotal}) count source-specific rows before standard merge.`;
}

export function buildStandardOutputCheck({ datasetSummary }) {
  const rowCount = Number(datasetSummary?.rowCount ?? datasetSummary?.rows?.length ?? 0);
  const dates = Array.isArray(datasetSummary?.dates)
    ? datasetSummary.dates
    : [...new Set((datasetSummary?.rows ?? []).map((row) => row.date).filter(Boolean))].sort();
  const sources = datasetSummary?.sources ?? {};
  const fieldCompleteness = datasetSummary?.fieldCompleteness ?? {};
  const sourceRowTotal = Object.values(sources).reduce(
    (total, source) => total + Number(source?.rows ?? 0),
    0
  );

  return {
    row_count: rowCount,
    dates,
    date_distribution: getDateDistribution(datasetSummary),
    source_row_total: sourceRowTotal,
    source_counts: Object.fromEntries(
      Object.entries(sources).map(([id, source]) => [id, Number(source?.rows ?? 0)])
    ),
    zero_non_empty_fields: Object.entries(fieldCompleteness)
      .filter(([, count]) => Number(count) === 0)
      .map(([field]) => field)
      .sort(),
    row_count_explanation: explainRowCount({ rowCount, dates, sourceRowTotal }),
    gaps: datasetSummary?.gaps ?? [],
  };
}

export function formatStandardOutputCheck(check) {
  const lines = [
    '# JSPEC Standard 96 Output Check',
    '',
    `Rows: ${check.row_count}`,
    `Dates: ${check.dates.length ? check.dates.join(', ') : '-'}`,
    '',
    '## Row Count Explanation',
    '',
    check.row_count_explanation,
    '',
    '## Date Distribution',
    '',
    '| Date | Standard rows |',
    '| --- | ---: |',
  ];

  for (const [date, count] of Object.entries(check.date_distribution)) {
    lines.push(`| ${date} | ${count ?? 'unknown'} |`);
  }

  lines.push('', '## Source Row Counts', '', '| Source | Rows before merge |', '| --- | ---: |');
  for (const [source, count] of Object.entries(check.source_counts).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    lines.push(`| ${source} | ${count} |`);
  }

  lines.push('', '## Zero Non-Empty Fields', '');
  if (check.zero_non_empty_fields.length) {
    for (const field of check.zero_non_empty_fields) {
      lines.push(`- ${field}`);
    }
  } else {
    lines.push('- None');
  }

  lines.push('', '## Known Gaps', '');
  if (check.gaps.length) {
    for (const gap of check.gaps) {
      lines.push(`- [${gap.severity}] ${gap.id}: ${gap.message}`);
    }
  } else {
    lines.push('- None');
  }

  lines.push('');
  return lines.join('\n');
}
