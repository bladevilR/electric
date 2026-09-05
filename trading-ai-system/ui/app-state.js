let state={},listeners=new Set();export function createAppState(initial={}){state={...initial};return state;}export function subscribeAppState(listener){listeners.add(listener);return()=>listeners.delete(listener);}export function updateAppState(patch){state={...state,...patch};for(const listener of listeners)listener(state);return state;}

const FOUNDATION_TABS = new Set(['price', 'temperature', 'load']);
const FOUNDATION_EXPLANATIONS = new Set([
  'mae',
  'rmse',
  'mape',
  'baselineSkill',
  'sources',
  'quality',
  'forecasts',
  'fusion',
  'optimizer',
  'risk',
  'review',
]);
const FOUNDATION_CONTROLS = new Set(['priceWeight', 'temperatureWeight', 'loadWeight']);
const FOUNDATION_RISK_PROFILES = new Set(['conservative', 'balanced', 'active']);

const clampControl = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
};

export function createFoundationUiState(overrides = {}) {
  return {
    activeForecastTab: 'price',
    explanation: '',
    provenanceOpen: false,
    returnFocusSelector: '',
    sandboxControls: {
      priceWeight: 0.7,
      temperatureWeight: 0.5,
      loadWeight: 0.6,
      riskProfile: 'balanced',
    },
    simulationApplied: false,
    ...overrides,
    sandboxControls: {
      priceWeight: 0.7,
      temperatureWeight: 0.5,
      loadWeight: 0.6,
      riskProfile: 'balanced',
      ...(overrides.sandboxControls || {}),
    },
  };
}

export function reduceFoundationUiState(current = createFoundationUiState(), action = {}) {
  if (action.type === 'select_tab' && FOUNDATION_TABS.has(action.id)) {
    return { ...current, activeForecastTab: action.id };
  }
  if (action.type === 'open_provenance') {
    return {
      ...current,
      explanation: '',
      provenanceOpen: true,
      returnFocusSelector: action.triggerSelector || current.returnFocusSelector,
    };
  }
  if (action.type === 'open_explanation' && FOUNDATION_EXPLANATIONS.has(action.id)) {
    return {
      ...current,
      explanation: action.id,
      provenanceOpen: false,
      returnFocusSelector: action.triggerSelector || current.returnFocusSelector,
    };
  }
  if (action.type === 'close_disclosure') {
    return { ...current, explanation: '', provenanceOpen: false };
  }
  if (action.type === 'set_control' && FOUNDATION_CONTROLS.has(action.id)) {
    return {
      ...current,
      simulationApplied: false,
      sandboxControls: {
        ...current.sandboxControls,
        [action.id]: clampControl(action.value),
      },
    };
  }
  if (action.type === 'set_risk' && FOUNDATION_RISK_PROFILES.has(action.id)) {
    return {
      ...current,
      simulationApplied: false,
      sandboxControls: { ...current.sandboxControls, riskProfile: action.id },
    };
  }
  if (action.type === 'reset_controls') {
    return {
      ...createFoundationUiState(),
      activeForecastTab: current.activeForecastTab,
      returnFocusSelector: current.returnFocusSelector,
    };
  }
  if (action.type === 'apply_simulation') {
    return { ...current, simulationApplied: true };
  }
  return current;
}
