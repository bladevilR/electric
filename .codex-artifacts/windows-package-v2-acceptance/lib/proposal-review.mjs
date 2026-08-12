import { appendAuditEvent } from './audit-log.mjs';

const DECISIONS = new Set(['accepted', 'rejected', 'modified']);

export async function createProposalReview(options = {}) {
  const decision = options.decision || '';
  if (!DECISIONS.has(decision)) {
    throw new Error(`unsupported review decision: ${decision}`);
  }

  const review = {
    generatedAt: new Date().toISOString(),
    proposalId: options.proposalId || '',
    date: options.date || '',
    decision,
    reviewer: options.reviewer || 'local-reviewer',
    note: options.note || '',
    autoSubmit: false,
    submittedToPlatform: false,
  };

  await appendAuditEvent(options.auditPath, {
    type: 'proposal_review_recorded',
    actor: review.reviewer,
    outcome: decision,
    proposalId: review.proposalId,
    date: review.date,
    decision,
    note: review.note,
    autoSubmit: false,
    submittedToPlatform: false,
  });

  return review;
}
