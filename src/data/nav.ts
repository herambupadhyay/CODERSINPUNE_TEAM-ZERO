export const SECTIONS = [
  { id: 'product', label: 'Product' },
  { id: 'how-it-works', label: 'How it works' },
  { id: 'intelligence', label: 'Intelligence' },
  { id: 'why', label: 'Why ProjectPulse' },
] as const

export type SectionId = (typeof SECTIONS)[number]['id']
