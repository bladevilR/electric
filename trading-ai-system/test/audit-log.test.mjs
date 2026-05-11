import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { appendAuditEvent, readAuditLog } from '../lib/audit-log.mjs';

test('appendAuditEvent writes append-only ndjson entries', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'trading-audit-'));
  const auditPath = path.join(temp, 'audit-log.ndjson');

  try {
    const first = await appendAuditEvent(auditPath, {
      type: 'readiness_checked',
      actor: 'system',
      outcome: 'blocked',
    });
    const second = await appendAuditEvent(auditPath, {
      type: 'execution_proposal_created',
      actor: 'operator',
      outcome: 'blocked',
    });

    const events = await readAuditLog(auditPath);
    assert.equal(events.length, 2);
    assert.equal(events[0].id, first.id);
    assert.equal(events[1].id, second.id);
    assert.equal(events[1].type, 'execution_proposal_created');
    assert.ok(events[1].createdAt);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('readAuditLog returns newest limited entries and tolerates missing file', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'trading-audit-'));
  const auditPath = path.join(temp, 'audit-log.ndjson');

  try {
    assert.deepEqual(await readAuditLog(auditPath), []);
    await appendAuditEvent(auditPath, { type: 'one', actor: 'system', outcome: 'ok' });
    await appendAuditEvent(auditPath, { type: 'two', actor: 'system', outcome: 'ok' });

    const events = await readAuditLog(auditPath, { limit: 1 });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'two');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
