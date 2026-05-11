function isPresent(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function envControl(id, title, envNames, env = {}, description, readyStatus = 'ready') {
  const missingKeys = envNames.filter((name) => !isPresent(env[name]));
  return {
    id,
    title,
    status: missingKeys.length ? 'action_required' : readyStatus,
    description,
    requiredKeys: envNames,
    providedKeys: envNames.filter((name) => isPresent(env[name])),
    missingKeys,
  };
}

function control(id, title, status, description, evidence = {}) {
  return { id, title, status, description, evidence };
}

function itemsByStatus(items, status) {
  return items
    .filter((item) => item.status === status)
    .map((item) => item.name || item.id)
    .filter(Boolean);
}

function asIssue(item) {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    missingKeys: item.missingKeys || [],
    evidence: item.evidence || {},
  };
}

export function buildProductionReadiness(options = {}) {
  const summary = options.summary || {};
  const closure = options.integrationClosure || {};
  const env = options.env || {};
  const paths = options.paths || {};
  const completion = closure.completion || {};
  const items = Array.isArray(closure.items) ? closure.items : [];
  const coverage = summary.p0SourceCoverage || {};

  const sourceEmptyItems = itemsByStatus(items, 'source_empty');
  const registeredItems = itemsByStatus(items, 'registered');
  const hasRows = Number(summary.rowCount || 0) > 0;
  const integrationReady =
    Number(completion.total || 0) > 0 &&
    Number(completion.accounted || 0) === Number(completion.total || 0);
  const p0CoverageReady =
    Number(coverage.total || 0) > 0 &&
    Number(coverage.present || 0) === Number(coverage.total || 0);

  const controls = [
    control(
      'standard_dataset',
      'JSPEC 标准数据集',
      hasRows ? 'ready' : 'blocked',
      '辅助决策至少需要可读取的交易日 96 点数据。',
      { rowCount: summary.rowCount || 0, p0Coverage: `${coverage.present || 0}/${coverage.total || 0}` }
    ),
    control(
      'integration_closure',
      '数据闭环台账',
      integrationReady ? 'ready' : 'blocked',
      '交易台账、核对单和源返回证据需要全部纳入闭环台账。',
      { completion: `${completion.accounted || 0}/${completion.total || 0}` }
    ),
    control(
      'p0_source_coverage',
      'P0 源覆盖',
      p0CoverageReady ? 'ready' : 'warning',
      'P0 源未全量覆盖时仍可生成提案草稿，但必须在人工决策时提示。',
      { p0Coverage: `${coverage.present || 0}/${coverage.total || 0}` }
    ),
    control(
      'source_empty_data',
      '源返回空数据提示',
      sourceEmptyItems.length ? 'warning' : 'ready',
      '实际负荷、日结算等关键源为空时，作为提案草稿的人工复核提示。',
      { items: sourceEmptyItems }
    ),
    control(
      'execution_master_data',
      '执行主数据提示',
      registeredItems.length ? 'warning' : 'ready',
      '预测负荷、持仓、交易限额等未形成接口前，提案草稿保留人工填写字段。',
      { items: registeredItems }
    ),
    control(
      'audit_store',
      '审计日志存储',
      isPresent(paths.auditLogPath) ? 'ready' : 'warning',
      '提案生成和人工复核动作需要写入追加式审计日志。',
      { path: paths.auditLogPath || '' }
    ),
    envControl(
      'jspec_auto_capture',
      'JSPEC 自动采集账号',
      ['JSPEC_BASE_URL', 'JSPEC_USERNAME'],
      env,
      '缺少 JSPEC 账号时仍可用本地数据生成草稿，但无法自动刷新生产源。'
    ),
    envControl(
      'ca_ukey',
      'CA/UKey 人工签名链路',
      ['CA_UKEY_PROVIDER', 'CA_UKEY_CERT_ID'],
      env,
      'CA/UKey 用于交易平台人工登录、签名或提交，不作为系统自动提交目标。'
    ),
    envControl(
      'trade_platform_prefill',
      '交易平台提案预填入口',
      ['TRADING_PLATFORM_URL'],
      env,
      '有交易平台地址后可辅助定位/预填页面字段，最终提交仍由人工确认。'
    ),
    envControl(
      'dual_review_identity',
      '操作人/复核人身份',
      ['TRADING_OPERATOR_ID', 'TRADING_APPROVER_ID'],
      env,
      '提案草稿需要记录操作人与复核人，确保人工决策可追溯。'
    ),
    control(
      'human_decision_policy',
      '人工最终决策策略',
      'ready',
      '系统只生成辅助决策提案草稿，不自动提交交易。',
      { autoSubmit: false }
    ),
  ];

  const blockers = controls.filter((item) => item.status === 'blocked').map(asIssue);
  const warnings = controls
    .filter((item) => ['warning', 'action_required'].includes(item.status))
    .map(asIssue);
  const decisionReady = hasRows && integrationReady;
  const status = decisionReady ? 'decision_support_ready' : 'data_blocked';

  return {
    generatedAt: new Date().toISOString(),
    status,
    statusText: decisionReady ? '辅助决策就绪' : '数据闭环阻塞',
    mode: 'human_decision_only',
    capabilities: {
      decisionSupport: decisionReady,
      reportExport: decisionReady,
      proposalDraft: decisionReady,
      platformPrefill: isPresent(env.TRADING_PLATFORM_URL),
      autoSubmit: false,
    },
    controls,
    blockers,
    warnings,
    paths: {
      standardPath: paths.standardPath || '',
      integrationSummaryPath: paths.integrationSummaryPath || '',
      auditLogPath: paths.auditLogPath || '',
    },
  };
}
