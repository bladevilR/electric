const numeric = (value) => value === null || value === '' || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
export function deriveMarketContext(rows = [], config = {}) {
  const formulaVersion = config.formulaVersion || 'market-context-v1';
  return rows.map((input) => {
    const r = input.fields ? { ...input, ...input.fields } : input, flags = [];
    const load = numeric(r.systemLoadForecastMw), wind = numeric(r.windForecastMw), solar = numeric(r.solarForecastMw), imported = numeric(r.interchangeScheduledImportMw ?? r.interchangeScheduledMw);
    const renewableKnown = wind !== null && solar !== null; if (!renewableKnown) flags.push('renewable_forecast_missing');
    const convention = config.interchangeConvention || (config.interchangePositiveMeansImport ? 'positive_import' : 'positive_export');
    const net = load !== null && renewableKnown && imported !== null ? load - wind - solar - (convention === 'positive_import' ? imported : -imported) : null;
    const capacity = numeric(r.availableCapacityMw); if (capacity === null) flags.push('available_capacity_missing');
    const flow = numeric(r.sectionFlowMw), limit = flow === null ? null : numeric(flow >= 0 ? r.sectionForwardLimitMw : r.sectionReverseLimitMw);
    const real = numeric(r.realTimeWeightedAveragePriceYuanPerMwh), dayAhead = numeric(r.dayAheadPublicPriceYuanPerMwh);
    return { ...input, netLoadForecastMw: net, supplyTightnessRatio: net !== null && capacity > 0 ? net / capacity : null, reserveMarginPct: load > 0 && capacity !== null ? 100 * (capacity - load) / load : null, rampPressureRatio: numeric(r.loadRampMw) !== null && numeric(r.rampCapabilityMw) > 0 ? numeric(r.loadRampMw) / numeric(r.rampCapabilityMw) : null, sectionUtilizationPct: flow !== null && limit > 0 ? Math.abs(flow) / limit * 100 : null, weatherTemperatureAnomalyC: numeric(r.temperatureC) !== null && numeric(r.normalTemperatureC) !== null ? numeric(r.temperatureC) - numeric(r.normalTemperatureC) : null, realTimeSpreadYuanPerMwh: real !== null && dayAhead !== null ? real - dayAhead : null, formulaVersion, inputFactIds: [...(input.selectedFactIds || [])], qualityFlags: flags };
  });
}
