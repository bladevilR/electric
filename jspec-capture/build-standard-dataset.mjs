import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildStandardDataset,
  formatQualityMarkdown,
  rowsToCsv,
  summarizeForMachine,
} from './lib/standard-96.mjs';
import { classifyBusinessTarget } from './lib/jspec-targets.mjs';

function getArgValue(name, defaultValue) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return defaultValue;
  }

  return process.argv[index + 1];
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readCaptures(captureDir) {
  const responsesDir = path.join(captureDir, 'responses');
  const names = (await readdir(responsesDir)).filter((name) => name.endsWith('.json')).sort();
  const captures = [];

  for (const name of names) {
    const payload = await readJson(path.join(responsesDir, name));
    const meta = payload.meta ?? {};
    const request = payload.request ?? {};
    const businessTarget =
      payload.businessTarget ??
      classifyBusinessTarget({
        url: meta.url ?? request.url ?? payload.url,
        requestHeaders: meta.requestHeaders ?? request.headers ?? payload.requestHeaders,
        pageUrl: undefined,
      });

    captures.push({
      ...payload,
      fileName: payload.fileName ?? name,
      businessTarget,
    });
  }

  return captures;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeScriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function fieldNonEmpty(dataset, field) {
  return dataset.quality.fieldCompleteness[field] ?? 0;
}

function buildDashboardHtml(dataset, summary) {
  const dashboardData = {
    dataset,
    summary,
    generatedAtLabel: new Date(dataset.generatedAt).toLocaleString('zh-CN', {
      hour12: false,
      timeZone: 'Asia/Shanghai',
    }),
  };

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>JSPEC 96点数据驾驶舱</title>
  <style>
    :root {
      --ink: #10232f;
      --muted: #557181;
      --line: rgba(16, 35, 47, 0.12);
      --panel: rgba(255, 255, 255, 0.84);
      --brand: #006c77;
      --brand-2: #e18b2d;
      --good: #008f68;
      --warn: #c46a00;
      --bad: #bd3241;
      --paper: #f3efe4;
      --shadow: 0 24px 80px rgba(20, 38, 44, 0.16);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      font-family: "Aptos Display", "Segoe UI", "Microsoft YaHei", sans-serif;
      background:
        radial-gradient(circle at 12% 8%, rgba(225, 139, 45, 0.24), transparent 26rem),
        radial-gradient(circle at 86% 14%, rgba(0, 108, 119, 0.22), transparent 30rem),
        linear-gradient(135deg, #f7f1e5 0%, #e8f0ec 52%, #f5e7d2 100%);
      min-height: 100vh;
    }

    .shell {
      width: min(1480px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 28px 0 42px;
    }

    .hero {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 34px;
      padding: 34px;
      background: rgba(255, 255, 255, 0.72);
      box-shadow: var(--shadow);
    }

    .hero:after {
      content: "";
      position: absolute;
      right: -90px;
      top: -70px;
      width: 360px;
      height: 360px;
      border-radius: 50%;
      background: repeating-linear-gradient(135deg, rgba(0, 108, 119, 0.16) 0 10px, transparent 10px 21px);
      opacity: 0.7;
    }

    .eyebrow {
      color: var(--brand);
      font-weight: 800;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      font-size: 12px;
    }

    h1 {
      position: relative;
      z-index: 1;
      margin: 10px 0 12px;
      font-size: clamp(32px, 5vw, 76px);
      line-height: 0.95;
      letter-spacing: -0.06em;
    }

    .subtitle {
      position: relative;
      z-index: 1;
      max-width: 880px;
      color: var(--muted);
      font-size: 18px;
      line-height: 1.7;
      margin: 0;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 18px;
      margin-top: 18px;
    }

    .card {
      border: 1px solid var(--line);
      border-radius: 26px;
      background: var(--panel);
      box-shadow: 0 12px 36px rgba(16, 35, 47, 0.08);
      backdrop-filter: blur(14px);
      padding: 22px;
    }

    .metric { grid-column: span 3; min-height: 140px; }
    .wide { grid-column: span 8; }
    .side { grid-column: span 4; }
    .full { grid-column: 1 / -1; }

    .label {
      color: var(--muted);
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .value {
      margin-top: 12px;
      font-size: 44px;
      font-weight: 900;
      letter-spacing: -0.05em;
    }

    .note {
      color: var(--muted);
      margin-top: 8px;
      line-height: 1.55;
    }

    h2 {
      margin: 0 0 16px;
      font-size: 24px;
      letter-spacing: -0.03em;
    }

    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 12px;
      color: var(--muted);
      font-size: 13px;
    }

    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
      margin-right: 6px;
    }

    svg { width: 100%; height: 360px; display: block; }
    .axis { stroke: rgba(16, 35, 47, 0.13); stroke-width: 1; }
    .line-a { fill: none; stroke: var(--brand); stroke-width: 3; }
    .line-b { fill: none; stroke: var(--brand-2); stroke-width: 3; }
    .line-c { fill: none; stroke: #2f8f53; stroke-width: 3; }

    .gaps {
      display: grid;
      gap: 10px;
    }

    .gap {
      border-left: 5px solid var(--warn);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.58);
      padding: 12px 14px;
      line-height: 1.5;
    }

    .gap.high { border-left-color: var(--bad); }
    .gap.medium { border-left-color: var(--warn); }
    .gap.low { border-left-color: var(--good); }

    .strategy {
      display: grid;
      gap: 12px;
    }

    .strategy-item {
      border-radius: 18px;
      padding: 14px 16px;
      background: linear-gradient(135deg, rgba(0, 108, 119, 0.12), rgba(225, 139, 45, 0.10));
      border: 1px solid var(--line);
    }

    .table-wrap {
      overflow: auto;
      border-radius: 20px;
      border: 1px solid var(--line);
      max-height: 560px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: rgba(255,255,255,0.78);
      font-size: 13px;
      min-width: 1320px;
    }

    th, td {
      padding: 10px 12px;
      border-bottom: 1px solid rgba(16, 35, 47, 0.08);
      text-align: right;
      white-space: nowrap;
    }

    th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #f6f1e7;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    th:first-child, td:first-child,
    th:nth-child(2), td:nth-child(2) { text-align: left; }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.58);
      font-size: 12px;
      color: var(--muted);
    }

    @media (max-width: 960px) {
      .metric, .wide, .side { grid-column: 1 / -1; }
      .hero { padding: 24px; border-radius: 24px; }
      svg { height: 260px; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div class="eyebrow">JSPEC Capture To Product Dataset</div>
      <h1>96点交易数据驾驶舱</h1>
      <p class="subtitle">本页完全基于本地抓包文件生成，不依赖 JSPEC 在线接口。它把日前申报、缺省申报、日前/实时出清、实时均价、实际电量与结算缺口统一到一个可交付的数据口径。</p>
    </section>

    <section class="grid">
      <article class="card metric">
        <div class="label">标准行数</div>
        <div class="value" id="rowCount">-</div>
        <div class="note">按日期 + 96点时间片合并后的行数</div>
      </article>
      <article class="card metric">
        <div class="label">覆盖日期</div>
        <div class="value" id="dateCount">-</div>
        <div class="note" id="dateText">-</div>
      </article>
      <article class="card metric">
        <div class="label">P0 源</div>
        <div class="value" id="sourceCount">-</div>
        <div class="note">已捕获的核心业务数据源</div>
      </article>
      <article class="card metric">
        <div class="label">质量缺口</div>
        <div class="value" id="gapCount">-</div>
        <div class="note">缺口会保留，不自动猜数</div>
      </article>

      <article class="card wide">
        <h2>价格与申报曲线</h2>
        <div class="legend">
          <span><i class="dot" style="background:#006c77"></i>实时均价</span>
          <span><i class="dot" style="background:#e18b2d"></i>日前公开价</span>
          <span><i class="dot" style="background:#2f8f53"></i>缺省申报功率</span>
        </div>
        <svg id="chart" viewBox="0 0 1000 360" role="img" aria-label="96点曲线图"></svg>
      </article>

      <aside class="card side">
        <h2>策略观察</h2>
        <div class="strategy" id="strategy"></div>
      </aside>

      <article class="card side">
        <h2>质量缺口</h2>
        <div class="gaps" id="gaps"></div>
      </article>

      <article class="card wide">
        <h2>字段完整度</h2>
        <div class="gaps" id="fields"></div>
      </article>

      <article class="card full">
        <h2>标准96点明细</h2>
        <div class="note">生成时间：${escapeHtml(dashboardData.generatedAtLabel)}</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>日期</th><th>点位</th><th>实时均价</th><th>实时当前点价</th><th>日前公开价</th>
                <th>缺省申报</th><th>主动申报</th><th>实际kWh</th><th>来源</th>
              </tr>
            </thead>
            <tbody id="rows"></tbody>
          </table>
        </div>
      </article>
    </section>
  </main>
  <script id="dashboard-data" type="application/json">${safeScriptJson(dashboardData)}</script>
  <script>
    const payload = JSON.parse(document.getElementById('dashboard-data').textContent);
    const dataset = payload.dataset;
    const rows = dataset.rows || [];
    const p0Ids = ['user_bid_96','user_default_bid_96','dayahead_user_clearing','dayahead_public_clearing','realtime_public_clearing','realtime_average_price','actual_load_96','settle_day'];
    const fmt = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 });
    const cell = (value) => value === null || value === undefined || value === '' ? '-' : fmt.format(Number(value));

    document.getElementById('rowCount').textContent = rows.length;
    document.getElementById('dateCount').textContent = dataset.quality.dates.length;
    document.getElementById('dateText').textContent = dataset.quality.dates.join(' / ') || '-';
    document.getElementById('sourceCount').textContent = p0Ids.filter((id) => dataset.sources[id]).length + '/8';
    document.getElementById('gapCount').textContent = dataset.quality.gaps.length;

    function linePath(points, field) {
      const valid = points.filter((row) => row[field] !== null && row[field] !== undefined && Number.isFinite(Number(row[field])));
      if (!valid.length) return '';
      const values = valid.map((row) => Number(row[field]));
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = max === min ? 1 : max - min;
      return valid.map((row, i) => {
        const x = 56 + ((Number(row.pointIndex || i + 1) - 1) / 95) * 884;
        const y = 304 - ((Number(row[field]) - min) / span) * 250;
        return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
      }).join(' ');
    }

    const chartRows = rows.filter((row) => row.pointIndex);
    const chart = document.getElementById('chart');
    chart.innerHTML = '<line class="axis" x1="56" y1="304" x2="950" y2="304"></line>' +
      '<line class="axis" x1="56" y1="54" x2="56" y2="304"></line>' +
      '<path class="line-a" d="' + linePath(chartRows, 'realTimeAvgPrice') + '"></path>' +
      '<path class="line-b" d="' + linePath(chartRows, 'dayAheadPublicPrice') + '"></path>' +
      '<path class="line-c" d="' + linePath(chartRows, 'defaultDeclarationPower') + '"></path>';

    const gaps = document.getElementById('gaps');
    gaps.innerHTML = dataset.quality.gaps.length
      ? dataset.quality.gaps.map((gap) => '<div class="gap ' + gap.severity + '"><strong>' + gap.id + '</strong><br>' + gap.message + '</div>').join('')
      : '<div class="gap low">当前质量报告未发现缺口。</div>';

    const fields = ['declarationPower','defaultDeclarationPower','dayAheadPublicPrice','realTimeAvgPrice','actualKwh','settleAmount'];
    document.getElementById('fields').innerHTML = fields.map((field) => {
      const count = dataset.quality.fieldCompleteness[field] || 0;
      const pct = rows.length ? Math.round(count / rows.length * 100) : 0;
      return '<div class="pill">' + field + ': ' + count + '/' + rows.length + ' (' + pct + '%)</div>';
    }).join('');

    const realtimePrices = rows
      .map((row) => Number(row.realTimeAvgPrice))
      .filter((value) => Number.isFinite(value));
    const highLine = realtimePrices.length ? realtimePrices.slice().sort((a,b) => a - b)[Math.floor(realtimePrices.length * 0.8)] : null;
    const highRows = highLine === null ? [] : rows.filter((row) => Number(row.realTimeAvgPrice) >= highLine).slice(0, 6);
    const hasActualLoad = rows.some((row) => row.actualKwh !== null && row.actualKwh !== undefined);
    const strategyItems = [];
    if (highRows.length) {
      strategyItems.push('高价观察窗口：' + highRows.map((row) => row.date + ' ' + row.timePoint).join('、') + '。这些点位适合重点复核申报/偏差风险。');
    }
    if (!hasActualLoad) {
      strategyItems.push('实际日电量当前为空：可以先做价格与申报看板，但偏差考核、用电预测和结算复盘还需要补实际负荷行。');
    }
    if (dataset.quality.dates.length > 1) {
      strategyItems.push('当前包含多个交易日期：日前数据和实时数据不要直接按同一自然日比较，后续应按业务交易日对齐。');
    }
    if (!strategyItems.length) {
      strategyItems.push('核心数据已可进入策略计算：下一步可加入合同持仓、月度分解和历史负荷模型。');
    }
    document.getElementById('strategy').innerHTML = strategyItems.map((text) => '<div class="strategy-item">' + text + '</div>').join('');

    document.getElementById('rows').innerHTML = rows.map((row) => '<tr>' +
      '<td>' + row.date + '</td>' +
      '<td>' + row.timePoint + '</td>' +
      '<td>' + cell(row.realTimeAvgPrice) + '</td>' +
      '<td>' + cell(row.realTimePointPriceCurrent) + '</td>' +
      '<td>' + cell(row.dayAheadPublicPrice) + '</td>' +
      '<td>' + cell(row.defaultDeclarationPower) + '</td>' +
      '<td>' + cell(row.declarationPower) + '</td>' +
      '<td>' + cell(row.actualKwh) + '</td>' +
      '<td>' + (row.sourceTargets || []).join('|') + '</td>' +
    '</tr>').join('');
  </script>
</body>
</html>
`;
}

async function main() {
  const captureDir = path.resolve(getArgValue('--capture-dir', '.'));
  const outputDir = path.resolve(getArgValue('--output-dir', path.join(captureDir, 'standard')));

  const captures = await readCaptures(captureDir);
  const dataset = buildStandardDataset(captures);
  const summary = summarizeForMachine(dataset);
  const qualityMarkdown = formatQualityMarkdown(dataset);
  const dashboardHtml = buildDashboardHtml(dataset, summary);

  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'standard-96.json'), JSON.stringify(dataset, null, 2), 'utf8');
  await writeFile(path.join(outputDir, 'standard-96.csv'), rowsToCsv(dataset.rows), 'utf8');
  await writeFile(path.join(outputDir, 'dataset-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  await writeFile(path.join(outputDir, 'quality-report.md'), qualityMarkdown, 'utf8');
  await writeFile(path.join(outputDir, 'system-dashboard.html'), dashboardHtml, 'utf8');

  process.stdout.write(qualityMarkdown);
  process.stdout.write(`\nSaved standard dataset to ${outputDir}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
