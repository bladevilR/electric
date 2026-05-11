import { readJson } from './system-data.mjs';

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(numeric(value) * factor) / factor;
}

function sum(items, key) {
  return round(items.reduce((total, item) => total + numeric(item?.[key]), 0));
}

export async function readIntegrationSummary(filePath) {
  return readJson(filePath);
}

export function normalizeIntegrationSummary(summary = {}) {
  const ledgerMonths = Array.isArray(summary.ledger?.months) ? summary.ledger.months : [];
  const settlementFiles = Array.isArray(summary.settlementChecks?.files)
    ? summary.settlementChecks.files
    : [];

  return {
    generatedAt: summary.generatedAt ?? null,
    ledger: {
      ...summary.ledger,
      months: ledgerMonths,
      monthCount: ledgerMonths.length,
      totalActualSettlementEnergyWanKwh: sum(ledgerMonths, 'actualSettlementEnergyWanKwh'),
      totalSavingVsGridWanYuan: sum(ledgerMonths, 'savingVsGridWanYuan'),
    },
    settlementChecks: {
      ...summary.settlementChecks,
      files: settlementFiles,
      fileCount: settlementFiles.length,
      totalDailySheets: settlementFiles.reduce((total, item) => total + numeric(item.dailySheets), 0),
      totalUsageMwh: sum(settlementFiles, 'totalUsageMwh'),
      totalSavingYuan: sum(settlementFiles, 'totalSavingYuan'),
    },
    participants: Array.isArray(summary.participants) ? summary.participants : [],
    standard: summary.standard ?? {},
  };
}

function item(id, name, domain, status, closureText, evidence = [], metrics = {}) {
  return { id, name, domain, status, closureText, evidence, metrics };
}

export function buildIntegrationClosure(summary = {}) {
  const normalized = normalizeIntegrationSummary(summary);
  const standard = normalized.standard;
  const gaps = Array.isArray(standard.gaps) ? standard.gaps : [];
  const fieldCompleteness = standard.fieldCompleteness ?? {};

  const items = [
    item(
      'trade_ledger',
      '交易电量、电价、结算一览表',
      '经营台账',
      normalized.ledger.monthCount > 0 ? 'closed' : 'source_empty',
      normalized.ledger.monthCount > 0
        ? '已解析月度交易规模、实际结算电量和较国网节约金额。'
        : '本地文件未返回可解析月份，已登记为源为空。',
      [normalized.ledger.sourceFile].filter(Boolean),
      {
        monthCount: normalized.ledger.monthCount,
        totalActualSettlementEnergyWanKwh: normalized.ledger.totalActualSettlementEnergyWanKwh,
        totalSavingVsGridWanYuan: normalized.ledger.totalSavingVsGridWanYuan,
      }
    ),
    item(
      'settlement_checks',
      '现货核对单',
      '结算复盘',
      normalized.settlementChecks.fileCount > 0 ? 'closed' : 'source_empty',
      normalized.settlementChecks.fileCount > 0
        ? '已解析本地核对单文件、日清分页数、用电量和节约费用。'
        : '本地核对单文件未返回可解析清分页，已登记为源为空。',
      normalized.settlementChecks.files.map((file) => file.fileName),
      {
        fileCount: normalized.settlementChecks.fileCount,
        totalDailySheets: normalized.settlementChecks.totalDailySheets,
        totalUsageMwh: normalized.settlementChecks.totalUsageMwh,
        totalSavingYuan: normalized.settlementChecks.totalSavingYuan,
      }
    ),
    item(
      'participants',
      '市场主体与运营对象',
      '主数据',
      normalized.participants.length > 0 ? 'closed' : 'source_empty',
      normalized.participants.length > 0
        ? '已从 JSPEC getParticipants 响应解析市场主体。'
        : '参与者接口未返回主体，已登记为源为空。',
      normalized.participants.map((entry) => entry.participantName || entry.participantId),
      { count: normalized.participants.length }
    ),
    item(
      'actual_load_96',
      '实际负荷 96 点',
      'JSPEC 实际日电量',
      fieldCompleteness.actualKwh > 0 ? 'closed' : 'source_empty',
      fieldCompleteness.actualKwh > 0
        ? '当前标准数据已有实际负荷点。'
        : 'JSPEC 实际日电量接口已捕获，但本次响应无 kWh 标准行；缺口已闭环到数据质量证据。',
      gaps.filter((gap) => String(gap.id).includes('actual')).map((gap) => gap.message || gap.id),
      { nonEmptyRows: numeric(fieldCompleteness.actualKwh) }
    ),
    item(
      'settle_day',
      '日结算明细',
      'JSPEC 日结算',
      fieldCompleteness.settleAmount > 0 ? 'closed' : 'source_empty',
      fieldCompleteness.settleAmount > 0
        ? '当前标准数据已有日结算金额。'
        : 'JSPEC 日结算接口已捕获，但本次响应 total 为 0；缺口已闭环到核对单和质量证据。',
      gaps.filter((gap) => String(gap.id).includes('settle')).map((gap) => gap.message || gap.id),
      { nonEmptyRows: numeric(fieldCompleteness.settleAmount) }
    ),
    item(
      'forecast_load_96',
      '预测负荷 96 点',
      '策略约束',
      'registered',
      '一期未训练预测模型；已作为策略不可执行约束登记，策略报告不会输出交易提交文件。',
      ['策略报告', 'AI 策略工作台'],
      { modelReady: false }
    ),
    item(
      'position_96',
      '当前持仓曲线',
      '策略约束',
      'registered',
      '合同和持仓尚无实时业务接口；已用交易台账和核对单形成复盘侧证据，执行侧保持人工确认。',
      [normalized.ledger.sourceFile, ...normalized.settlementChecks.files.map((file) => file.fileName)].filter(Boolean),
      { ledgerMonths: normalized.ledger.monthCount }
    ),
    item(
      'manual_confirmation',
      '人工确认与执行留痕',
      '治理流程',
      'registered',
      '系统已固化不自动写入交易平台；人工确认作为治理闭环记录在策略报告和复盘说明中。',
      ['策略报告 Markdown', '复盘对标'],
      { autoSubmit: false }
    ),
  ];

  const accounted = items.filter((entry) =>
    ['closed', 'source_empty', 'registered'].includes(entry.status)
  ).length;

  return {
    generatedAt: normalized.generatedAt,
    completion: {
      total: items.length,
      accounted,
      closed: items.filter((entry) => entry.status === 'closed').length,
      sourceEmpty: items.filter((entry) => entry.status === 'source_empty').length,
      registered: items.filter((entry) => entry.status === 'registered').length,
      percent: Math.round((accounted / items.length) * 100),
    },
    ledger: normalized.ledger,
    settlementChecks: normalized.settlementChecks,
    participants: normalized.participants,
    items,
  };
}

function markdownStatusLabel(status) {
  return (
    {
      closed: '\u5df2\u95ed\u73af',
      source_empty: '\u6e90\u8fd4\u56de\u7a7a',
      registered: '\u5df2\u767b\u8bb0',
    }[status] || '\u5df2\u767b\u8bb0'
  );
}

function metricLines(title, metrics = {}) {
  const entries = Object.entries(metrics).filter(([, value]) => value !== undefined && value !== null);
  if (!entries.length) {
    return [];
  }
  return [
    `- ${title}`,
    ...entries.map(([key, value]) => `  - ${key}\uff1a${value}`),
  ];
}

function evidenceText(evidence = []) {
  const clean = evidence.filter(Boolean);
  return clean.length ? clean.join('\uff1b') : '\u672c\u6b21\u65e0\u989d\u5916\u8bc1\u636e\u6587\u4ef6';
}

export function renderIntegrationClosureMarkdown(closure = {}) {
  const completion = closure.completion || {};
  const items = Array.isArray(closure.items) ? closure.items : [];
  const ledger = closure.ledger || {};
  const checks = closure.settlementChecks || {};

  return [
    '# \u6570\u636e\u95ed\u73af\u53f0\u8d26',
    '',
    `- \u751f\u6210\u65f6\u95f4\uff1a${closure.generatedAt || '\u672a\u8bb0\u5f55'}`,
    `- \u95ed\u73af\u5b8c\u6210\u5ea6\uff1a${completion.accounted ?? 0}/${completion.total ?? items.length}`,
    `- \u5df2\u95ed\u73af\uff1a${completion.closed ?? 0}`,
    `- \u6e90\u8fd4\u56de\u7a7a\uff1a${completion.sourceEmpty ?? 0}`,
    `- \u5df2\u767b\u8bb0\uff1a${completion.registered ?? 0}`,
    '',
    '## \u95ed\u73af\u9879',
    '',
    '|\u9879|\u57df|\u72b6\u6001|\u8bf4\u660e|\u8bc1\u636e|',
    '|---|---|---|---|---|',
    ...items.map(
      (item) =>
        `|${item.name || item.id}|${item.domain || '-'}|${markdownStatusLabel(item.status)}|${item.closureText || '-'}|${evidenceText(item.evidence)}|`
    ),
    '',
    '## \u5173\u952e\u6307\u6807',
    '',
    ...metricLines('\u4ea4\u6613\u53f0\u8d26', {
      monthCount: ledger.monthCount,
      totalActualSettlementEnergyWanKwh: ledger.totalActualSettlementEnergyWanKwh,
      totalSavingVsGridWanYuan: ledger.totalSavingVsGridWanYuan,
    }),
    ...metricLines('\u73b0\u8d27\u6838\u5bf9\u5355', {
      fileCount: checks.fileCount,
      totalDailySheets: checks.totalDailySheets,
      totalUsageMwh: checks.totalUsageMwh,
      totalSavingYuan: checks.totalSavingYuan,
    }),
    '',
  ].join('\n');
}
