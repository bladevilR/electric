import { createHash } from 'node:crypto';

import { CollectorAdapterError } from './jspec-page-adapter.mjs';

const PREVIOUS_RUNS_ENDPOINT = 'https://previous-runs-api.open-meteo.com/v1/forecast';
const ARCHIVE_ENDPOINT = 'https://archive-api.open-meteo.com/v1/archive';
const TIMEZONE = 'Asia/Shanghai';

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function assertDate(value, field) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) throw new Error(`${field}_invalid`);
  return String(value);
}

function previousDate(value) {
  return new Date(Date.parse(`${assertDate(value, 'business_date')}T00:00:00.000Z`) - 86400000).toISOString().slice(0, 10);
}

function buildUrl(endpoint, { latitude, longitude, businessDate, hourly }) {
  const parameters = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    start_date: businessDate,
    end_date: businessDate,
    hourly,
    timezone: TIMEZONE,
  });
  return `${endpoint}?${parameters}`;
}

function providerError(response) {
  const code = response?.status === 429 ? 'rate_limited' : 'weather_provider_error';
  return new CollectorAdapterError(code, `Weather provider returned HTTP ${response?.status || 'unknown'}.`);
}

async function fetchJson(fetch, url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response?.ok) throw providerError(response);
  return response.json();
}

function hourlySeries(payload, fieldId) {
  const times = payload?.hourly?.time;
  const values = payload?.hourly?.[fieldId];
  if (!Array.isArray(times) || !Array.isArray(values) || times.length !== values.length) {
    throw new CollectorAdapterError('weather_payload_invalid', `Weather payload is missing ${fieldId}.`);
  }
  return times.map((time, index) => ({ time: String(time), value: Number(values[index]) }))
    .filter((row) => Number.isFinite(row.value));
}

function interpolateDay(series, businessDate) {
  const byHour = new Map(series
    .filter((row) => row.time.startsWith(`${businessDate}T`))
    .map((row) => [Number(row.time.slice(11, 13)), row.value]));
  if (byHour.size < 24) {
    throw new CollectorAdapterError('coverage_incomplete', `Weather source returned ${byHour.size}/24 hourly points.`, {
      expectedHourlyPoints: 24,
      actualHourlyPoints: byHour.size,
    });
  }
  const values = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const current = byHour.get(hour);
    const following = byHour.get(hour + 1) ?? current;
    for (let quarter = 1; quarter <= 4; quarter += 1) {
      const interpolated = current + (following - current) * quarter / 4;
      values.push(Math.round(interpolated * 10000) / 10000);
    }
  }
  return values;
}

function forecastAvailableAt(businessDate, pointIndex, leadHours) {
  const targetMinutes = pointIndex * 15;
  const target = Date.parse(`${businessDate}T00:00:00+08:00`) + targetMinutes * 60000;
  return new Date(target - leadHours * 3600000).toISOString();
}

export function createOpenMeteoTemperatureAdapter(options = {}) {
  const latitude = Number(options.latitude);
  const longitude = Number(options.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error('weather_coordinates_required');
  }
  const locationId = String(options.locationId || '').trim();
  if (!locationId) throw new Error('weather_location_id_required');
  const fetch = options.fetch || globalThis.fetch;
  if (typeof fetch !== 'function') throw new Error('weather_fetch_required');
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString();
  const earliestDate = assertDate(options.earliestDate || '2024-01-01', 'earliest_date');
  const latestDate = assertDate(options.latestDate || previousDate(clock().slice(0, 10)), 'latest_date');
  const forecastLeadHours = Number(options.forecastLeadHours || 24);
  const previousRunsEndpoint = String(options.previousRunsEndpoint || PREVIOUS_RUNS_ENDPOINT);
  const archiveEndpoint = String(options.archiveEndpoint || ARCHIVE_ENDPOINT);
  if (![24, 48, 72, 96, 120, 144, 168].includes(forecastLeadHours)) throw new Error('weather_forecast_lead_invalid');
  const leadDays = forecastLeadHours / 24;
  const forecastField = `temperature_2m_previous_day${leadDays}`;
  const sourceId = `OPEN-METEO-PREVIOUS-RUNS:${locationId}`;
  let selectedDate = null;

  async function discoverBounds() {
    return { earliestDate, latestDate };
  }

  async function setQuery(_page, query = {}) {
    selectedDate = assertDate(query.businessDate, 'business_date');
    return { businessDate: selectedDate };
  }

  async function extract(_page, input = {}) {
    const businessDate = assertDate(input.businessDate || selectedDate, 'business_date');
    const capturedAt = input.capturedAt || clock();
    const forecastUrl = buildUrl(previousRunsEndpoint, {
      latitude,
      longitude,
      businessDate,
      hourly: forecastField,
    });
    const actualUrl = buildUrl(archiveEndpoint, {
      latitude,
      longitude,
      businessDate,
      hourly: 'temperature_2m',
    });
    const [forecastPayload, actualPayload] = await Promise.all([
      fetchJson(fetch, forecastUrl),
      fetchJson(fetch, actualUrl),
    ]);
    const forecastValues = interpolateDay(hourlySeries(forecastPayload, forecastField), businessDate);
    const actualValues = interpolateDay(hourlySeries(actualPayload, 'temperature_2m'), businessDate);
    const forecastRevision = `open-meteo:previous-day${leadDays}:${sha256(forecastPayload)}`;
    const actualRevision = `open-meteo:archive:${sha256(actualPayload)}`;
    const facts = [];
    for (let pointIndex = 1; pointIndex <= 96; pointIndex += 1) {
      facts.push({
        sourceId,
        fieldId: 'temperatureForecastC',
        businessDate,
        pointIndex,
        value: forecastValues[pointIndex - 1],
        unit: '°C',
        availableAt: forecastAvailableAt(businessDate, pointIndex, forecastLeadHours),
        capturedAt,
        sourceRevision: forecastRevision,
      });
      facts.push({
        sourceId: `OPEN-METEO-ARCHIVE:${locationId}`,
        fieldId: 'temperatureActualC',
        businessDate,
        pointIndex,
        value: actualValues[pointIndex - 1],
        unit: '°C',
        availableAt: capturedAt,
        capturedAt,
        sourceRevision: actualRevision,
      });
    }
    const structureFingerprint = sha256(`${forecastField}|temperature_2m|${TIMEZONE}|hourly_linear_interpolation_v1`);
    const contentSha256 = sha256(`${sha256(forecastPayload)}|${sha256(actualPayload)}`);
    return {
      adapterId: 'weather',
      sourceId,
      pageUrl: forecastUrl,
      pageTitle: 'Open-Meteo Previous Runs and Historical Weather',
      queryDate: businessDate,
      headers: [forecastField, 'temperature_2m'],
      mappedFields: ['temperatureForecastC', 'temperatureActualC'],
      facts,
      structureFingerprint,
      contentSha256,
      capturedAt,
      evidence: {
        provider: 'Open-Meteo',
        locationId,
        latitude,
        longitude,
        timezone: TIMEZONE,
        forecastLeadHours,
        forecastVariable: forecastField,
        actualVariable: 'temperature_2m',
        alignmentMethod: 'hourly_linear_interpolation_v1',
        forecastUrl,
        actualUrl,
      },
    };
  }

  function validate(result = {}, query = {}) {
    const businessDate = assertDate(query.businessDate, 'business_date');
    if (result.queryDate !== businessDate) throw new CollectorAdapterError('query_date_mismatch', 'Weather query date mismatch.');
    const coverageByField = Object.fromEntries(['temperatureForecastC', 'temperatureActualC'].map((fieldId) => [
      fieldId,
      new Set((result.facts || []).filter((fact) => fact.fieldId === fieldId).map((fact) => fact.pointIndex)).size,
    ]));
    if (coverageByField.temperatureForecastC !== 96 || coverageByField.temperatureActualC !== 96) {
      throw new CollectorAdapterError('coverage_incomplete', 'Weather forecast and actual must both contain 96 aligned points.', { coverageByField });
    }
    return { ...result, accepted: true, coverageByField };
  }

  return {
    id: 'weather',
    kind: 'remote_weather',
    sourceId,
    expectedPointCount: 96,
    async detect() { return { state: 'ready' }; },
    async navigate() {},
    discoverBounds,
    setQuery,
    async submit() {},
    async waitForResult() {},
    extract,
    validate,
    async nextPage() { return false; },
    async fingerprint() { return sha256(`${locationId}|${forecastLeadHours}|hourly_linear_interpolation_v1`); },
  };
}

export { PREVIOUS_RUNS_ENDPOINT, ARCHIVE_ENDPOINT };
