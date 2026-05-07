import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStandardDataset,
  csvEscape,
  normalizeNumeric,
  pointIndexToTimeLabel,
} from './standard-96.mjs';

function capture({ id, data, request = {}, index = 1, fileName = `${id}.json` }) {
  return {
    fileName,
    meta: {
      index,
      requestBodyJson: request,
      capturedAt: '2026-05-07T02:00:00.000Z',
    },
    businessTarget: { id },
    bodyJson: { status: 200, message: 'ok', data },
  };
}

test('pointIndexToTimeLabel maps 96 quarter-hour points', () => {
  assert.equal(pointIndexToTimeLabel(1), '00:15');
  assert.equal(pointIndexToTimeLabel(4), '01:00');
  assert.equal(pointIndexToTimeLabel(96), '24:00');
  assert.throws(() => pointIndexToTimeLabel(0), /1\.\.96/);
});

test('normalizeNumeric accepts JSPEC numeric strings and blanks', () => {
  assert.equal(normalizeNumeric('35.5'), 35.5);
  assert.equal(normalizeNumeric(' 1,234.50 '), 1234.5);
  assert.equal(normalizeNumeric('-'), null);
  assert.equal(normalizeNumeric(''), null);
  assert.equal(normalizeNumeric(null), null);
});

test('buildStandardDataset merges declaration and price captures by date and point', () => {
  const dataset = buildStandardDataset([
    capture({
      id: 'user_default_bid_96',
      index: 1,
      request: { dataTime: '2026-05-08', participantId: 'P1' },
      data: {
        participantId: 'P1',
        mosDeratePendParamList: [
          { timeSlot: '00:15', power: '35.5' },
          { timeSlot: '00:30', power: '34.0' },
        ],
      },
    }),
    capture({
      id: 'realtime_average_price',
      index: 2,
      request: { dataTime: '2026-05-07' },
      data: [
        { timePoint: '00:15', avgPrice: 322.4, pointPriceCurrent: '330.1' },
        { timePoint: '00:30', avgPrice: '-' },
      ],
    }),
    capture({
      id: 'dayahead_public_clearing',
      index: 3,
      request: { dataTime: '2026-05-08' },
      data: [{ timePoint: '00:15', unitPrice: '410.6', clearingPower: '1000' }],
    }),
  ]);

  assert.equal(dataset.rows.length, 4);
  assert.equal(dataset.rows[0].date, '2026-05-07');
  assert.equal(dataset.rows[0].timePoint, '00:15');
  assert.equal(dataset.rows[0].realTimeAvgPrice, 322.4);
  assert.equal(dataset.rows[0].realTimePointPriceCurrent, 330.1);

  const defaultRow = dataset.rows.find(
    (row) => row.date === '2026-05-08' && row.timePoint === '00:15'
  );
  assert.equal(defaultRow.defaultDeclarationPower, 35.5);
  assert.equal(defaultRow.dayAheadPublicPrice, 410.6);
  assert.equal(defaultRow.dayAheadPublicClearingPower, 1000);
});

test('buildStandardDataset reports empty actual-load rows as a data gap', () => {
  const dataset = buildStandardDataset([
    capture({
      id: 'actual_load_96',
      request: { startDate: '2026-05-01', endDate: '2026-05-07' },
      data: {
        listTableHead: [{ prop: 'point1', label: '0:15(kWh)' }],
        list: [],
      },
    }),
  ]);

  assert.equal(dataset.rows.length, 0);
  assert.equal(dataset.sources.actual_load_96.rows, 0);
  assert.ok(dataset.quality.gaps.some((gap) => gap.id === 'actual_load_96_empty'));
});

test('buildStandardDataset expands wide actual-load point columns', () => {
  const dataset = buildStandardDataset([
    capture({
      id: 'actual_load_96',
      request: { startDate: '2026-05-06', endDate: '2026-05-06' },
      data: {
        listTableHead: [
          { prop: 'point1', label: '0:15(kWh)' },
          { prop: 'point2', label: '0:30(kWh)' },
        ],
        list: [{ dataDate: '2026-05-06', point1: '12.5', point2: '13' }],
      },
    }),
  ]);

  assert.equal(dataset.rows.length, 2);
  assert.equal(dataset.rows[0].actualKwh, 12.5);
  assert.equal(dataset.rows[1].timePoint, '00:30');
  assert.equal(dataset.rows[1].actualKwh, 13);
});

test('csvEscape creates safe CSV cells', () => {
  assert.equal(csvEscape('plain'), 'plain');
  assert.equal(csvEscape('a,b'), '"a,b"');
  assert.equal(csvEscape('"quoted"'), '"""quoted"""');
  assert.equal(csvEscape(null), '');
});
