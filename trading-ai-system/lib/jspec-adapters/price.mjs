import { createJspecAdapter } from '../jspec-page-adapter.mjs';

export function createPriceAdapter(options = {}) {
  return createJspecAdapter({
    id: 'price',
    sourceId: 'JSPEC-DAYAHEAD-USER',
    routeFragment: '/pxf-spotgoods-province-extranet/Dd2jyUserClearingResult/Dd2jyRqClearing',
    ...options,
    columns: [
      { fieldId: 'dayAheadUserPriceFinalYuanPerMwh', patterns: [/统一结算点电价最终结果|日前.*最终.*电价|日前价格|出清价格/i], unit: '元/MWh', required: true },
      { fieldId: 'dayAheadUserPriceTemporaryYuanPerMwh', patterns: [/统一结算点电价临时结果|日前.*临时.*电价/i], unit: '元/MWh' },
      { fieldId: 'dayAheadUserClearedPowerMw', patterns: [/出清电力|出清功率/i], unit: 'MW' },
      ...(options.columns || []),
    ],
    requiredFields: options.requiredFields || ['dayAheadUserPriceFinalYuanPerMwh'],
  });
}
