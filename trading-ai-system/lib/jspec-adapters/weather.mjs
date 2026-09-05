import { createJspecAdapter } from '../jspec-page-adapter.mjs';

export function createWeatherAdapter(options = {}) {
  return createJspecAdapter({
    id: 'weather',
    sourceId: options.sourceId || 'WEATHER-CONFIGURED',
    routeFragment: options.routeFragment || '',
    ...options,
    columns: [
      { fieldId: 'temperatureForecastC', patterns: [/预测温度|温度预测|预报气温|forecast.*temperature/i], unit: '°C', required: true },
      { fieldId: 'temperatureActualC', patterns: [/实际温度|实况温度|实际气温|actual.*temperature/i], unit: '°C' },
      ...(options.columns || []),
    ],
    requiredFields: options.requiredFields || ['temperatureForecastC'],
  });
}
