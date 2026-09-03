import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createForecastRun } from './forecast-ledger.mjs';

const SENSITIVE_KEY = /cookie|token|ticket|authorization|password|passwd|secret|credential|cert|private.?key|^pin(?:[_-]?code)?$/i;
const OUTCOME_LABELS = new Set(['temporary', 'current', 'final', 'settlement_initial', 'settlement_final', 'settlement_adjusted']);
const RUN_TYPES = new Set(['live_issued', 'point_in_time_replay']);

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

function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex');
}

function rejectSensitive(value, location = 'payload') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) throw new Error(`sensitive_key_rejected:${location}.${key}`);
    rejectSensitive(child, `${location}.${key}`);
  }
}

function requiredString(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field}_required`);
  return normalized;
}

function optionalString(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function assertDate(value, field) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) throw new Error(`${field}_invalid`);
  return String(value);
}

function monthBounds(monthKey) {
  const match = String(monthKey ?? '').match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
  if (!match) throw new Error('month_key_invalid');
  const year = Number(match[1]);
  const month = Number(match[2]);
  return {
    startDate: `${match[1]}-${match[2]}-01`,
    endDate: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
}

function assertIso(value, field) {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${field}_invalid`);
  return String(value);
}

function assertSha256(value, field) {
  if (!/^[a-f0-9]{64}$/i.test(String(value ?? ''))) throw new Error(`${field}_invalid`);
  return String(value).toLowerCase();
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) throw new Error('number_invalid');
  return normalized;
}

function pointIdentity(value = {}) {
  if (value.pointIndex !== undefined && value.pointIndex !== null) {
    const pointIndex = Number(value.pointIndex);
    if (!Number.isInteger(pointIndex) || pointIndex < 1 || pointIndex > 96) throw new Error('point_index_invalid');
    return { pointIndex, dimensionKey: `point:${pointIndex}` };
  }
  if (value.eventKey !== undefined && value.eventKey !== null && value.eventKey !== '') {
    return { pointIndex: null, dimensionKey: `event:${String(value.eventKey)}` };
  }
  if (value.entityKey !== undefined && value.entityKey !== null && value.entityKey !== '') {
    return { pointIndex: null, dimensionKey: `entity:${String(value.entityKey)}` };
  }
  throw new Error('fact_point_or_entity_key_missing');
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  return JSON.parse(value);
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

function whereClause(filters, mapping) {
  const clauses = [];
  const values = [];
  for (const [key, descriptor] of Object.entries(mapping)) {
    const value = filters[key];
    if (value === undefined || value === null || value === '') continue;
    clauses.push(`${descriptor.column} ${descriptor.operator || '='} ?`);
    values.push(descriptor.normalize ? descriptor.normalize(value) : value);
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', values };
}

function initializeSchema(database) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS schema_migrations(
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS import_markers(
      id TEXT PRIMARY KEY,
      source_path TEXT NOT NULL,
      source_sha256 TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      UNIQUE(source_path, source_sha256)
    );

    CREATE TABLE IF NOT EXISTS collection_jobs(
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      earliest_date TEXT,
      latest_date TEXT,
      total_chunks INTEGER NOT NULL DEFAULT 0,
      completed_chunks INTEGER NOT NULL DEFAULT 0,
      failed_chunks INTEGER NOT NULL DEFAULT 0,
      last_error_code TEXT,
      last_error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS collection_chunks(
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES collection_jobs(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      month_key TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      state TEXT NOT NULL,
      cursor_date TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      last_error_code TEXT,
      last_error_message TEXT,
      UNIQUE(job_id, source_id, month_key)
    );

    CREATE TABLE IF NOT EXISTS raw_captures(
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      business_date TEXT,
      page_url TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      accepted INTEGER NOT NULL CHECK(accepted IN (0, 1)),
      structure_fingerprint TEXT,
      content_sha256 TEXT NOT NULL,
      screenshot_path TEXT,
      evidence_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS raw_captures_query_idx
      ON raw_captures(source_id, business_date, captured_at);

    CREATE TABLE IF NOT EXISTS facts(
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      field_id TEXT NOT NULL,
      business_date TEXT NOT NULL,
      point_index INTEGER,
      dimension_key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      unit TEXT,
      available_at TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      source_revision TEXT NOT NULL,
      UNIQUE(source_id, field_id, business_date, dimension_key, source_revision)
    );

    CREATE INDEX IF NOT EXISTS facts_query_idx
      ON facts(field_id, business_date, point_index);

    CREATE TABLE IF NOT EXISTS feature_snapshots(
      id TEXT PRIMARY KEY,
      target_trading_date TEXT NOT NULL,
      cutoff_at TEXT NOT NULL,
      completeness_pct REAL NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS feature_snapshots_query_idx
      ON feature_snapshots(target_trading_date, cutoff_at);

    CREATE TABLE IF NOT EXISTS forecast_runs(
      id TEXT PRIMARY KEY,
      run_type TEXT NOT NULL,
      target_field TEXT NOT NULL,
      target_trading_date TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      cutoff_at TEXT NOT NULL,
      feature_snapshot_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      model_version TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS forecast_runs_query_idx
      ON forecast_runs(run_type, target_field, target_trading_date, generated_at);

    CREATE TABLE IF NOT EXISTS forecast_points(
      run_id TEXT NOT NULL REFERENCES forecast_runs(id) ON DELETE RESTRICT,
      point_index INTEGER NOT NULL,
      point_forecast REAL,
      p10 REAL,
      p50 REAL,
      p90 REAL,
      input_completeness_pct REAL NOT NULL,
      PRIMARY KEY(run_id, point_index)
    );

    CREATE TABLE IF NOT EXISTS outcomes(
      id TEXT PRIMARY KEY,
      target_field TEXT NOT NULL,
      business_date TEXT NOT NULL,
      point_index INTEGER NOT NULL,
      actual_value REAL NOT NULL,
      label_version TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_revision TEXT NOT NULL,
      published_at TEXT NOT NULL,
      backfilled_at TEXT NOT NULL,
      UNIQUE(target_field, business_date, point_index, label_version, source_revision)
    );

    CREATE INDEX IF NOT EXISTS outcomes_query_idx
      ON outcomes(target_field, business_date, point_index, label_version);

    CREATE TABLE IF NOT EXISTS accuracy_metrics(
      id TEXT PRIMARY KEY,
      run_type TEXT NOT NULL,
      model_id TEXT NOT NULL DEFAULT '',
      target_field TEXT NOT NULL,
      from_date TEXT NOT NULL DEFAULT '',
      to_date TEXT NOT NULL DEFAULT '',
      actual_label_version TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      computed_at TEXT NOT NULL,
      UNIQUE(run_type, model_id, target_field, from_date, to_date, actual_label_version)
    );
  `);
}

function jobFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    mode: row.mode,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    earliestDate: row.earliest_date,
    latestDate: row.latest_date,
    totalChunks: Number(row.total_chunks),
    completedChunks: Number(row.completed_chunks),
    failedChunks: Number(row.failed_chunks),
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
  };
}

function chunkFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    sourceId: row.source_id,
    monthKey: row.month_key,
    startDate: row.start_date,
    endDate: row.end_date,
    state: row.state,
    cursorDate: row.cursor_date,
    attemptCount: Number(row.attempt_count),
    nextAttemptAt: row.next_attempt_at,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
  };
}

export function openTradingEvidenceStore(options = {}) {
  const filePath = requiredString(options.filePath, 'file_path');
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString();
  if (filePath !== ':memory:') mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  const database = new DatabaseSync(filePath);
  initializeSchema(database);
  database.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, ?)').run(clock());
  let transactionDepth = 0;

  function transaction(callback) {
    if (typeof callback !== 'function') throw new Error('transaction_callback_required');
    if (transactionDepth > 0) return callback();
    database.exec('BEGIN IMMEDIATE');
    transactionDepth += 1;
    try {
      const result = callback();
      if (result && typeof result.then === 'function') throw new Error('async_transaction_not_supported');
      database.exec('COMMIT');
      return result;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    } finally {
      transactionDepth -= 1;
    }
  }

  function createCollectionJob(input = {}) {
    rejectSensitive(input, 'collection_job');
    const now = clock();
    const job = {
      id: input.id || randomUUID(),
      mode: requiredString(input.mode, 'collection_job_mode'),
      state: requiredString(input.state || 'pending', 'collection_job_state'),
      createdAt: input.createdAt ? assertIso(input.createdAt, 'created_at') : now,
      updatedAt: input.updatedAt ? assertIso(input.updatedAt, 'updated_at') : now,
      earliestDate: input.earliestDate ? assertDate(input.earliestDate, 'earliest_date') : null,
      latestDate: input.latestDate ? assertDate(input.latestDate, 'latest_date') : null,
      totalChunks: Number(input.totalChunks || 0),
      completedChunks: Number(input.completedChunks || 0),
      failedChunks: Number(input.failedChunks || 0),
      lastErrorCode: optionalString(input.lastErrorCode),
      lastErrorMessage: optionalString(input.lastErrorMessage),
    };
    database.prepare(`INSERT INTO collection_jobs(
      id, mode, state, created_at, updated_at, earliest_date, latest_date,
      total_chunks, completed_chunks, failed_chunks, last_error_code, last_error_message
    ) VALUES(${placeholders(12)})`).run(
      job.id, job.mode, job.state, job.createdAt, job.updatedAt, job.earliestDate, job.latestDate,
      job.totalChunks, job.completedChunks, job.failedChunks, job.lastErrorCode, job.lastErrorMessage
    );
    return job;
  }

  function getCollectionJob(id) {
    return jobFromRow(database.prepare('SELECT * FROM collection_jobs WHERE id = ?').get(requiredString(id, 'collection_job_id')));
  }

  function listCollectionJobs(filters = {}) {
    const where = whereClause(filters, { state: { column: 'state' }, mode: { column: 'mode' } });
    return database.prepare(`SELECT * FROM collection_jobs${where.sql} ORDER BY created_at DESC, id`).all(...where.values).map(jobFromRow);
  }

  function updateCollectionJob(id, changes = {}) {
    const jobId = requiredString(id, 'collection_job_id');
    rejectSensitive(changes, 'collection_job_update');
    if (!getCollectionJob(jobId)) throw new Error('collection_job_not_found');
    const definitions = {
      state: ['state', (value) => requiredString(value, 'collection_job_state')],
      earliestDate: ['earliest_date', (value) => value ? assertDate(value, 'earliest_date') : null],
      latestDate: ['latest_date', (value) => value ? assertDate(value, 'latest_date') : null],
      totalChunks: ['total_chunks', Number],
      completedChunks: ['completed_chunks', Number],
      failedChunks: ['failed_chunks', Number],
      lastErrorCode: ['last_error_code', optionalString],
      lastErrorMessage: ['last_error_message', optionalString],
    };
    const assignments = [];
    const values = [];
    for (const [key, [column, normalize]] of Object.entries(definitions)) {
      if (!Object.hasOwn(changes, key)) continue;
      assignments.push(`${column}=?`);
      values.push(normalize(changes[key]));
    }
    assignments.push('updated_at=?');
    values.push(changes.updatedAt ? assertIso(changes.updatedAt, 'updated_at') : clock());
    database.prepare(`UPDATE collection_jobs SET ${assignments.join(', ')} WHERE id=?`).run(...values, jobId);
    return getCollectionJob(jobId);
  }

  function upsertCollectionChunk(input = {}) {
    rejectSensitive(input, 'collection_chunk');
    const monthKey = requiredString(input.monthKey, 'month_key');
    const defaults = monthBounds(monthKey);
    const chunk = {
      id: requiredString(input.id, 'collection_chunk_id'),
      jobId: requiredString(input.jobId, 'collection_job_id'),
      sourceId: requiredString(input.sourceId, 'source_id'),
      monthKey,
      startDate: assertDate(input.startDate || input.cursorDate || defaults.startDate, 'start_date'),
      endDate: assertDate(input.endDate || defaults.endDate, 'end_date'),
      state: requiredString(input.state, 'collection_chunk_state'),
      cursorDate: input.cursorDate ? assertDate(input.cursorDate, 'cursor_date') : null,
      attemptCount: Number(input.attemptCount || 0),
      nextAttemptAt: input.nextAttemptAt ? assertIso(input.nextAttemptAt, 'next_attempt_at') : null,
      lastErrorCode: optionalString(input.lastErrorCode),
      lastErrorMessage: optionalString(input.lastErrorMessage),
    };
    database.prepare(`INSERT INTO collection_chunks(
      id, job_id, source_id, month_key, start_date, end_date, state, cursor_date, attempt_count,
      next_attempt_at, last_error_code, last_error_message
    ) VALUES(${placeholders(12)})
    ON CONFLICT(id) DO UPDATE SET
      start_date=excluded.start_date, end_date=excluded.end_date, state=excluded.state,
      cursor_date=excluded.cursor_date, attempt_count=excluded.attempt_count,
      next_attempt_at=excluded.next_attempt_at, last_error_code=excluded.last_error_code,
      last_error_message=excluded.last_error_message`).run(
      chunk.id, chunk.jobId, chunk.sourceId, chunk.monthKey, chunk.startDate, chunk.endDate,
      chunk.state, chunk.cursorDate,
      chunk.attemptCount, chunk.nextAttemptAt, chunk.lastErrorCode, chunk.lastErrorMessage
    );
    return chunk;
  }

  function listCollectionChunks(jobId) {
    return database.prepare('SELECT * FROM collection_chunks WHERE job_id = ? ORDER BY month_key, source_id, id')
      .all(requiredString(jobId, 'collection_job_id')).map(chunkFromRow);
  }

  function appendCapture(input = {}) {
    rejectSensitive(input, 'capture');
    const capture = {
      id: input.id || randomUUID(),
      sourceId: requiredString(input.sourceId, 'source_id'),
      businessDate: input.businessDate ? assertDate(input.businessDate, 'business_date') : null,
      pageUrl: requiredString(input.pageUrl, 'page_url'),
      capturedAt: assertIso(input.capturedAt || clock(), 'captured_at'),
      rowCount: Number(input.rowCount || 0),
      accepted: Boolean(input.accepted),
      structureFingerprint: optionalString(input.structureFingerprint),
      contentSha256: assertSha256(input.contentSha256, 'content_sha256'),
      screenshotPath: optionalString(input.screenshotPath),
      evidence: input.evidence || {},
    };
    database.prepare(`INSERT INTO raw_captures(
      id, source_id, business_date, page_url, captured_at, row_count, accepted,
      structure_fingerprint, content_sha256, screenshot_path, evidence_json
    ) VALUES(${placeholders(11)})`).run(
      capture.id, capture.sourceId, capture.businessDate, capture.pageUrl, capture.capturedAt,
      capture.rowCount, capture.accepted ? 1 : 0, capture.structureFingerprint,
      capture.contentSha256, capture.screenshotPath, stableJson(capture.evidence)
    );
    return capture;
  }

  function queryCaptures(filters = {}) {
    const where = whereClause(filters, {
      sourceId: { column: 'source_id' },
      businessDate: { column: 'business_date', normalize: (value) => assertDate(value, 'business_date') },
      accepted: { column: 'accepted', normalize: (value) => value ? 1 : 0 },
    });
    const limit = Math.min(Math.max(Number(filters.limit || 1000), 1), 10000);
    return database.prepare(`SELECT * FROM raw_captures${where.sql} ORDER BY captured_at, id LIMIT ?`)
      .all(...where.values, limit).map((row) => ({
        id: row.id,
        sourceId: row.source_id,
        businessDate: row.business_date,
        pageUrl: row.page_url,
        capturedAt: row.captured_at,
        rowCount: Number(row.row_count),
        accepted: Boolean(row.accepted),
        structureFingerprint: row.structure_fingerprint,
        contentSha256: row.content_sha256,
        screenshotPath: row.screenshot_path,
        evidence: parseJson(row.evidence_json, {}),
      }));
  }

  function normalizeFact(fact = {}) {
    rejectSensitive(fact, 'fact');
    const identity = pointIdentity(fact);
    const normalized = {
      sourceId: requiredString(fact.sourceId, 'source_id'),
      fieldId: requiredString(fact.fieldId, 'field_id'),
      businessDate: assertDate(fact.businessDate, 'business_date'),
      ...identity,
      value: fact.value,
      unit: optionalString(fact.unit),
      availableAt: assertIso(fact.availableAt, 'available_at'),
      capturedAt: assertIso(fact.capturedAt, 'captured_at'),
      sourceRevision: requiredString(fact.sourceRevision, 'source_revision'),
    };
    if (normalized.value === undefined) throw new Error('fact_value_required');
    const id = fact.factId || digest(normalized);
    return { ...normalized, id };
  }

  function appendFacts(facts = []) {
    if (!Array.isArray(facts)) throw new Error('facts_array_required');
    const select = database.prepare(`SELECT id FROM facts
      WHERE source_id=? AND field_id=? AND business_date=? AND dimension_key=? AND source_revision=?`);
    const insert = database.prepare(`INSERT INTO facts(
      id, source_id, field_id, business_date, point_index, dimension_key, value_json,
      unit, available_at, captured_at, source_revision
    ) VALUES(${placeholders(11)})`);
    let inserted = 0;
    let skipped = 0;
    transaction(() => {
      for (const fact of facts) {
        const normalized = normalizeFact(fact);
        const existing = select.get(normalized.sourceId, normalized.fieldId, normalized.businessDate, normalized.dimensionKey, normalized.sourceRevision);
        if (existing) {
          if (existing.id !== normalized.id) throw new Error('fact_revision_conflict');
          skipped += 1;
          continue;
        }
        insert.run(
          normalized.id, normalized.sourceId, normalized.fieldId, normalized.businessDate,
          normalized.pointIndex, normalized.dimensionKey, stableJson(normalized.value), normalized.unit,
          normalized.availableAt, normalized.capturedAt, normalized.sourceRevision
        );
        inserted += 1;
      }
    });
    return { inserted, skipped };
  }

  function queryFacts(filters = {}) {
    const where = whereClause(filters, {
      sourceId: { column: 'source_id' },
      fieldId: { column: 'field_id' },
      from: { column: 'business_date', operator: '>=', normalize: (value) => assertDate(value, 'from_date') },
      to: { column: 'business_date', operator: '<=', normalize: (value) => assertDate(value, 'to_date') },
      businessDate: { column: 'business_date', normalize: (value) => assertDate(value, 'business_date') },
      pointIndex: { column: 'point_index', normalize: Number },
      asOf: { column: 'available_at', operator: '<=', normalize: (value) => assertIso(value, 'as_of') },
    });
    const limit = Math.min(Math.max(Number(filters.limit || 10000), 1), 100000);
    const offset = Math.max(Number(filters.offset || 0), 0);
    return database.prepare(`SELECT * FROM facts${where.sql}
      ORDER BY business_date, point_index, available_at, captured_at, source_revision LIMIT ? OFFSET ?`)
      .all(...where.values, limit, offset).map((row) => ({
        factId: row.id,
        sourceId: row.source_id,
        fieldId: row.field_id,
        businessDate: row.business_date,
        ...(row.point_index === null ? {} : { pointIndex: Number(row.point_index) }),
        value: parseJson(row.value_json),
        unit: row.unit,
        availableAt: row.available_at,
        capturedAt: row.captured_at,
        sourceRevision: row.source_revision,
      }));
  }

  function getCoverage(filters = {}) {
    const where = whereClause(filters, {
      sourceId: { column: 'source_id' },
      fieldId: { column: 'field_id' },
      from: { column: 'business_date', operator: '>=', normalize: (value) => assertDate(value, 'from_date') },
      to: { column: 'business_date', operator: '<=', normalize: (value) => assertDate(value, 'to_date') },
    });
    const rows = database.prepare(`SELECT business_date, COUNT(DISTINCT dimension_key) AS point_count
      FROM facts${where.sql} GROUP BY business_date ORDER BY business_date`).all(...where.values);
    return {
      dateCount: rows.length,
      earliestDate: rows[0]?.business_date || null,
      latestDate: rows.at(-1)?.business_date || null,
      pointsByDate: Object.fromEntries(rows.map((row) => [row.business_date, Number(row.point_count)])),
    };
  }

  function appendFeatureSnapshot(input = {}) {
    rejectSensitive(input, 'feature_snapshot');
    const snapshot = {
      id: requiredString(input.id, 'feature_snapshot_id'),
      targetTradingDate: assertDate(input.targetTradingDate, 'target_trading_date'),
      cutoffAt: assertIso(input.cutoffAt, 'cutoff_at'),
      completenessPct: Number(input.completenessPct),
      payload: input.payload || {},
      createdAt: assertIso(input.createdAt || clock(), 'created_at'),
    };
    if (!Number.isFinite(snapshot.completenessPct) || snapshot.completenessPct < 0 || snapshot.completenessPct > 100) {
      throw new Error('completeness_pct_invalid');
    }
    database.prepare(`INSERT INTO feature_snapshots(
      id, target_trading_date, cutoff_at, completeness_pct, payload_json, created_at
    ) VALUES(${placeholders(6)})`).run(
      snapshot.id, snapshot.targetTradingDate, snapshot.cutoffAt, snapshot.completenessPct,
      stableJson(snapshot.payload), snapshot.createdAt
    );
    return snapshot;
  }

  function queryFeatureSnapshots(filters = {}) {
    const where = whereClause(filters, {
      id: { column: 'id' },
      targetTradingDate: { column: 'target_trading_date', normalize: (value) => assertDate(value, 'target_trading_date') },
    });
    return database.prepare(`SELECT * FROM feature_snapshots${where.sql} ORDER BY cutoff_at, id`).all(...where.values).map((row) => ({
      id: row.id,
      targetTradingDate: row.target_trading_date,
      cutoffAt: row.cutoff_at,
      completenessPct: Number(row.completeness_pct),
      payload: parseJson(row.payload_json, {}),
      createdAt: row.created_at,
    }));
  }

  function appendForecastRun(input = {}) {
    const run = createForecastRun(input);
    if (database.prepare('SELECT 1 FROM forecast_runs WHERE id = ?').get(run.forecastRunId)) {
      throw new Error('forecast_run_already_exists');
    }
    transaction(() => {
      const metadata = Object.fromEntries(Object.entries(run).filter(([key]) => !['rows'].includes(key)));
      database.prepare(`INSERT INTO forecast_runs(
        id, run_type, target_field, target_trading_date, generated_at, cutoff_at,
        feature_snapshot_id, model_id, model_version, metadata_json
      ) VALUES(${placeholders(10)})`).run(
        run.forecastRunId, run.forecastRunType, run.targetField, run.targetTradingDate,
        run.forecastGeneratedAt, run.decisionCutoffAt, run.featureSnapshotId,
        run.modelId, run.modelVersion, stableJson(metadata)
      );
      const insertPoint = database.prepare(`INSERT INTO forecast_points(
        run_id, point_index, point_forecast, p10, p50, p90, input_completeness_pct
      ) VALUES(${placeholders(7)})`);
      for (const row of run.rows) {
        insertPoint.run(
          run.forecastRunId, row.pointIndex, numberOrNull(row.pointForecast), numberOrNull(row.p10),
          numberOrNull(row.p50), numberOrNull(row.p90), Number(row.inputCompletenessPct)
        );
      }
    });
    return run;
  }

  function queryForecastRuns(filters = {}) {
    const where = whereClause(filters, {
      forecastRunId: { column: 'id' },
      forecastRunType: { column: 'run_type', normalize: (value) => {
        if (!RUN_TYPES.has(value)) throw new Error('forecast_run_type_invalid');
        return value;
      } },
      targetField: { column: 'target_field' },
      targetTradingDate: { column: 'target_trading_date', normalize: (value) => assertDate(value, 'target_trading_date') },
      from: { column: 'target_trading_date', operator: '>=', normalize: (value) => assertDate(value, 'from_date') },
      to: { column: 'target_trading_date', operator: '<=', normalize: (value) => assertDate(value, 'to_date') },
    });
    const rows = database.prepare(`SELECT * FROM forecast_runs${where.sql} ORDER BY generated_at, target_trading_date, id`).all(...where.values);
    const pointStatement = database.prepare('SELECT * FROM forecast_points WHERE run_id = ? ORDER BY point_index');
    return rows.map((row) => ({
      ...parseJson(row.metadata_json, {}),
      rows: pointStatement.all(row.id).map((point) => ({
        pointIndex: Number(point.point_index),
        pointForecast: point.point_forecast,
        p10: point.p10,
        p50: point.p50,
        p90: point.p90,
        inputCompletenessPct: Number(point.input_completeness_pct),
      })),
    }));
  }

  function normalizeOutcome(input = {}) {
    rejectSensitive(input, 'outcome');
    const label = requiredString(input.actualLabelVersion, 'actual_label_version');
    if (!OUTCOME_LABELS.has(label)) throw new Error('outcome_label_invalid');
    const pointIndex = pointIdentity(input).pointIndex;
    if (pointIndex === null) throw new Error('point_index_invalid');
    const normalized = {
      targetField: requiredString(input.targetField, 'target_field'),
      businessDate: assertDate(input.businessDate, 'business_date'),
      pointIndex,
      actualValue: Number(input.actualValue),
      actualLabelVersion: label,
      sourceId: requiredString(input.sourceId, 'source_id'),
      sourceRevision: requiredString(input.sourceRevision, 'source_revision'),
      publishedAt: assertIso(input.publishedAt, 'published_at'),
      actualBackfilledAt: assertIso(input.actualBackfilledAt, 'actual_backfilled_at'),
    };
    if (!Number.isFinite(normalized.actualValue)) throw new Error('actual_value_invalid');
    return { ...normalized, id: input.id || digest(normalized) };
  }

  function appendOutcomes(outcomes = []) {
    if (!Array.isArray(outcomes)) throw new Error('outcomes_array_required');
    const select = database.prepare(`SELECT id FROM outcomes WHERE
      target_field=? AND business_date=? AND point_index=? AND label_version=? AND source_revision=?`);
    const insert = database.prepare(`INSERT INTO outcomes(
      id, target_field, business_date, point_index, actual_value, label_version,
      source_id, source_revision, published_at, backfilled_at
    ) VALUES(${placeholders(10)})`);
    let inserted = 0;
    let skipped = 0;
    transaction(() => {
      for (const input of outcomes) {
        const outcome = normalizeOutcome(input);
        const existing = select.get(
          outcome.targetField, outcome.businessDate, outcome.pointIndex,
          outcome.actualLabelVersion, outcome.sourceRevision
        );
        if (existing) {
          if (existing.id !== outcome.id) throw new Error('outcome_revision_conflict');
          skipped += 1;
          continue;
        }
        insert.run(
          outcome.id, outcome.targetField, outcome.businessDate, outcome.pointIndex,
          outcome.actualValue, outcome.actualLabelVersion, outcome.sourceId,
          outcome.sourceRevision, outcome.publishedAt, outcome.actualBackfilledAt
        );
        inserted += 1;
      }
    });
    return { inserted, skipped };
  }

  function queryOutcomes(filters = {}) {
    const where = whereClause(filters, {
      targetField: { column: 'target_field' },
      businessDate: { column: 'business_date', normalize: (value) => assertDate(value, 'business_date') },
      from: { column: 'business_date', operator: '>=', normalize: (value) => assertDate(value, 'from_date') },
      to: { column: 'business_date', operator: '<=', normalize: (value) => assertDate(value, 'to_date') },
      pointIndex: { column: 'point_index', normalize: Number },
      actualLabelVersion: { column: 'label_version' },
    });
    return database.prepare(`SELECT * FROM outcomes${where.sql} ORDER BY business_date, point_index, published_at, source_revision`)
      .all(...where.values).map((row) => ({
        id: row.id,
        targetField: row.target_field,
        businessDate: row.business_date,
        pointIndex: Number(row.point_index),
        actualValue: Number(row.actual_value),
        actualLabelVersion: row.label_version,
        sourceId: row.source_id,
        sourceRevision: row.source_revision,
        publishedAt: row.published_at,
        actualBackfilledAt: row.backfilled_at,
      }));
  }

  function upsertAccuracyMetric(input = {}) {
    rejectSensitive(input, 'accuracy_metric');
    const metric = {
      id: requiredString(input.id, 'accuracy_metric_id'),
      runType: requiredString(input.runType, 'run_type'),
      modelId: optionalString(input.modelId) || '',
      targetField: requiredString(input.targetField, 'target_field'),
      fromDate: input.fromDate ? assertDate(input.fromDate, 'from_date') : '',
      toDate: input.toDate ? assertDate(input.toDate, 'to_date') : '',
      actualLabelVersion: requiredString(input.actualLabelVersion, 'actual_label_version'),
      metrics: input.metrics || {},
      computedAt: assertIso(input.computedAt || clock(), 'computed_at'),
    };
    database.prepare(`INSERT INTO accuracy_metrics(
      id, run_type, model_id, target_field, from_date, to_date,
      actual_label_version, metrics_json, computed_at
    ) VALUES(${placeholders(9)})
    ON CONFLICT(run_type, model_id, target_field, from_date, to_date, actual_label_version)
    DO UPDATE SET id=excluded.id, metrics_json=excluded.metrics_json, computed_at=excluded.computed_at`).run(
      metric.id, metric.runType, metric.modelId, metric.targetField, metric.fromDate,
      metric.toDate, metric.actualLabelVersion, stableJson(metric.metrics), metric.computedAt
    );
    return metric;
  }

  function queryAccuracyMetrics(filters = {}) {
    const where = whereClause(filters, {
      runType: { column: 'run_type' },
      modelId: { column: 'model_id' },
      targetField: { column: 'target_field' },
      actualLabelVersion: { column: 'actual_label_version' },
      fromDate: { column: 'from_date', normalize: (value) => assertDate(value, 'from_date') },
      toDate: { column: 'to_date', normalize: (value) => assertDate(value, 'to_date') },
    });
    return database.prepare(`SELECT * FROM accuracy_metrics${where.sql} ORDER BY computed_at, id`).all(...where.values).map((row) => ({
      id: row.id,
      runType: row.run_type,
      modelId: row.model_id || null,
      targetField: row.target_field,
      fromDate: row.from_date || null,
      toDate: row.to_date || null,
      actualLabelVersion: row.actual_label_version,
      metrics: parseJson(row.metrics_json, {}),
      computedAt: row.computed_at,
    }));
  }

  function hasImportMarker(input = {}) {
    const sourcePath = requiredString(input.sourcePath, 'source_path');
    const sourceSha256 = assertSha256(input.sourceSha256, 'source_sha256');
    return Boolean(database.prepare('SELECT 1 FROM import_markers WHERE source_path=? AND source_sha256=?').get(sourcePath, sourceSha256));
  }

  function recordImportMarker(input = {}) {
    rejectSensitive(input, 'import_marker');
    const marker = {
      id: requiredString(input.id, 'import_marker_id'),
      sourcePath: requiredString(input.sourcePath, 'source_path'),
      sourceSha256: assertSha256(input.sourceSha256, 'source_sha256'),
      importedAt: assertIso(input.importedAt || clock(), 'imported_at'),
      summary: input.summary || {},
    };
    database.prepare(`INSERT INTO import_markers(
      id, source_path, source_sha256, imported_at, summary_json
    ) VALUES(${placeholders(5)})`).run(
      marker.id, marker.sourcePath, marker.sourceSha256, marker.importedAt, stableJson(marker.summary)
    );
    return marker;
  }

  return {
    close: () => database.close(),
    transaction,
    createCollectionJob,
    getCollectionJob,
    listCollectionJobs,
    updateCollectionJob,
    upsertCollectionChunk,
    listCollectionChunks,
    appendCapture,
    queryCaptures,
    appendFacts,
    queryFacts,
    getCoverage,
    appendFeatureSnapshot,
    queryFeatureSnapshots,
    appendForecastRun,
    queryForecastRuns,
    appendOutcomes,
    queryOutcomes,
    upsertAccuracyMetric,
    queryAccuracyMetrics,
    hasImportMarker,
    recordImportMarker,
  };
}
