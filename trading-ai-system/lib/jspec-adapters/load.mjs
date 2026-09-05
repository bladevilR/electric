import { CollectorAdapterError, createJspecAdapter } from '../jspec-page-adapter.mjs';

export function createLoadAdapter(options = {}) {
  const adapter = createJspecAdapter({
    id: 'load',
    sourceId: 'JSPEC-LOAD',
    routeFragment: '/pxf-js-outer-deferrableload/dayElectricity',
    fillAllDateInputs: true,
    ...options,
    columns: [
      { fieldId: 'actualLoadMw', patterns: [/(?:实际负荷|平均负荷|实际功率).*(?:\bMW\b|兆瓦(?!时))/i], unit: 'MW' },
      { fieldId: 'actualKwh', patterns: [/(?:实际电量|实际用电|电量).*(?:\bkWh\b|(?<!万)千瓦时)/i], unit: 'kWh' },
      { fieldId: 'actualMwh', patterns: [/(?:实际电量|实际用电|电量).*(?:\bMWh\b|兆瓦时)/i], unit: 'MWh' },
      { fieldId: 'loadForecastMw', patterns: [/^(?!.*系统).*(?:负荷预测|预测负荷).*(?:\bMW\b|兆瓦(?!时))/i], unit: 'MW' },
      ...(options.columns || []),
    ],
    requiredFields: options.requiredFields || [],
  });
  return {
    ...adapter,
    validate(result, query) {
      const checked = adapter.validate(result, query);
      const actualUnits = {actualKwh:'kWh',actualMwh:'MWh',actualLoadMw:'MW'};
      const actualFields = Object.keys(actualUnits).filter((field) => checked.mappedFields.includes(field));
      if (!actualFields.length) throw new CollectorAdapterError('required_actual_column_missing', 'No actual electricity or actual load column was found.');
      if (checked.facts.some(fact => actualFields.includes(fact.fieldId) && (!Number.isInteger(fact.pointIndex) || fact.pointIndex < 1 || fact.pointIndex > adapter.expectedPointCount || fact.value == null || fact.value === '' || !Number.isFinite(Number(fact.value)) || Number(fact.value) < 0 || fact.unit !== actualUnits[fact.fieldId]))) {
        throw new CollectorAdapterError('invalid_actual_load', 'invalid_actual_load: actual values require valid points, nonnegative numbers and confirmed units.');
      }
      if (!actualFields.some((field) => checked.coverageByField[field] === adapter.expectedPointCount)) {
        throw new CollectorAdapterError('coverage_incomplete', `Actual load requires ${adapter.expectedPointCount} unique points.`, { coverageByField: checked.coverageByField });
      }
      const energyField=['actualKwh','actualMwh'].find(field=>checked.coverageByField[field]===96);
      if (checked.intervalMinutes===15 && energyField) {
        const divisor=energyField==='actualKwh'?250:0.25;
        return {...checked,mappedFields:[...checked.mappedFields,'actualAverageLoadMw'],coverageByField:{...checked.coverageByField,actualAverageLoadMw:96},
          facts:[...checked.facts,...checked.facts.filter(f=>f.fieldId===energyField).map(f=>({...f,fieldId:'actualAverageLoadMw',value:Number((f.value/divisor).toFixed(9)),unit:'MW'}))],
          evidence:{...checked.evidence,intervalMinutes:15,conversion:energyField==='actualKwh'?'MW = kWh / 1000 / 0.25':'MW = MWh / 0.25',availabilityBasis:'first_observed_time',sourceField:energyField}};
      }
      return checked;
    },
  };
}
