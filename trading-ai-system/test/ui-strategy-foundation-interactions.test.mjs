import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createFoundationUiState,
  reduceFoundationUiState,
} from '../ui/app-state.js';

test('foundation UI switches tabs and keeps only one side disclosure open', () => {
  let state = createFoundationUiState();
  state = reduceFoundationUiState(state, { type: 'open_provenance' });
  assert.equal(state.provenanceOpen, true);
  assert.equal(state.explanation, '');

  state = reduceFoundationUiState(state, { type: 'open_explanation', id: 'optimizer' });
  assert.equal(state.provenanceOpen, false);
  assert.equal(state.explanation, 'optimizer');

  state = reduceFoundationUiState(state, { type: 'select_tab', id: 'load' });
  assert.equal(state.activeForecastTab, 'load');
});

test('foundation UI rejects unknown tabs and explanations', () => {
  const state = createFoundationUiState();
  assert.deepEqual(
    reduceFoundationUiState(state, { type: 'select_tab', id: 'profit' }),
    state
  );
  assert.deepEqual(
    reduceFoundationUiState(state, { type: 'open_explanation', id: 'secret-model' }),
    state
  );
});

test('foundation UI clamps sandbox controls and restores recommended defaults', () => {
  let state = createFoundationUiState();
  state = reduceFoundationUiState(state, {
    type: 'set_control',
    id: 'priceWeight',
    value: 9,
  });
  assert.equal(state.sandboxControls.priceWeight, 1);
  state = reduceFoundationUiState(state, {
    type: 'set_control',
    id: 'temperatureWeight',
    value: -4,
  });
  assert.equal(state.sandboxControls.temperatureWeight, 0);
  state = reduceFoundationUiState(state, { type: 'set_risk', id: 'active' });
  assert.equal(state.sandboxControls.riskProfile, 'active');
  state = reduceFoundationUiState(state, { type: 'reset_controls' });
  assert.deepEqual(state.sandboxControls, createFoundationUiState().sandboxControls);
});

test('closing a disclosure preserves the trigger selector for focus restoration', () => {
  let state = createFoundationUiState();
  state = reduceFoundationUiState(state, {
    type: 'open_explanation',
    id: 'mape',
    triggerSelector: '[data-explanation-id="mape"]',
  });
  state = reduceFoundationUiState(state, { type: 'close_disclosure' });

  assert.equal(state.explanation, '');
  assert.equal(state.provenanceOpen, false);
  assert.equal(state.returnFocusSelector, '[data-explanation-id="mape"]');
});
