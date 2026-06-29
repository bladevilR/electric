import { buildStrategySuggestions, numeric } from './strategy-engine.mjs';
import { summarizeDataset } from './system-data.mjs';
import { buildForecastModelReport } from './forecast-models.mjs';
import { runForecastBacktest } from './backtest-engine.mjs';
import { buildCostStrategy } from './cost-optimizer.mjs';
import { summarizeSettlementReference } from './settlement-reference.mjs';

function rowsForDate(dataset, date) {
  const rows = Array.isArray(dataset?.rows) ? dataset.rows : [];
  return date ? rows.filter((row) => row.date === date) : rows;
}

function average(values) {
  const clean = values.map(numeric).filter((value) => value !== null);
  if (!clean.length) {
    return null;
  }
  return Number((clean.reduce((sum, value) => sum + value, 0) / clean.length).toFixed(3));
}

function uniqueById(items) {
  const seen = new Set();
  return items.filter((item) => {
    const id = item?.id;
    if (!id || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function uniqueText(items) {
  return [...new Set(items.filter(Boolean))];
}

function summarizeForecastReport(report = {}) {
  const readiness = report.readiness || {};
  return {
    status: report.status || 'unavailable',
    targetDate: report.targetDate || '',
    historicalDateCount: readiness.historicalDateCount || 0,
    comparablePointCount: readiness.comparablePointCount || 0,
    missingReasons: Array.isArray(readiness.missingReasons) ? readiness.missingReasons : [],
    forecastCount: Array.isArray(report.forecasts) ? report.forecasts.length : 0,
  };
}

function summarizeBacktestReport(report = {}) {
  return {
    status: report.status || 'unavailable',
    evaluationDateCount: Array.isArray(report.evaluationDates) ? report.evaluationDates.length : 0,
    metrics: report.metrics || {},
    warnings: Array.isArray(report.warnings) ? report.warnings : [],
    strategyStatus: report.strategyComparison?.status || 'unavailable',
  };
}

function primarySavingsAction(costStrategy = {}) {
  const tiers = Array.isArray(costStrategy.policyTiers) ? costStrategy.policyTiers : [];
  const neutral = tiers.find((item) => item.id === 'neutral' && item.enabled);
  const conservative = tiers.find((item) => item.id === 'conservative');
  return neutral?.action || conservative?.action || '只做人工观察，不输出可执行电量。';
}

export function buildStrategyReport(dataset, options = {}) {
  const summary = summarizeDataset(dataset);
  const date = options.date || summary.dates?.[0] || '';
  const rows = rowsForDate(dataset, date);
  const realTimePrices = rows.map((row) => row.realTimeAvgPrice).filter((value) => numeric(value) !== null);
  const suggestions = buildStrategySuggestions(dataset, { date });
  const featureStore = options.featureStore || dataset;
  const forecastReport =
    options.forecastReport || options.modelReport || buildForecastModelReport(featureStore, { targetDate: date });
  const backtestReport = options.backtestReport || runForecastBacktest(featureStore);
  const costStrategy =
    options.costStrategy ||
    buildCostStrategy(options.strategyDataset || dataset, {
      date,
      assets: options.assets,
      modelReport: forecastReport,
      backtestReport,
    });
  const forecastSummary = summarizeForecastReport(forecastReport);
  const backtestSummary = summarizeBacktestReport(backtestReport);
  const settlementReferenceSummary = summarizeSettlementReference(options.settlementReference);
  const dataNeeds = Array.isArray(costStrategy.nextBestData) ? costStrategy.nextBestData : [];
  const pendingIntegrations = uniqueById(suggestions.flatMap((item) => item.requiredData || []));
  const closureItems = Array.isArray(options.integrationClosure?.items)
    ? options.integrationClosure.items
    : pendingIntegrations.map((entry) => ({
        id: entry.id,
        name: entry.name,
        status: 'registered',
        closureText: entry.note,
      }));
  const blockingReasons = uniqueText(suggestions.flatMap((item) => item.blockingReasons || []));

  return {
    title: '苏州地铁电力交易 AI 辅助策略报告',
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: dataset?.generatedAt ?? null,
    date,
    status: 'trial_only',
    statusText: '可试算，不可执行',
    market: {
      rowCount: rows.length,
      realTimePricePoints: realTimePrices.length,
      averageRealTimePrice: average(realTimePrices),
    },
    dataQuality: {
      p0SourceCoverage: summary.p0SourceCoverage,
      gapCount: summary.gapCount,
      gaps: summary.gaps,
      fieldCompleteness: summary.fieldCompleteness,
    },
      suggestions,
    forecastSummary,
    backtestSummary,
    settlementReferenceSummary,
    costStrategy,
    savingsFocus: {
      modelMode: costStrategy.modelMode || forecastSummary.status || 'heuristic_fallback',
      primaryAction: primarySavingsAction(costStrategy),
      confidenceScore: Number(costStrategy.dataConfidence?.score || 0),
      dataNeeds,
    },
    closureItems,
    blockingReasons,
    nextActions: [
      ...closureItems.map((item) => ({
        id: item.id,
        title: item.name,
        note: item.closureText || item.note,
        status: item.status,
      })),
      {
        id: 'targeted_backfill',
        title: '定向补采',
        note: dataNeeds.length
          ? dataNeeds.map((item) => item.reason || item.id).join('；')
          : '按补采计划慢速核对缺口，不连续扫站。',
        status: 'registered',
      },
      {
        id: 'settlement_reference_review',
        title: '结算参考复核',
        note: settlementReferenceSummary.hasSettlementReference
          ? `已找到 ${settlementReferenceSummary.referenceWorkbookCount} 个 Excel 参考文件，但不能替代 actualKwh/settleAmount。`
          : '尚未找到可用 Excel 参考文件。',
        status: settlementReferenceSummary.hasSettlementReference ? 'registered' : 'source_empty',
      },
    ],
  };
}

export function renderStrategyReportMarkdown(report) {
  const market = report.market || {};
  const quality = report.dataQuality || {};
  const suggestions = Array.isArray(report.suggestions) ? report.suggestions : [];
  const integrations = Array.isArray(report.closureItems) ? report.closureItems : [];
  const blockers = Array.isArray(report.blockingReasons) ? report.blockingReasons : [];
  const savingsFocus = report.savingsFocus || {};
  const forecastSummary = report.forecastSummary || {};
  const backtestSummary = report.backtestSummary || {};
  const settlementReferenceSummary = report.settlementReferenceSummary || {};

  return [
    `# ${report.title}`,
    '',
    `- 交易日：${report.date || '待确认'}`,
    `- 生成时间：${report.generatedAt || '待确认'}`,
    `- 状态：${report.statusText || '可试算，不可执行'}`,
    '',
    '## 市场数据概览',
    '',
    `- 交易日标准行：${market.rowCount ?? 0}`,
    `- 实时均价点：${market.realTimePricePoints ?? 0}`,
    `- 实时均价均值：${market.averageRealTimePrice ?? '无可用值'}`,
    `- 数据缺口数：${quality.gapCount ?? 0}`,
    '',
    '## 省钱策略焦点',
    '',
    `- 模型模式：${savingsFocus.modelMode || 'heuristic_fallback'}`,
    `- 置信度：${savingsFocus.confidenceScore ?? 0}/100`,
    `- 首要动作：${savingsFocus.primaryAction || '人工观察'}`,
    `- 预测状态：${forecastSummary.status || 'unavailable'}，历史天数 ${forecastSummary.historicalDateCount ?? 0}`,
    `- 回测状态：${backtestSummary.status || 'unavailable'}，评估日期 ${backtestSummary.evaluationDateCount ?? 0}`,
    `- 结算参考：${
      settlementReferenceSummary.hasSettlementReference
        ? `已登记 ${settlementReferenceSummary.referenceWorkbookCount || 0} 个文件；不能替代 actualKwh/settleAmount`
        : '未登记可用参考文件'
    }`,
    '',
    '## 策略建议',
    '',
    ...suggestions.flatMap((item) => [
      `### ${item.title}`,
      '',
      `- 类型：${item.type}`,
      `- 状态：${item.executable ? '可执行' : '可试算，不可执行'}`,
      `- 动作方向：${item.action}`,
      `- 说明：${item.description}`,
      '',
    ]),
    '## 闭环清单',
    '',
    ...(integrations.length
      ? integrations.map((item) => `- ${item.name || item.id}：${item.status || '已登记'}，${item.closureText || item.note || '已纳入闭环台账。'}`)
      : ['- 暂无缺口项']),
    '',
    '## 执行阻塞原因',
    '',
    ...(blockers.length ? blockers.map((item) => `- ${item}`) : ['- 暂无阻塞原因']),
    '',
    '> 当前报告仅用于辅助决策复核；系统不自动登录 JSPEC，不写入交易平台，不生成交易提交文件。',
    '',
  ].join('\n');
}
