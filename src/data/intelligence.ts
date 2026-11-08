export type GraphNode = {
  id: string
  label: string
  kind: 'person' | 'decision' | 'task' | 'doc' | 'dependency' | 'risk' | 'evidence'
  /** layout position in a 900×520 viewBox */
  x: number
  y: number
  detail?: {
    owner?: string
    decision?: string
    dependency?: string
    risk?: string
    note?: string
  }
}

export type GraphEdge = { from: string; to: string; label?: string }

export const KNOWLEDGE_NODES: GraphNode[] = [
  { id: 'payment-api', label: 'Payment API', kind: 'task', x: 450, y: 250,
    detail: {
      owner: 'Backend Team',
      decision: 'PostgreSQL integration',
      dependency: 'Payment migration',
      risk: 'Rollback procedure undocumented',
      note: 'Service handling authorisation, capture and refund flows for the Payments Platform.',
    } },
  { id: 'postgres', label: 'PostgreSQL', kind: 'decision', x: 210, y: 120,
    detail: { owner: 'Architecture Group', decision: 'Selected for transactional data', note: 'Chosen over MySQL for JSONB flexibility and migration tooling.' } },
  { id: 'amir', label: 'A. Rahman', kind: 'person', x: 700, y: 110,
    detail: { owner: 'Departing lead', note: 'Held final approval on payment migration and rollback policy.' } },
  { id: 'migration', label: 'Payment migration', kind: 'task', x: 660, y: 330,
    detail: { owner: 'Backend Team', dependency: 'DB migration validation', risk: 'Final testing incomplete' } },
  { id: 'rollback', label: 'Rollback risk', kind: 'risk', x: 260, y: 400,
    detail: { risk: 'No documented rollback procedure found', note: 'Flagged as conflicting: runbook §4 references a procedure absent from the repo.' } },
  { id: 'meeting', label: 'Meeting notes §3', kind: 'evidence', x: 90, y: 250,
    detail: { note: 'Source: Sprint review, 12 Mar — records the PostgreSQL decision.' } },
  { id: 'runbook', label: 'Runbook p.5', kind: 'evidence', x: 470, y: 460,
    detail: { note: 'Source: Technical plan, page 5 — describes migration ordering.' } },
  { id: 'sprint', label: 'Sprint 14 board', kind: 'doc', x: 450, y: 60,
    detail: { owner: 'Delivery', note: 'Task export — 18 open, 4 blocked.' } },
  { id: 'leah', label: 'L. Okafor', kind: 'person', x: 820, y: 470,
    detail: { owner: 'Successor', note: 'Receiving scoped handover for backend services.' } },
]

export const KNOWLEDGE_EDGES: GraphEdge[] = [
  { from: 'payment-api', to: 'postgres', label: 'uses' },
  { from: 'payment-api', to: 'migration', label: 'blocks' },
  { from: 'payment-api', to: 'rollback', label: 'risk' },
  { from: 'payment-api', to: 'meeting', label: 'evidence' },
  { from: 'amir', to: 'payment-api', label: 'owned' },
  { from: 'amir', to: 'migration', label: 'approves' },
  { from: 'migration', to: 'runbook', label: 'evidence' },
  { from: 'migration', to: 'leah', label: 'transfers to' },
  { from: 'rollback', to: 'meeting', label: 'conflict' },
  { from: 'rollback', to: 'runbook', label: 'missing' },
  { from: 'sprint', to: 'payment-api', label: 'tracks' },
  { from: 'sprint', to: 'migration', label: 'tracks' },
  { from: 'postgres', to: 'sprint', label: 'scoped in' },
]

export type Role = {
  id: string
  label: string
  level: number
  scope: string
  permissions: string[]
}

export const ROLES: Role[] = [
  {
    id: 'head',
    label: 'Project Head',
    level: 0,
    scope: 'Whole project',
    permissions: ['Approve handovers', 'View all sources', 'Delegate access', 'Financial records'],
  },
  {
    id: 'lead',
    label: 'Team Lead',
    level: 1,
    scope: 'Team + dependencies',
    permissions: ['Approve team handovers', 'View team sources', 'Reassign tasks'],
  },
  {
    id: 'dev',
    label: 'Backend Developer',
    level: 2,
    scope: 'Backend services',
    permissions: ['View backend docs', 'Update tasks', 'Comment on decisions'],
  },
  {
    id: 'successor',
    label: 'New Successor',
    level: 3,
    scope: 'Scoped transfer',
    permissions: ['View approved backend docs', 'View relevant tasks', 'View project decisions'],
  },
]

export const SUCCESSOR_GRANTED = [
  'Backend technical documentation (approved)',
  'Open tasks assigned to the departing developer',
  'Project decisions affecting backend services',
  'Evidence-linked meeting notes §3',
]

export const SUCCESSOR_DENIED = [
  'Departing developer admin privileges',
  'Restricted HR records',
  'Financial / billing information',
  'Other teams’ private channels',
]
