import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadDataSourceRegistry, getDataSource } from '../lib/data-source-registry.mjs';

const root = path.resolve(import.meta.dirname, '..');

test('registry contains every P0/P1 source and never embeds secrets', async () => {
  const registry = await loadDataSourceRegistry(path.join(root, 'config/data-sources.json'));
  const required = [
    'JSPEC-P0-1', 'JSPEC-P0-2', 'JSPEC-P0-3', 'JSPEC-P0-4', 'JSPEC-P0-5', 'JSPEC-P0-6', 'JSPEC-P0-7', 'JSPEC-P0-8',
    'JSPEC-P1-1', 'JSPEC-P1-2', 'JSPEC-P1-3'
  ];
  required.forEach((id) => assert.ok(getDataSource(registry, id), id));
  assert.doesNotMatch(JSON.stringify(registry), /"(?:cookie|token|authorization|pin|private[_ -]?key|password)"\s*:/i);
  assert.doesNotMatch(JSON.stringify(registry.sources.flatMap((source) => source.routeHints)), /[?&](?:ticket|token|code|session)=/i);
});

test('registry rejects duplicate sources, unknown statuses and credential-bearing definitions', async () => {
  const invalidPath = path.join(root, 'test', 'fixtures', 'invalid-data-sources.json');
  await assert.rejects(loadDataSourceRegistry(invalidPath), /duplicate_source_id|unknown_source_status|contains_credentials_must_be_false/);
});
