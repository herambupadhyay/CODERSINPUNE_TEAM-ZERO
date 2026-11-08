export type Confidence = 'verified' | 'uncertain' | 'conflicting'

export type Finding = {
  id: string
  type: 'decision' | 'task' | 'risk' | 'dependency' | 'evidence'
  title: string
  body: string
  confidence: Confidence
  sources: string[]
}

export const HANDOVER_PROJECT = {
  name: 'Payments Platform',
  window: 'Handover window · 12 – 26 Mar',
  from: 'From: A. Rahman (Backend Lead)',
  to: 'To: L. Okafor (Successor)',
  status: 'Awaiting review',
}

export const FINDINGS: Finding[] = [
  {
    id: 'd1',
    type: 'decision',
    title: 'PostgreSQL selected for transactional data storage',
    body: 'The architecture group chose PostgreSQL over MySQL for JSONB flexibility and migration tooling. Scoped to the payments transaction ledger only.',
    confidence: 'verified',
    sources: ['Meeting Notes — Section 3', 'Technical Plan — Page 5'],
  },
  {
    id: 'd2',
    type: 'decision',
    title: 'Refund flow deferred to Phase 2',
    body: 'Recorded in the sprint review but absent from the technical plan. Treat as provisional until the project head confirms.',
    confidence: 'uncertain',
    sources: ['Meeting Notes — Section 5'],
  },
  {
    id: 't1',
    type: 'task',
    title: 'Payment migration scripts need final testing',
    body: '14 of 18 migration cases pass. Remaining cases cover partial captures and currency rounding. Owner: Backend Team. Blocked on staging environment access.',
    confidence: 'verified',
    sources: ['Task export PP-142', 'Sprint 14 board'],
  },
  {
    id: 't2',
    type: 'task',
    title: 'Update API contract examples for v3 endpoints',
    body: 'Marked in progress on the board; no linked commit or document found. Ownership unclear after departure.',
    confidence: 'uncertain',
    sources: ['Task export PP-151'],
  },
  {
    id: 'r1',
    type: 'risk',
    title: 'No documented rollback procedure found',
    body: 'The runbook references a rollback procedure in §4, but the procedure itself does not exist in any uploaded source. Escalate before migration sign-off.',
    confidence: 'conflicting',
    sources: ['Runbook — §4 (missing target)', 'Repository search — 0 matches'],
  },
  {
    id: 'r2',
    type: 'risk',
    title: 'Staging environment access expires on 24 Mar',
    body: 'Access is registered to the departing lead. Renewal requires the team lead’s approval.',
    confidence: 'verified',
    sources: ['Access register — Row 12'],
  },
  {
    id: 'x1',
    type: 'dependency',
    title: 'Payment API migration depends on database migration validation',
    body: 'Sequence: DB migration validation → schema freeze → API cutover. Slipping validation by one week moves the cutover to Phase 2.',
    confidence: 'verified',
    sources: ['Technical Plan — Page 5', 'Meeting Notes — Section 3'],
  },
  {
    id: 'x2',
    type: 'dependency',
    title: 'Finance reconciliation job assumes ledger freeze',
    body: 'Named as a dependency in chat, but no owner or date is recorded in any authorised document.',
    confidence: 'uncertain',
    sources: ['#payments-platform — 14 Mar'],
  },
  {
    id: 'e1',
    type: 'evidence',
    title: 'Meeting Notes — Section 3',
    body: 'Sprint review, 12 Mar. Records the PostgreSQL decision and the rollback discussion. 2 claims linked.',
    confidence: 'verified',
    sources: ['sprint-review-12-mar.md'],
  },
  {
    id: 'e2',
    type: 'evidence',
    title: 'Technical Plan — Page 5',
    body: 'Migration ordering diagram and API cutover sequence. 3 claims linked, 1 conflict detected.',
    confidence: 'verified',
    sources: ['payments-platform-plan-v4.pdf'],
  },
  {
    id: 'e3',
    type: 'evidence',
    title: 'Repository search — rollback procedure',
    body: 'No matching document across 214 uploaded files. Recorded as missing information, not as absence of practice.',
    confidence: 'conflicting',
    sources: ['index: 214 files'],
  },
]

export const CONFIDENCE_META: Record<
  Confidence,
  { label: string; className: string; dot: string }
> = {
  verified: {
    label: 'Verified',
    className: 'border-forest/40 bg-forest/10 text-forest',
    dot: 'bg-forest',
  },
  uncertain: {
    label: 'Uncertain',
    className: 'border-ember/40 bg-ember/10 text-ember',
    dot: 'bg-ember',
  },
  conflicting: {
    label: 'Conflicting',
    className: 'border-ink/40 bg-ink/10 text-ink',
    dot: 'bg-ink',
  },
}
