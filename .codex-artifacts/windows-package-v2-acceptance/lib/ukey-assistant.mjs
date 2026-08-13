const DEFAULT_JSPEC_URL = 'https://www.jspec.com.cn/';

const SENSITIVE_FIELD_PATTERN =
  /cookie|token|ticket|authorization|password|passwd|secret|credential|cert|private.?key|pin/i;

const NUMERIC_FIELDS = new Set([
  'pointIndex',
  'realTimeAvgPrice',
  'realTimePointPriceCurrent',
  'defaultDeclarationPower',
  'declarationPower',
  'dayAheadPublicPrice',
  'dayAheadUserPrice',
  'actualKwh',
  'settleAmount',
]);

const ALLOWED_ROW_FIELDS = [
  'date',
  'pointIndex',
  'timePoint',
  'realTimeAvgPrice',
  'realTimePointPriceCurrent',
  'defaultDeclarationPower',
  'declarationPower',
  'dayAheadPublicPrice',
  'dayAheadUserPrice',
  'actualKwh',
  'settleAmount',
  'sourceTargets',
];

export const PROHIBITED_ACTIONS = [
  'read_cookie',
  'read_token',
  'read_ticket',
  'export_private_key',
  'store_ukey_pin',
  'auto_submit_trade',
  'bypass_ukey_confirmation',
];

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function cleanString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function hasSensitiveFields(value) {
  if (!value || typeof value !== 'object') {
    return [];
  }
  return Object.keys(value).filter((key) => SENSITIVE_FIELD_PATTERN.test(key));
}

export function buildUkeyAssistantStatus(options = {}) {
  const env = options.env || {};
  const summary = options.summary || {};
  const realtimePointCount = Number(summary.fieldCompleteness?.realTimeAvgPrice || 0);
  const jspecUrl = env.JSPEC_URL || DEFAULT_JSPEC_URL;

  return {
    mode: 'local_integrated_ukey_assistant',
    status: 'ready_for_local_user',
    generatedAt: new Date().toISOString(),
    launch: {
      url: jspecUrl,
      browserMode: 'local_user_browser',
      profileHint: 'Use a dedicated local browser profile for JSPEC and keep the UKey on this machine.',
    },
    capabilities: {
      localOnly: true,
      serverReadsUkey: false,
      serverReadsCredential: false,
      readsVisibleBusinessData: true,
      canImportDownloadedFiles: true,
      canCreateDraftAdvice: true,
      autoSubmitTrade: false,
    },
    realtimeData: {
      required: true,
      status: realtimePointCount > 0 ? 'snapshot_available' : 'waiting_for_visible_page',
      pointCount: realtimePointCount,
      sourcePreference: ['visible_page_snapshot', 'page_export_file', 'formal_api_when_available'],
    },
    workflow: [
      {
        id: 'insert_ukey',
        title: 'Insert UKey locally',
        detail: 'The certificate device remains on the operator computer and is never transferred to the server.',
      },
      {
        id: 'login_with_ukey',
        title: 'Log in to JSPEC in the local browser',
        detail: 'The user completes CA/UKey prompts in the browser. The assistant only observes business data after login.',
      },
      {
        id: 'open_realtime_page',
        title: 'Open the realtime market page',
        detail: 'Keep the realtime price or declaration page visible so the assistant can collect displayed fields.',
      },
      {
        id: 'collect_visible_snapshot',
        title: 'Collect visible business snapshot',
        detail: 'Only visible rows such as time point, realtime price, declaration power, and load are accepted.',
      },
      {
        id: 'review_ai_advice',
        title: 'Review AI advice',
        detail: 'The system generates observation advice and editable drafts; final trading decisions stay manual.',
      },
    ],
    collectionModes: [
      {
        id: 'visible_page_snapshot',
        title: 'Visible page snapshot',
        realtime: true,
        compliance: 'Reads DOM/table text already visible to the authorized user.',
      },
      {
        id: 'page_export_file',
        title: 'Page export file',
        realtime: false,
        compliance: 'Uses platform export buttons and imports downloaded Excel/CSV files.',
      },
      {
        id: 'formal_api_when_available',
        title: 'Formal platform API',
        realtime: true,
        compliance: 'Requires platform-issued integration credentials and documented interface scope.',
      },
    ],
    controls: [
      'Credential material stays in the browser/UKey boundary.',
      'Snapshot ingestion rejects cookie, token, ticket, password, PIN, and certificate fields.',
      'The assistant does not submit trades or bypass CA/UKey confirmation.',
      'Every accepted snapshot can be logged as local audit evidence.',
    ],
    prohibitedActions: PROHIBITED_ACTIONS,
  };
}

export function validateVisibleSnapshot(payload = {}) {
  const errors = [];
  const payloadSensitiveFields = hasSensitiveFields(payload);
  if (payloadSensitiveFields.length) {
    errors.push(`Sensitive top-level fields are not accepted: ${payloadSensitiveFields.join(', ')}`);
  }

  const rawRows = Array.isArray(payload.rows) ? payload.rows : [];
  const rows = [];

  rawRows.forEach((row, index) => {
    const sensitiveFields = hasSensitiveFields(row);
    if (sensitiveFields.length) {
      errors.push(`Row ${index + 1} contains sensitive fields: ${sensitiveFields.join(', ')}`);
      return;
    }

    const cleaned = {};
    for (const field of ALLOWED_ROW_FIELDS) {
      if (!(field in row)) {
        continue;
      }
      if (NUMERIC_FIELDS.has(field)) {
        cleaned[field] = numberOrNull(row[field]);
      } else if (field === 'sourceTargets') {
        cleaned[field] = Array.isArray(row[field])
          ? row[field].map(cleanString).filter(Boolean)
          : ['visible_page_snapshot'];
      } else {
        cleaned[field] = cleanString(row[field]);
      }
    }

    if (!cleaned.date || numberOrNull(cleaned.pointIndex) === null) {
      errors.push(`Row ${index + 1} must include date and pointIndex.`);
      return;
    }
    cleaned.pointIndex = numberOrNull(cleaned.pointIndex);
    cleaned.sourceTargets = cleaned.sourceTargets || ['visible_page_snapshot'];
    rows.push(cleaned);
  });

  return {
    accepted: errors.length === 0 && rows.length > 0,
    generatedAt: new Date().toISOString(),
    source: cleanString(payload.source) || 'visible_page_snapshot',
    rowCount: rows.length,
    rows,
    errors,
    rejectedFieldPattern: SENSITIVE_FIELD_PATTERN.source,
  };
}

export function mergeVisibleSnapshot(dataset = {}, snapshot = {}) {
  if (!snapshot.accepted || !Array.isArray(snapshot.rows) || !snapshot.rows.length) {
    return {
      ...dataset,
      visibleSnapshot: {
        applied: false,
        rowCount: 0,
      },
    };
  }

  const existingRows = Array.isArray(dataset.rows) ? dataset.rows : [];
  const byKey = new Map(existingRows.map((row) => [`${row.date}:${row.pointIndex}`, { ...row }]));
  for (const row of snapshot.rows) {
    const key = `${row.date}:${row.pointIndex}`;
    byKey.set(key, {
      ...(byKey.get(key) || {}),
      ...Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null && value !== '')),
    });
  }

  const rows = [...byKey.values()].sort((left, right) => {
    const dateCompare = String(left.date || '').localeCompare(String(right.date || ''));
    if (dateCompare) {
      return dateCompare;
    }
    return Number(left.pointIndex || 0) - Number(right.pointIndex || 0);
  });

  const quality = dataset.quality || {};
  const fieldCompleteness = { ...(quality.fieldCompleteness || {}) };
  for (const field of NUMERIC_FIELDS) {
    fieldCompleteness[field] = rows.filter((row) => numberOrNull(row[field]) !== null).length;
  }

  return {
    ...dataset,
    rows,
    quality: {
      ...quality,
      dates: quality.dates || [...new Set(rows.map((row) => row.date).filter(Boolean))],
      fieldCompleteness,
    },
    visibleSnapshot: {
      applied: true,
      source: snapshot.source,
      generatedAt: snapshot.generatedAt,
      rowCount: snapshot.rowCount,
    },
  };
}
