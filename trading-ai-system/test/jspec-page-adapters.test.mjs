import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import { chromium } from 'playwright';
import { buildManagedBrowserLaunch } from '../lib/ukey-browser-collector.mjs';
import { createPriceAdapter } from '../lib/jspec-adapters/price.mjs';
import { createWeatherAdapter } from '../lib/jspec-adapters/weather.mjs';
import { createLoadAdapter } from '../lib/jspec-adapters/load.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(rootDir, 'test', 'fixtures', 'jspec-pages');
const executablePath = buildManagedBrowserLaunch({ rootDir }).executablePath;

function fixtureUrl(name) {
  return pathToFileURL(path.join(fixtureDir, name)).href;
}

async function withPage(run) {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  try {
    await run(page);
  } finally {
    await browser.close();
  }
}

test('price, weather, and load adapters query dates and extract typed facts', async () => {
  await withPage(async (page) => {
    const cases = [
      {
        adapter: createPriceAdapter({ url: fixtureUrl('price.html'), expectedPointCount: 4 }),
        fieldId: 'dayAheadUserPriceFinalYuanPerMwh',
        firstValue: 342.3,
        unit: '元/MWh',
      },
      {
        adapter: createWeatherAdapter({ url: fixtureUrl('weather.html'), expectedPointCount: 4 }),
        fieldId: 'temperatureForecastC',
        firstValue: 29.1,
        unit: '°C',
      },
      {
        adapter: createLoadAdapter({ url: fixtureUrl('load.html'), expectedPointCount: 4 }),
        fieldId: 'loadForecastMw',
        firstValue: 1165,
        unit: 'MW',
      },
    ];

    for (const item of cases) {
      await item.adapter.navigate(page);
      assert.deepEqual(await item.adapter.discoverBounds(page), {
        earliestDate: '2026-05-01',
        latestDate: '2026-07-31',
      });
      await item.adapter.setQuery(page, { businessDate: '2026-07-31' });
      await item.adapter.submit(page);
      await item.adapter.waitForResult(page);
      const result = await item.adapter.extract(page, {
        businessDate: '2026-07-31',
        capturedAt: '2026-09-03T10:00:00.000Z',
      });
      const validated = item.adapter.validate(result, { businessDate: '2026-07-31' });
      const fact = validated.facts.find((row) => row.fieldId === item.fieldId && row.pointIndex === 1);
      assert.equal(fact.value, item.firstValue);
      assert.equal(fact.unit, item.unit);
      assert.equal(validated.coverageByField[item.fieldId], 4);
      assert.match(validated.structureFingerprint, /^[a-f0-9]{64}$/);
    }
  });
});

test('adapter rejects a result whose visible query date differs from the requested date', async () => {
  await withPage(async (page) => {
    const adapter = createPriceAdapter({ url: fixtureUrl('price.html'), expectedPointCount: 4 });
    await adapter.navigate(page);
    const result = await adapter.extract(page, {
      businessDate: '2026-07-31',
      capturedAt: '2026-09-03T10:00:00.000Z',
    });
    assert.throws(() => adapter.validate(result, { businessDate: '2026-07-31' }), (error) => {
      assert.equal(error.code, 'query_date_mismatch');
      return true;
    });
  });
});

test('adapter identifies login expiry, rate limiting, and required column changes', async () => {
  await withPage(async (page) => {
    const adapter = createPriceAdapter({ expectedPointCount: 1 });

    await page.goto(fixtureUrl('login.html'));
    await assert.rejects(() => adapter.waitForResult(page), (error) => error.code === 'login_expired');

    await page.goto(fixtureUrl('rate-limit.html'));
    await assert.rejects(() => adapter.waitForResult(page), (error) => error.code === 'rate_limited');

    await page.goto(fixtureUrl('missing-column.html'));
    const result = await adapter.extract(page, {
      businessDate: '2026-07-30',
      capturedAt: '2026-09-03T10:00:00.000Z',
    });
    assert.throws(() => adapter.validate(result, { businessDate: '2026-07-30' }), (error) => {
      assert.equal(error.code, 'required_column_missing');
      return true;
    });
  });
});

test('adapter advances visible pagination without treating a disabled button as another page', async () => {
  await withPage(async (page) => {
    const adapter = createPriceAdapter({ url: fixtureUrl('pagination.html'), expectedPointCount: 2 });
    await adapter.navigate(page);
    const first = adapter.validate(await adapter.extract(page, {
      businessDate: '2026-07-30',
      capturedAt: '2026-09-03T10:00:00.000Z',
    }), { businessDate: '2026-07-30' });
    assert.deepEqual(first.facts.map((fact) => fact.pointIndex), [1, 2]);
    assert.equal(await adapter.nextPage(page), true);
    const second = adapter.validate(await adapter.extract(page, {
      businessDate: '2026-07-30',
      capturedAt: '2026-09-03T10:00:00.000Z',
    }), { businessDate: '2026-07-30' });
    assert.deepEqual(second.facts.map((fact) => fact.pointIndex), [3, 4]);
    assert.equal(await adapter.nextPage(page), false);
  });
});
