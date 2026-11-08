export type DepartureNode = {
  id: string
  label: string
  kind: 'person' | 'responsibility' | 'task' | 'dependent' | 'risk' | 'gap'
  x: number
  y: number
}

export type DepartureEdge = { from: string; to: string }

export const DEPARTURE_NODES: DepartureNode[] = [
  { id: 'amir', label: 'A. Rahman', kind: 'person', x: 420, y: 250 },
  { id: 'r1', label: 'Migration sign-off', kind: 'responsibility', x: 170, y: 110 },
  { id: 'r2', label: 'Rollback policy', kind: 'responsibility', x: 620, y: 110 },
  { id: 'r3', label: 'Staging access', kind: 'responsibility', x: 150, y: 380 },
  { id: 't1', label: 'PP-142 testing', kind: 'task', x: 660, y: 300 },
  { id: 't2', label: 'API contract v3', kind: 'task', x: 590, y: 450 },
  { id: 'd1', label: 'L. Okafor', kind: 'dependent', x: 280, y: 470 },
  { id: 'd2', label: 'Finance recon', kind: 'dependent', x: 90, y: 240 },
  { id: 'k1', label: 'Rollback undocumented', kind: 'risk', x: 700, y: 190 },
  { id: 'k2', label: 'No owner for v3', kind: 'risk', x: 730, y: 380 },
  { id: 'g1', label: 'Knowledge gap', kind: 'gap', x: 400, y: 560 },
]

export const DEPARTURE_EDGES: DepartureEdge[] = [
  { from: 'amir', to: 'r1' },
  { from: 'amir', to: 'r2' },
  { from: 'amir', to: 'r3' },
  { from: 'amir', to: 't1' },
  { from: 'amir', to: 't2' },
  { from: 'r1', to: 't1' },
  { from: 'r2', to: 'k1' },
  { from: 't2', to: 'k2' },
  { from: 't1', to: 'd1' },
  { from: 'r3', to: 'd2' },
  { from: 't2', to: 'd1' },
  { from: 'k1', to: 'g1' },
  { from: 'k2', to: 'g1' },
  { from: 'd1', to: 'g1' },
]

/** Scroll phases: 0 person · 1 responsibilities · 2 tasks · 3 dependents · 4 risks · 5 gaps */
export const DEPARTURE_PHASES = [
  { n: '01', label: 'The departure', body: 'One person leaves. On paper, a resignation. In practice, a cut in the graph.' },
  { n: '02', label: 'Responsibilities', body: 'Every sign-off, policy and access right they held comes into view.' },
  { n: '03', label: 'Affected work', body: 'Tasks that depended on them stall — quietly, at first.' },
  { n: '04', label: 'Dependent people', body: 'Colleagues blocked without knowing exactly what they are missing.' },
  { n: '05', label: 'Unresolved risks', body: 'Undocumented procedures and ownerless decisions surface.' },
  { n: '06', label: 'The gap', body: 'ProjectPulse maps the impact so it can be transferred — not discovered later.' },
]
