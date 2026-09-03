import test from 'node:test';
import assert from 'node:assert/strict';

import { createOpenMeteoTemperatureAdapter } from '../lib/weather-forecast-provider.mjs';

function hourlyPayload(field, baseValue) {
  return {
    latitude: 31.3,
    longitude: 120.6,
    timezone: 'Asia/Shanghai',
    hourly_units: { [field]: '°C' },
    hourly: {
      time: Array.from({ length: 24 }, (_, hour) => `2026-07-30T${String(hour).padStart(2, '0')}:00`),
      [field]: Array.from({ length: 24 }, (_, hour) => baseValue + hour),
    },
  };
}

test('weather adapter stores fixed-lead forecast and subsequent actual as separate 96-point facts', async () => {
  const requestedUrls = [];
  const fetch = async (url) => {
    requestedUrls.push(String(url));
    const isPreviousRun = String(url).startsWith('https://previous-runs-api.open-meteo.com/v1/forecast');
    return {
      ok: true,
      status: 200,
      async json() {
        return isPreviousRun
          ? hourlyPayload('temperature_2m_previous_day1', 20)
          : hourlyPayload('temperature_2m', 20.5);
      },
    };
  };
  const adapter = createOpenMeteoTemperatureAdapter({
    latitude: 31.3,
    longitude: 120.6,
    locationId: 'suzhou-center-v1',
    fetch,
    earliestDate: '2024-01-01',
    latestDate: '2026-07-30',
  });

  assert.deepEqual(await adapter.discoverBounds(), {
    earliestDate: '2024-01-01',
    latestDate: '2026-07-30',
  });
  await adapter.setQuery(null, { businessDate: '2026-07-30' });
  const result = await adapter.extract(null, {
    businessDate: '2026-07-30',
    capturedAt: '2026-09-03T10:00:00.000Z',
  });
  const validated = adapter.validate(result, { businessDate: '2026-07-30' });

  assert.equal(requestedUrls.length, 2);
  assert.match(requestedUrls[0], /hourly=temperature_2m_previous_day1/);
  assert.match(requestedUrls[0], /timezone=Asia%2FShanghai/);
  assert.match(requestedUrls[1], /^https:\/\/archive-api\.open-meteo\.com\/v1\/archive/);
  assert.equal(validated.coverageByField.temperatureForecastC, 96);
  assert.equal(validated.coverageByField.temperatureActualC, 96);
  assert.equal(validated.facts.find((fact) => fact.fieldId === 'temperatureForecastC' && fact.pointIndex === 1).value, 20.25);
  assert.equal(validated.facts.find((fact) => fact.fieldId === 'temperatureActualC' && fact.pointIndex === 1).value, 20.75);
  assert.equal(validated.evidence.forecastLeadHours, 24);
  assert.equal(validated.evidence.alignmentMethod, 'hourly_linear_interpolation_v1');
});

test('weather adapter refuses to run without configured coordinates and surfaces provider errors', async () => {
  assert.throws(() => createOpenMeteoTemperatureAdapter({}), /weather_coordinates_required/);
  const adapter = createOpenMeteoTemperatureAdapter({
    latitude: 31.3,
    longitude: 120.6,
    locationId: 'suzhou-center-v1',
    fetch: async () => ({ ok: false, status: 429, async json() { return {}; } }),
    earliestDate: '2024-01-01',
    latestDate: '2026-07-30',
  });
  await assert.rejects(() => adapter.extract(null, {
    businessDate: '2026-07-30',
    capturedAt: '2026-09-03T10:00:00.000Z',
  }), (error) => error.code === 'rate_limited');
});
