import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

function rowKey(row = {}) {
  return `${String(row.date || '')}:${Number(row.pointIndex)}`;
}

function meaningfulEntries(row = {}) {
  return Object.entries(row).filter(([, value]) => value !== null && value !== '');
}

function sortedRows(rows = []) {
  return [...rows].sort((left, right) => {
    const dateCompare = String(left.date || '').localeCompare(String(right.date || ''));
    return dateCompare || Number(left.pointIndex || 0) - Number(right.pointIndex || 0);
  });
}

function normalizeHistory(value = {}) {
  const rows = sortedRows(Array.isArray(value.rows) ? value.rows : []);
  const dates = [...new Set(rows.map((row) => String(row.date || '')).filter(Boolean))].sort();
  return {
    version: 1,
    generatedAt: value.generatedAt || null,
    source: value.source || 'visible_page_history',
    rowCount: rows.length,
    dateCount: dates.length,
    dates,
    rows,
  };
}

export function mergeVisibleHistory(history = {}, snapshot = {}) {
  if (!snapshot.accepted || !Array.isArray(snapshot.rows) || !snapshot.rows.length) {
    return history;
  }

  const current = normalizeHistory(history);
  const byKey = new Map(current.rows.map((row) => [rowKey(row), { ...row }]));
  for (const row of snapshot.rows) {
    if (!row?.date || !Number.isFinite(Number(row.pointIndex))) continue;
    const key = rowKey(row);
    byKey.set(key, {
      ...(byKey.get(key) || {}),
      ...Object.fromEntries(meaningfulEntries(row)),
    });
  }

  return normalizeHistory({
    generatedAt: snapshot.generatedAt || new Date().toISOString(),
    source: snapshot.source || current.source,
    rows: [...byKey.values()],
  });
}

export async function writeVisibleHistoryAtomic(historyPath, history) {
  await mkdir(path.dirname(historyPath), { recursive: true });
  const tempPath = `${historyPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(normalizeHistory(history), null, 2)}\n`, 'utf8');
    await rename(tempPath, historyPath);
  } finally {
    await rm(tempPath, { force: true }).catch(() => {});
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function readVisibleHistory(historyPath, legacySnapshotPath = '') {
  const persisted = await readJson(historyPath);
  if (persisted) return normalizeHistory(persisted);

  const legacy = legacySnapshotPath ? await readJson(legacySnapshotPath) : null;
  const migrated = mergeVisibleHistory({}, legacy || {});
  if (migrated.rowCount > 0) {
    await writeVisibleHistoryAtomic(historyPath, migrated);
    return migrated;
  }
  return normalizeHistory({});
}
