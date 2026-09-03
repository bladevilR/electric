import { quantile } from './strategy-engine.mjs';

const PRICE_FIELD = 'dayAheadUserPriceFinalYuanPerMwh';
const TEMPERATURE_FIELD = 'temperatureForecastC';
const LOAD_FIELD = 'loadForecastMw';
const MIN_TRAINING_ROWS_PER_POINT = 5;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values, average) {
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2))) || 1;
}

function round(value) {
  return Number(value.toFixed(6));
}

function fitPoint(rows) {
  const prices = rows.map((row) => finite(row[PRICE_FIELD]));
  const temperatures = rows.map((row) => finite(row[TEMPERATURE_FIELD]));
  const loads = rows.map((row) => finite(row[LOAD_FIELD]));
  const priceMean = mean(prices);
  const temperatureMean = mean(temperatures);
  const loadMean = mean(loads);
  const temperatureScale = standardDeviation(temperatures, temperatureMean);
  const loadScale = standardDeviation(loads, loadMean);
  const xTemperature = temperatures.map((value) => (value - temperatureMean) / temperatureScale);
  const xLoad = loads.map((value) => (value - loadMean) / loadScale);
  const y = prices.map((value) => value - priceMean);
  const covariance = (left, right) => left.reduce((sum, value, index) => sum + value * right[index], 0);
  const ridge = 1e-6;
  const tt = covariance(xTemperature, xTemperature) + ridge;
  const ll = covariance(xLoad, xLoad) + ridge;
  const tl = covariance(xTemperature, xLoad);
  const ty = covariance(xTemperature, y);
  const ly = covariance(xLoad, y);
  const determinant = tt * ll - tl * tl;
  const betaTemperatureStandardized = determinant ? (ty * ll - ly * tl) / determinant : 0;
  const betaLoadStandardized = determinant ? (ly * tt - ty * tl) / determinant : 0;
  const predict = (temperature, load) => priceMean
    + betaTemperatureStandardized * ((temperature - temperatureMean) / temperatureScale)
    + betaLoadStandardized * ((load - loadMean) / loadScale);
  const residuals = rows.map((row) => finite(row[PRICE_FIELD]) - predict(
    finite(row[TEMPERATURE_FIELD]),
    finite(row[LOAD_FIELD]),
  ));

  return {
    priceMean,
    temperatureMean,
    loadMean,
    betaTemperature: betaTemperatureStandardized / temperatureScale,
    betaLoad: betaLoadStandardized / loadScale,
    residuals,
  };
}

export function buildEvidencePriceForecast({ rows = [], targetDate = '', expectedPointCount = 96 } = {}) {
  const pointIndices = Array.from({ length: expectedPointCount }, (_, index) => index + 1);
  const targetByPoint = new Map(rows
    .filter((row) => row.date === targetDate)
    .map((row) => [Number(row.pointIndex), row]));
  const missingInputs = pointIndices.flatMap((pointIndex) => {
    const target = targetByPoint.get(pointIndex) || {};
    const fields = [TEMPERATURE_FIELD, LOAD_FIELD].filter((field) => finite(target[field]) === null);
    return fields.length ? [{ pointIndex, fields }] : [];
  });
  if (missingInputs.length) {
    return { status: 'insufficient_inputs', targetDate, rows: [], missingInputs };
  }

  const forecastRows = [];
  const insufficientHistory = [];
  for (const pointIndex of pointIndices) {
    const history = rows.filter((row) => row.date < targetDate
      && Number(row.pointIndex) === pointIndex
      && [PRICE_FIELD, TEMPERATURE_FIELD, LOAD_FIELD].every((field) => finite(row[field]) !== null));
    if (history.length < MIN_TRAINING_ROWS_PER_POINT) {
      insufficientHistory.push({ pointIndex, availableRows: history.length, requiredRows: MIN_TRAINING_ROWS_PER_POINT });
      continue;
    }
    const fit = fitPoint(history);
    const target = targetByPoint.get(pointIndex);
    const temperatureDelta = finite(target[TEMPERATURE_FIELD]) - fit.temperatureMean;
    const loadDelta = finite(target[LOAD_FIELD]) - fit.loadMean;
    const temperatureContribution = fit.betaTemperature * temperatureDelta;
    const loadContribution = fit.betaLoad * loadDelta;
    const pointForecast = fit.priceMean + temperatureContribution + loadContribution;
    const lowerResidual = quantile(fit.residuals, 0.1) ?? 0;
    const upperResidual = quantile(fit.residuals, 0.9) ?? 0;
    forecastRows.push({
      pointIndex,
      pointForecast: round(pointForecast),
      p10: round(Math.min(pointForecast + lowerResidual, pointForecast)),
      p50: round(pointForecast),
      p90: round(Math.max(pointForecast + upperResidual, pointForecast)),
      inputCompletenessPct: 100,
      evidenceRows: history.length,
      inputs: {
        temperatureForecastC: finite(target[TEMPERATURE_FIELD]),
        loadForecastMw: finite(target[LOAD_FIELD]),
      },
      contributions: {
        slotBaselineYuanPerMwh: round(fit.priceMean),
        temperatureYuanPerMwh: round(temperatureContribution),
        loadYuanPerMwh: round(loadContribution),
      },
      coefficients: {
        temperatureYuanPerMwhPerC: round(fit.betaTemperature),
        loadYuanPerMwhPerMw: round(fit.betaLoad),
      },
    });
  }

  if (insufficientHistory.length) {
    return { status: 'insufficient_history', targetDate, rows: [], missingInputs: [], insufficientHistory };
  }
  return {
    status: 'ready',
    targetDate,
    modelId: 'interpretable_weather_load_ridge_v1',
    modelVersion: '1.0.0',
    rows: forecastRows,
    missingInputs: [],
    insufficientHistory: [],
    algorithm: {
      family: 'per_slot_standardized_ridge_regression',
      formula: 'price = slot_baseline + beta_temp * temp_delta + beta_load * load_delta',
      inputs: [PRICE_FIELD, TEMPERATURE_FIELD, LOAD_FIELD],
      forecastOnlyInputs: [TEMPERATURE_FIELD, LOAD_FIELD],
      safeguards: ['as_of_cutoff', 'no_actual_weather_as_feature', 'immutable_feature_snapshot'],
    },
  };
}
