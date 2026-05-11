import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildManagedBrowserLaunch,
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
