import { createJspecAdapter } from '../jspec-page-adapter.mjs';

export function createLoadAdapter(options = {}) {
  return createJspecAdapter({
    id: 'load',
    sourceId: 'JSPEC-LOAD',
    routeFragment: '/pxf-js-outer-deferrableload/dayElectricity',
    fillAllDateInputs: true,
    ...options,
    columns: [
      { fieldId: 'actualLoadMw', patterns: [/实际负荷.*MW|平均负荷|实际功率/i], unit: 'MW' },
      { fieldId: 'actualKwh', patterns: [/实际电量|实际用电|电量.*kWh/i], unit: 'kWh' },
      { fieldId: 'loadForecastMw', patterns: [/负荷预测|预测负荷|系统负荷预测/i], unit: 'MW', required: true },
      ...(options.columns || []),
    ],
    requiredFields: options.requiredFields || ['loadForecastMw'],
  });
}
