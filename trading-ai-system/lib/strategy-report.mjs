import { buildStrategySuggestions, numeric } from './strategy-engine.mjs';
import { summarizeDataset } from './system-data.mjs';

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

export function buildStrategyReport(dataset, options = {}) {
  const summary = summarizeDataset(dataset);
  const date = options.date || summary.dates?.[0] || '';
  const rows = rowsForDate(dataset, date);
  const realTimePrices = rows.map((row) => row.realTimeAvgPrice).filter((value) => numeric(value) !== null);
  const suggestions = buildStrategySuggestions(dataset, { date });
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
    closureItems,
    blockingReasons,
    nextActions: closureItems.map((item) => ({
      id: item.id,
      title: item.name,
      note: item.closureText || item.note,
      status: item.status,
    })),
  };
}

export function renderStrategyReportMarkdown(report) {
  const market = report.market || {};
  const quality = report.dataQuality || {};
  const suggestions = Array.isArray(report.suggestions) ? report.suggestions : [];
  const integrations = Array.isArray(report.closureItems) ? report.closureItems : [];
  const blockers = Array.isArray(report.blockingReasons) ? report.blockingReasons : [];

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
