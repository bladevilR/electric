import test from 'node:test';
import assert from 'node:assert/strict';

import { buildProductionReadiness } from '../lib/production-readiness.mjs';

const summary = {
  rowCount: 192,
  p0SourceCoverage: { present: 8, total: 8 },
  gapCount: 2,
};

const closure = {
  completion: { total: 8, accounted: 8, closed: 3, sourceEmpty: 2, registered: 3, percent: 100 },
  items: [
    { id: 'trade_ledger', name: '交易台账', status: 'closed' },
    { id: 'settlement_checks', name: '现货核对单', status: 'closed' },
    { id: 'actual_load_96', name: '实际负荷 96 点', status: 'source_empty' },
    { id: 'settle_day', name: '日结算明细', status: 'source_empty' },
    { id: 'forecast_load_96', name: '预测负荷 96 点', status: 'registered' },
  ],
};

test('buildProductionReadiness exposes a decision-support state without auto-submit controls', () => {
  const readiness = buildProductionReadiness({
    summary,
    integrationClosure: closure,
    selectedDateSummary: {
      date: '2026-07-27',
      rowCount: 96,
      marketPricePointCount: 96,
      actualLoadPointCount: 0,
      settlementPointCount: 0,
    },
    businessInputSummary: {
      readyForDraftPrefill: true,
    },
    env: {},
    paths: {
      standardPath: 'E:/electric/jspec-capture/output/session/standard-96.json',
      integrationSummaryPath: 'E:/electric/trading-ai-system/data/integration-summary.json',
      auditLogPath: 'E:/electric/trading-ai-system/data/audit-log.ndjson',
    },
  });

  assert.equal(readiness.status, 'decision_support_ready');
  assert.equal(readiness.capabilities.decisionSupport, true);
  assert.equal(readiness.capabilities.proposalDraft, true);
  assert.equal(readiness.capabilities.verifiedSavings, false);
  assert.equal(readiness.capabilities.autoSubmit, false);
  assert.equal(readiness.blockers.some((item) => item.id === 'ca_ukey'), false);
  assert.ok(readiness.warnings.some((item) => item.id === 'source_empty_data'));
  assert.ok(readiness.controls.some((item) => item.id === 'human_decision_policy' && item.status === 'ready'));
  assert.ok(readiness.controls.every((item) => item.status !== 'pending'));
});

test('buildProductionReadiness blocks proposal drafts when today or execution constraints are missing', () => {
  const readiness = buildProductionReadiness({
    summary,
    integrationClosure: closure,
    selectedDateSummary: {
      date: '2026-07-27',
      rowCount: 0,
      marketPricePointCount: 0,
      actualLoadPointCount: 0,
      settlementPointCount: 0,
    },
    businessInputSummary: {
      readyForDraftPrefill: false,
    },
    env: {},
  });

  assert.equal(readiness.status, 'data_blocked');
  assert.equal(readiness.capabilities.decisionSupport, false);
  assert.equal(readiness.capabilities.proposalDraft, false);
  assert.equal(readiness.capabilities.verifiedSavings, false);
  assert.ok(readiness.blockers.some((item) => item.id === 'current_day_data'));
  assert.ok(readiness.blockers.some((item) => item.id === 'execution_business_inputs'));
});

test('buildProductionReadiness does not leak secret environment values', () => {
  const readiness = buildProductionReadiness({
    summary,
    integrationClosure: { completion: { total: 1, accounted: 1 }, items: [{ id: 'x', status: 'closed' }] },
    env: {
      JSPEC_BASE_URL: 'https://jspec.example',
      JSPEC_USERNAME: 'operator',
      JSPEC_PASSWORD: 'super-secret',
      CA_UKEY_PROVIDER: 'ukey-vendor',
      CA_UKEY_CERT_ID: 'cert-001',
      TRADING_PLATFORM_URL: 'https://trade.example',
      TRADING_OPERATOR_ID: 'operator-a',
      TRADING_APPROVER_ID: 'approver-b',
      EXECUTION_MODE: 'human_decision_only',
    },
  });

  assert.equal(JSON.stringify(readiness).includes('super-secret'), false);
  assert.equal(readiness.controls.find((item) => item.id === 'jspec_auto_capture').status, 'ready');
  assert.equal(readiness.controls.find((item) => item.id === 'ca_ukey').status, 'ready');
  assert.equal(readiness.capabilities.autoSubmit, false);
});

test('buildProductionReadiness exposes point-in-time governance gates', () => {
  const readiness = buildProductionReadiness({
    governance: {
      fieldCatalogLoaded: true,
      sourceRegistryLoaded: true,
      p0SemanticsConfirmed: false,
      pointInTimeStoreWritable: true,
      featureSnapshotLeakageGuardEnabled: true,
    },
  });
  const statuses = Object.fromEntries(readiness.controls.map((item) => [item.id, item.status]));
  assert.equal(statuses.field_catalog_loaded, 'ready');
  assert.equal(statuses.source_registry_loaded, 'ready');
  assert.equal(statuses.p0_semantics_confirmed, 'warning');
  assert.equal(statuses.point_in_time_store_writable, 'ready');
  assert.equal(statuses.feature_snapshot_leakage_guard_enabled, 'ready');
  assert.equal(readiness.capabilities.autoSubmit, false);
});
