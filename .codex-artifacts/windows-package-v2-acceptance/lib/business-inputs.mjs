import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const BUSINESS_INPUT_FILES = {
  forecastLoad96: 'forecast-load-96.csv',
  position96: 'position-96.csv',
  tradeLimits: 'trade-limits.json',
};

function splitCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.map((value) => value.trim());
}

export function parseCsv(text = '') {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return [];
  }
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function numberOrNull(value) {
  if (value === '' || value === undefined || value === null) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizePointRow(row, numericFields) {
  const normalized = { ...row };
  normalized.pointIndex = numberOrNull(row.pointIndex);
  for (const field of numericFields) {
    normalized[field] = numberOrNull(row[field]);
  }
  return normalized;
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

async function readJsonIfExists(filePath) {
  const text = await readTextIfExists(filePath);
  if (!text.trim()) {
    return {};
  }
  return JSON.parse(text);
}

export async function readBusinessInputs(inputDir) {
  const forecastPath = path.join(inputDir, BUSINESS_INPUT_FILES.forecastLoad96);
  const positionPath = path.join(inputDir, BUSINESS_INPUT_FILES.position96);
  const limitsPath = path.join(inputDir, BUSINESS_INPUT_FILES.tradeLimits);
  const [forecastText, positionText, tradeLimits] = await Promise.all([
    readTextIfExists(forecastPath),
    readTextIfExists(positionPath),
    readJsonIfExists(limitsPath),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    templates: {
      forecastLoad96: forecastPath,
      position96: positionPath,
      tradeLimits: limitsPath,
    },
    forecastLoad96: {
      path: forecastPath,
      rows: parseCsv(forecastText).map((row) =>
        normalizePointRow(row, ['forecastKwh', 'confidence'])
      ),
    },
    position96: {
      path: positionPath,
      rows: parseCsv(positionText).map((row) =>
        normalizePointRow(row, [
          'availableBuyMwh',
          'availableSellMwh',
          'contractedMwh',
          'tradedMwh',
        ])
      ),
    },
    tradeLimits: {
      path: limitsPath,
      values: tradeLimits,
    },
  };
}

function hasConfiguredNumber(values, key) {
  return numberOrNull(values?.[key]) !== null;
}

export function summarizeBusinessInputs(inputs = {}) {
  const forecastRows = Array.isArray(inputs.forecastLoad96?.rows) ? inputs.forecastLoad96.rows : [];
  const positionRows = Array.isArray(inputs.position96?.rows) ? inputs.position96.rows : [];
  const limits = inputs.tradeLimits?.values || {};
  const limitsConfigured = [
    'minQuantityMwh',
    'maxDraftQuantityMwh',
    'buyPriceCeilingYuanPerMwh',
    'sellPriceFloorYuanPerMwh',
  ].some((key) => hasConfiguredNumber(limits, key));

  return {
    generatedAt: inputs.generatedAt || new Date().toISOString(),
    forecastLoad96: {
      rowCount: forecastRows.length,
      nonEmptyRows: forecastRows.filter((row) => row.forecastKwh !== null).length,
    },
    position96: {
      rowCount: positionRows.length,
      buyRows: positionRows.filter((row) => row.availableBuyMwh !== null).length,
      sellRows: positionRows.filter((row) => row.availableSellMwh !== null).length,
    },
    tradeLimits: {
      configured: limitsConfigured,
      keys: Object.keys(limits),
    },
    readyForDraftPrefill: forecastRows.length > 0 && positionRows.length > 0 && limitsConfigured,
  };
}
