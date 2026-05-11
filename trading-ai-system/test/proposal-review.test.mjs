import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { readAuditLog } from '../lib/audit-log.mjs';
import { createProposalReview } from '../lib/proposal-review.mjs';

test('createProposalReview records human decision without submission', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'trading-review-'));
  const auditPath = path.join(temp, 'audit-log.ndjson');

  try {
    const review = await createProposalReview({
      auditPath,
      proposalId: 'draft-20260507',
      date: '2026-05-07',
      decision: 'accepted',
      reviewer: 'reviewer-a',
      note: '人工确认后进入平台手工填报。',
    });

    assert.equal(review.decision, 'accepted');
    assert.equal(review.autoSubmit, false);
    assert.equal(review.submittedToPlatform, false);

    const events = await readAuditLog(auditPath);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'proposal_review_recorded');
    assert.equal(events[0].decision, 'accepted');
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('createProposalReview rejects unsupported decisions', async () => {
  await assert.rejects(
    () =>
      createProposalReview({
        auditPath: 'E:/tmp/audit-log.ndjson',
        proposalId: 'draft-1',
        decision: 'auto_submit',
        reviewer: 'reviewer-a',
      }),
    /unsupported review decision/
  );
});
