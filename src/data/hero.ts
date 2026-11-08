export type FragKind = 'doc' | 'decision' | 'task' | 'person' | 'dependency' | 'evidence'

export type Fragment = {
  id: string
  kind: FragKind
  label: string
  /** viewBox coordinates (0–1200 × 0–760) */
  x: number
  y: number
}

export type Edge = { from: string; to: string; curve?: number }

export const KIND_META: Record<FragKind, { fill: string; stroke: string; text: string }> = {
  doc: { fill: '#FAF8F4', stroke: '#EAEAE5', text: '#20231F' },
  decision: { fill: '#315B45', stroke: '#315B45', text: '#FFFFFF' },
  task: { fill: '#FFFFFF', stroke: '#20231F', text: '#20231F' },
  person: { fill: '#D96B32', stroke: '#D96B32', text: '#FFFFFF' },
  dependency: { fill: '#FFFFFF', stroke: '#315B45', text: '#315B45' },
  evidence: { fill: '#FAF8F4', stroke: '#D96B32', text: '#D96B32' },
}

export const HERO_FRAGMENTS: Fragment[] = [
  { id: 'f1', kind: 'doc', label: 'Meeting notes', x: 96, y: 118 },
  { id: 'f2', kind: 'decision', label: 'PostgreSQL', x: 352, y: 74 },
  { id: 'f3', kind: 'task', label: 'Migration tests', x: 612, y: 148 },
  { id: 'f4', kind: 'person', label: 'Backend team', x: 880, y: 86 },
  { id: 'f5', kind: 'doc', label: 'Technical plan', x: 1002, y: 210 },
  { id: 'f6', kind: 'dependency', label: 'DB validation', x: 748, y: 330 },
  { id: 'f7', kind: 'evidence', label: 'p.5 · §3', x: 470, y: 300 },
  { id: 'f8', kind: 'task', label: 'Rollback doc', x: 178, y: 330 },
  { id: 'f9', kind: 'decision', label: 'Scope lock', x: 946, y: 452 },
  { id: 'f10', kind: 'person', label: 'Successor', x: 640, y: 520 },
  { id: 'f11', kind: 'doc', label: 'Task export', x: 300, y: 560 },
  { id: 'f12', kind: 'evidence', label: 'Risk · high', x: 90, y: 500 },
  { id: 'f13', kind: 'dependency', label: 'API contract', x: 1040, y: 610 },
  { id: 'f14', kind: 'task', label: 'Final testing', x: 830, y: 668 },
  { id: 'f15', kind: 'doc', label: 'Decision log', x: 470, y: 690 },
]

export const HERO_EDGES: Edge[] = [
  { from: 'f1', to: 'f2', curve: -30 },
  { from: 'f2', to: 'f3', curve: 24 },
  { from: 'f3', to: 'f4', curve: -20 },
  { from: 'f4', to: 'f5', curve: 26 },
  { from: 'f3', to: 'f6', curve: -34 },
  { from: 'f7', to: 'f3', curve: 18 },
  { from: 'f7', to: 'f2', curve: -16 },
  { from: 'f8', to: 'f7', curve: 22 },
  { from: 'f8', to: 'f1', curve: -24 },
  { from: 'f6', to: 'f10', curve: 28 },
  { from: 'f4', to: 'f9', curve: -30 },
  { from: 'f9', to: 'f10', curve: 20 },
  { from: 'f10', to: 'f11', curve: -22 },
  { from: 'f11', to: 'f12', curve: 18 },
  { from: 'f12', to: 'f8', curve: -26 },
  { from: 'f9', to: 'f13', curve: 24 },
  { from: 'f13', to: 'f14', curve: -18 },
  { from: 'f14', to: 'f10', curve: -30 },
  { from: 'f15', to: 'f10', curve: 16 },
  { from: 'f15', to: 'f11', curve: -14 },
  { from: 'f6', to: 'f9', curve: 40 },
  { from: 'f5', to: 'f6', curve: -22 },
]
