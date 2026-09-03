import { readFile } from 'node:fs/promises';

export const SOURCE_STATUSES = new Set([
  'confirmed_visible', 'confirmed_export', 'code_supported', 'captured_nonempty',
  'captured_empty', 'page_visible_code_missing', 'pending_field_confirmation',
  'pending_authorization', 'mock_only', 'derived', 'unavailable'
]);

const SECRET_KEY_PATTERN = /cookie|token|authorization|pin|private[_ -]?key|password/i;

function validateRegistry(registry) {
  if (!registry || !Number.isInteger(registry.version) || !Array.isArray(registry.sources)) {
    throw new Error('source_registry_invalid');
  }
  const ids = new Set();
  for (const source of registry.sources) {
    if (!source?.sourceId) throw new Error('source_id_missing');
    if (ids.has(source.sourceId)) throw new Error(`duplicate_source_id:${source.sourceId}`);
    ids.add(source.sourceId);
    if (!SOURCE_STATUSES.has(source.status)) throw new Error(`unknown_source_status:${source.status}`);
    if (source.containsCredentials !== false) throw new Error(`contains_credentials_must_be_false:${source.sourceId}`);
    for (const key of Object.keys(source)) {
      if (SECRET_KEY_PATTERN.test(key)) throw new Error(`credential_property_forbidden:${source.sourceId}`);
    }
  }
  return registry;
}

export async function loadDataSourceRegistry(filePath) {
  return validateRegistry(JSON.parse(await readFile(filePath, 'utf8')));
}

export function getDataSource(registry, sourceId) {
  return registry?.sources?.find((source) => source.sourceId === sourceId) ?? null;
}
