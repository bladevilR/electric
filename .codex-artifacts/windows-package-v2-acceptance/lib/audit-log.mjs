import { randomUUID } from 'node:crypto';
import { mkdir, readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';

export async function appendAuditEvent(filePath, event = {}) {
  if (!filePath) {
    throw new Error('audit log path is required');
  }

  const entry = {
    id: event.id || randomUUID(),
    createdAt: event.createdAt || new Date().toISOString(),
    type: event.type || 'event',
    actor: event.actor || 'system',
    outcome: event.outcome || 'recorded',
    ...event,
  };

  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}

export async function readAuditLog(filePath, options = {}) {
  if (!filePath) {
    return [];
  }

  try {
    const text = await readFile(filePath, 'utf8');
    const events = text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const limit = Number(options.limit || 100);
    return events.slice(Math.max(0, events.length - limit));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
