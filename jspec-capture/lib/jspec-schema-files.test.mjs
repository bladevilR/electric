import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const schemaDir = fileURLToPath(new URL('../../src/electric/jspec/schemas/', import.meta.url));

async function readSchema(name) {
  return JSON.parse(await readFile(path.join(schemaDir, name), 'utf8'));
}

test('manual export fact table schemas are valid JSON with traceability fields', async () => {
  const expectations = {
    'energy_block_trades.schema.json': [
      'trade_date',
      'execution_date',
      'trade_hour',
      'direction',
      'quantity_mwh',
      'price_yuan_per_mwh',
      'source_file',
      'exported_at',
      'parsed_at',
      'parser_version',
      'contains_credentials',
    ],
    'energy_block_limits.schema.json': [
      'trade_date',
      'execution_date',
      'trade_hour',
      'available_buy_mwh',
      'available_sell_mwh',
      'source_file',
      'exported_at',
      'parsed_at',
      'parser_version',
      'contains_credentials',
    ],
    'position_curve.schema.json': [
      'execution_date',
      'position_mwh',
      'source_file',
      'exported_at',
      'parsed_at',
      'parser_version',
      'contains_credentials',
    ],
  };

  for (const [fileName, requiredFields] of Object.entries(expectations)) {
    const schema = await readSchema(fileName);
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false);
    for (const field of requiredFields) {
      assert.ok(schema.required.includes(field), `${fileName} should require ${field}`);
      assert.ok(schema.properties[field], `${fileName} should define ${field}`);
    }
  }
});

test('standard 96 schema requires source traceability and quarter-hour identity', async () => {
  const schema = await readSchema('standard_96.schema.json');

  assert.equal(schema.type, 'object');
  for (const field of [
    'session_id',
    'source_type',
    'point_index',
    'time_point',
    'metric',
    'value',
    'unit',
    'raw_field',
    'source_file',
    'captured_at',
    'parsed_at',
    'parser_version',
    'contains_credentials',
  ]) {
    assert.ok(schema.required.includes(field), `standard_96 should require ${field}`);
    assert.ok(schema.properties[field], `standard_96 should define ${field}`);
  }

  assert.deepEqual(schema.properties.point_index.minimum, 1);
  assert.deepEqual(schema.properties.point_index.maximum, 96);
});
