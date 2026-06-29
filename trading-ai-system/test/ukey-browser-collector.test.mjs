import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildAutoSweepSummary,
  buildAutoSweepTargets,
  buildBackfillPlan,
  buildManagedBrowserLaunch,
  createUkeyBrowserCollector,
  detectSweepRateLimitWarning,
  parseVisibleBusinessSnapshot,
} from '../lib/ukey-browser-collector.mjs';

test('buildManagedBrowserLaunch binds CDP to localhost and uses the managed JSPEC profile', () => {
  const launch = buildManagedBrowserLaunch({
    rootDir: 'E:\\electric\\trading-ai-system',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    debugPort: 9333,
    jspecUrl: 'https://www.jspec.com.cn/',
  });

  assert.equal(launch.browserName, 'Chrome');
  assert.equal(launch.executablePath, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  assert.equal(launch.debugAddress, '127.0.0.1');
  assert.equal(launch.debugPort, 9333);
  assert.equal(
    launch.profileDir,
    path.resolve('E:\\electric\\trading-ai-system', '.browser/jspec-managed-profile')
  );
  assert.ok(launch.args.includes('--remote-debugging-address=127.0.0.1'));
  assert.ok(launch.args.includes('--remote-debugging-port=9333'));
  assert.ok(launch.args.includes(`--user-data-dir=${launch.profileDir}`));
  assert.ok(launch.args.includes('https://www.jspec.com.cn/'));
});

test('collector source avoids credential and network interception APIs', async () => {
  const source = await readFile(
    new URL('../lib/ukey-browser-collector.mjs', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(source, /document\.cookie/i);
  assert.doesNotMatch(source, /localStorage/i);
  assert.doesNotMatch(source, /sessionStorage/i);
  assert.doesNotMatch(source, /Network\.enable/i);
  assert.doesNotMatch(source, /Fetch\.enable/i);
});

test('buildAutoSweepTargets creates a read-only JSPEC route sweep without menu clicking', () => {
  const targets = buildAutoSweepTargets({
    baseUrl: 'https://www.jspec.com.cn/#/dashboard',
  });
  const ids = targets.map((target) => target.id);

  assert.ok(ids.includes('dashboard'));
  assert.ok(ids.includes('user_bid_96'));
  assert.ok(ids.includes('user_default_bid_96'));
  assert.ok(ids.includes('dayahead_user_clearing'));
  assert.ok(ids.includes('realtime_average_price'));
  assert.ok(ids.includes('actual_load_96'));
  assert.ok(ids.includes('settle_day'));
  assert.ok(ids.includes('energy_block_trades'));
  assert.ok(ids.includes('energy_block_limits'));
  assert.ok(ids.includes('position_query'));
  assert.equal(targets.every((target) => target.url.startsWith('https://www.jspec.com.cn/')), true);
  assert.equal(
    targets.find((target) => target.id === 'dashboard')?.url,
    'https://www.jspec.com.cn/#/dashboard'
  );
  assert.equal(
    targets.find((target) => target.id === 'actual_load_96')?.url,
    'https://www.jspec.com.cn/pxf-js-outer-deferrableload/#/pxf-js-outer-deferrableload/dayElectricity'
  );
  assert.equal(
    targets.some((target) => /tradeDemo|rollMatchTrade|submit|commit/i.test(target.routeFragment)),
    false
  );
});

test('collector defaults to a moderate sweep pace instead of the earlier fast scan', () => {
  const collector = createUkeyBrowserCollector({
    rootDir: 'E:\\electric\\trading-ai-system',
    env: { JSPEC_MANAGED_BROWSER_DISABLED: '1' },
  });

  assert.equal(collector.status().sweep.defaultDelayMs, 20000);
});

test('buildAutoSweepTargets can limit a run to the core low-frequency pages', () => {
  const targets = buildAutoSweepTargets({ mode: 'core' });

  assert.deepEqual(
    targets.map((target) => target.id),
    ['dashboard', 'realtime_average_price', 'actual_load_96', 'settle_day']
  );
});

test('buildBackfillPlan prioritizes missing model-critical data at a safe pace', () => {
  const plan = buildBackfillPlan(
    {
      generatedAt: '2026-06-29T01:00:00.000Z',
      quality: { fieldCompleteness: { realTimeAvgPrice: 79, actualKwh: 0, settleAmount: 0 } },
      rows: [{ date: '2026-06-29', pointIndex: 1, realTimeAvgPrice: 300 }],
    },
    {
      now: '2026-06-29T01:45:00.000Z',
      date: '2026-06-29',
      assets: {
        summary: {
          dayAheadPublicClearingRows: 0,
          dayAheadUserClearingRows: 0,
          userDefaultBidRows: 0,
          systemLoadForecastRows: 0,
          contractCurrentTotal: 176,
          contractCurrentCapturedRows: 10,
        },
      },
    }
  );

  assert.equal(plan.mode, 'targeted');
  assert.equal(plan.targets.length <= 4, true);
  assert.ok(plan.targets.some((item) => item.id === 'realtime_average_price'));
  assert.ok(plan.targets.some((item) => item.id === 'actual_load_96'));
  assert.ok(plan.targets.some((item) => item.id === 'settle_day'));
  assert.ok(plan.targets.every((item) => item.delayMs >= 20000));
});

test('buildBackfillPlan records rate limit state instead of recommending a broad sweep', () => {
  const plan = buildBackfillPlan(
    { quality: { fieldCompleteness: {} }, rows: [] },
    { date: '2026-06-29', rateLimited: true }
  );

  assert.equal(plan.rateLimited, true);
  assert.equal(plan.targets.length <= 4, true);
});

test('detectSweepRateLimitWarning catches JSPEC frequency alarms', () => {
  assert.equal(
    detectSweepRateLimitWarning({
      title: '电力交易平台',
      bodyText: '系统提示：API访问频率过高，请稍后重试。',
    }),
    true
  );
  assert.equal(
    detectSweepRateLimitWarning({
      title: '电力交易平台',
      bodyText: '用户：苏州市轨道交通集团有限公司 江苏省内现货',
    }),
    false
  );
});

test('buildAutoSweepSummary merges accepted rows from multiple scanned pages', () => {
  const realtimeSnapshot = parseVisibleBusinessSnapshot({
    url: 'https://www.jspec.com.cn/realtime',
    title: '实时均价',
    bodyText: '交易日期：2026-05-09',
    tables: [
      {
        headers: ['交易日期', '时段', '实时加权均价'],
        rows: [['2026-05-09', '00:15', '301.5']],
      },
    ],
  });
  const loadSnapshot = parseVisibleBusinessSnapshot({
    url: 'https://www.jspec.com.cn/load',
    title: '实际负荷',
    bodyText: '交易日期：2026-05-09',
    tables: [
      {
        headers: ['交易日期', '时段', '实际负荷'],
        rows: [['2026-05-09', '00:30', '42.1']],
      },
    ],
  });

  const summary = buildAutoSweepSummary(
    [
      { target: { id: 'realtime_average_price', name: '实时均价' }, snapshot: realtimeSnapshot },
      { target: { id: 'actual_load_96', name: '实际负荷' }, snapshot: loadSnapshot },
      {
        target: { id: 'settle_day', name: '日结算' },
        error: 'No visible JSPEC business rows were detected.',
      },
    ],
    {
      startedAt: '2026-05-09T00:00:00.000Z',
      finishedAt: '2026-05-09T00:01:00.000Z',
    }
  );

  assert.equal(summary.source, 'jspec_managed_browser_auto_sweep');
  assert.equal(summary.targetCount, 3);
  assert.equal(summary.pageCount, 3);
  assert.equal(summary.acceptedPageCount, 2);
  assert.equal(summary.rowCount, 2);
  assert.deepEqual(summary.rows.map((row) => row.pointIndex), [1, 2]);
  assert.deepEqual(summary.rows[0].sourceTargets, ['realtime_average_price', 'visible_page_snapshot']);
  assert.deepEqual(summary.rows[1].sourceTargets, ['actual_load_96', 'visible_page_snapshot']);
  assert.equal(summary.pages.find((page) => page.targetId === 'settle_day')?.ok, false);
  assert.match(summary.errors.join('\n'), /settle_day/);
});

test('parseVisibleBusinessSnapshot maps visible JSPEC table text into allowed business rows', () => {
  const snapshot = parseVisibleBusinessSnapshot({
    url: 'https://www.jspec.com.cn/realtime',
    title: '江苏电力交易中心',
    bodyText: '交易日期：2026-05-09 实时市场',
    tables: [
      {
        headers: ['时段', '实时加权均价', '申报电力', '实际负荷'],
        rows: [
          ['00:15', '301.5', '35.2', '41.8'],
          ['00:30', '288.1', '36.4', '42.1'],
        ],
      },
    ],
  });

  assert.equal(snapshot.source, 'jspec_managed_browser_visible_page');
  assert.equal(snapshot.tableCount, 1);
  assert.equal(snapshot.matchedTableCount, 1);
  assert.deepEqual(snapshot.rows, [
    {
      date: '2026-05-09',
      pointIndex: 1,
      timePoint: '00:15',
      realTimeAvgPrice: 301.5,
      declarationPower: 35.2,
      actualKwh: 41.8,
      sourceTargets: ['visible_page_snapshot'],
    },
    {
      date: '2026-05-09',
      pointIndex: 2,
      timePoint: '00:30',
      realTimeAvgPrice: 288.1,
      declarationPower: 36.4,
      actualKwh: 42.1,
      sourceTargets: ['visible_page_snapshot'],
    },
  ]);
});

test('parseVisibleBusinessSnapshot handles JSPEC split header and body tables', () => {
  const snapshot = parseVisibleBusinessSnapshot({
    url: 'https://www.jspec.com.cn/pxf-spotgoods-province-extranet/#/pxf-spotgoods-province-extranet/realTimeClearingRelease/RealTimeMarAvePricePublic',
    title: '实时市场加权均价（公开） - 新一代电力交易平台',
    bodyText: '2026-6-29 14:55:30 实时市场加权均价（公开）',
    tables: [
      {
        headers: ['时间', '实时市场加权均价 （元/MWh）', ''],
        rows: [['时间', '实时市场加权均价 （元/MWh）', '']],
      },
      {
        headers: ['00:15', '342.3'],
        rows: [
          ['00:30', '341.5'],
        ],
      },
    ],
  });

  assert.equal(snapshot.rowCount, 2);
  assert.deepEqual(snapshot.rows.map((row) => row.realTimeAvgPrice), [342.3, 341.5]);
  assert.deepEqual(snapshot.rows.map((row) => row.pointIndex), [1, 2]);
  assert.equal(snapshot.rows[0].date, '2026-06-29');
});

test('parseVisibleBusinessSnapshot rejects sensitive visible-table headers', () => {
  const snapshot = parseVisibleBusinessSnapshot({
    url: 'https://www.jspec.com.cn/realtime',
    title: '江苏电力交易中心',
    bodyText: '交易日期：2026-05-09',
    tables: [
      {
        headers: ['时段', 'cookie', '实时加权均价'],
        rows: [['00:15', 'secret', '301.5']],
      },
    ],
  });

  assert.equal(snapshot.rows.length, 0);
  assert.match(snapshot.errors.join('\n'), /sensitive/i);
  assert.match(snapshot.errors.join('\n'), /cookie/i);
});
