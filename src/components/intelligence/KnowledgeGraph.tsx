import { useRef, useState } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { usePrefersReducedMotion } from '@/hooks/useMedia'
import { KNOWLEDGE_EDGES, KNOWLEDGE_NODES, type GraphNode } from '@/data/intelligence'
import { X } from 'lucide-react'

const KIND_FILL: Record<GraphNode['kind'], string> = {
  person: '#D96B32',
  decision: '#315B45',
  task: '#FFFFFF',
  doc: '#FAF8F4',
  dependency: '#FFFFFF',
  risk: '#20231F',
  evidence: '#FFFFFF',
}

const KIND_STROKE: Record<GraphNode['kind'], string> = {
  person: '#D96B32',
  decision: '#315B45',
  task: '#20231F',
  doc: '#EAEAE5',
  dependency: '#315B45',
  risk: '#20231F',
  evidence: '#D96B32',
}

const KIND_TEXT: Record<GraphNode['kind'], string> = {
  person: '#FFFFFF',
  decision: '#FFFFFF',
  task: '#20231F',
  doc: '#20231F',
  dependency: '#315B45',
  risk: '#FFFFFF',
  evidence: '#D96B32',
}

const KIND_LABEL: Record<GraphNode['kind'], string> = {
  person: 'Person',
  decision: 'Decision',
  task: 'Work item',
  doc: 'Document',
  dependency: 'Dependency',
  risk: 'Risk',
  evidence: 'Evidence',
}

function nodeW(n: GraphNode) {
  return Math.max(104, n.label.length * 7.6 + 34)
}
const NODE_H = 40

function edgePath(a: GraphNode, b: GraphNode, curve = 0) {
  const ax = a.x + nodeW(a) / 2
  const ay = a.y + NODE_H / 2
  const bx = b.x + nodeW(b) / 2
  const by = b.y + NODE_H / 2
  const mx = (ax + bx) / 2
  const my = (ay + by) / 2
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy) || 1
  return `M ${ax} ${ay} Q ${mx + (-dy / len) * curve} ${my + (dx / len) * curve} ${bx} ${by}`
}

/**
 * Interactive knowledge graph: select a node to highlight its
 * relationships and reveal structured detail.
 */
export function KnowledgeGraph() {
  const [selected, setSelected] = useState<string | null>('payment-api')
  const svgRef = useRef<SVGSVGElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()

  const node = KNOWLEDGE_NODES.find((n) => n.id === selected) ?? null
  const relatedEdges = KNOWLEDGE_EDGES.filter(
    (e) => e.from === selected || e.to === selected,
  )
  const relatedIds = new Set<string>()
  relatedEdges.forEach((e) => {
    if (e.from !== selected) relatedIds.add(e.from)
    if (e.to !== selected) relatedIds.add(e.to)
  })

  useGSAP(
    () => {
      const svg = svgRef.current
      if (!svg || reduced) return

      // entrance
      const nodes = gsap.utils.toArray<SVGGElement>(svg.querySelectorAll('[data-gnode]'))
      const edges = gsap.utils.toArray<SVGPathElement>(svg.querySelectorAll('[data-gedge]'))
      gsap.from(edges, {
        drawSVG: '0% 0%',
        duration: 1.1,
        stagger: 0.05,
        ease: 'power2.inOut',
        scrollTrigger: { trigger: svg, start: 'top 80%', once: true },
      })
      gsap.from(nodes, {
        opacity: 0,
        scale: 0.8,
        transformOrigin: 'center',
        duration: 0.6,
        stagger: { each: 0.06, from: 'random' },
        ease: 'back.out(1.6)',
        scrollTrigger: { trigger: svg, start: 'top 80%', once: true },
      })
    },
    { scope: svgRef, dependencies: [reduced] },
  )

  // selection state transitions
  useGSAP(
    () => {
      const svg = svgRef.current
      if (!svg) return
      const allNodes = svg.querySelectorAll('[data-gnode]')
      const allEdges = svg.querySelectorAll('[data-gedge]')

      if (reduced) {
        allNodes.forEach((n) => {
          const id = (n as SVGGElement).dataset.gnode ?? ''
          const active = id === selected || relatedIds.has(id)
          ;(n as SVGGElement).style.opacity = active ? '1' : '0.32'
        })
        allEdges.forEach((e) => {
          const el = e as SVGPathElement
          const active =
            el.dataset.from === selected || el.dataset.to === selected
          el.style.opacity = active ? '1' : '0.14'
        })
        return
      }

      allNodes.forEach((n) => {
        const el = n as SVGGElement
        const id = el.dataset.gnode ?? ''
        const isActive = id === selected
        const isRelated = relatedIds.has(id)
        gsap.to(el, {
          opacity: isActive || isRelated ? 1 : 0.3,
          scale: isActive ? 1.07 : 1,
          transformOrigin: 'center center',
          duration: 0.45,
          ease: 'power3.out',
          overwrite: 'auto',
        })
      })

      allEdges.forEach((e) => {
        const el = e as SVGPathElement
        const active = el.dataset.from === selected || el.dataset.to === selected
        gsap.to(el, {
          opacity: active ? 1 : 0.12,
          stroke: active ? '#D96B32' : '#315B45',
          strokeWidth: active ? 2.2 : 1.3,
          duration: 0.45,
          overwrite: 'auto',
        })
      })

      if (panelRef.current) {
        gsap.fromTo(
          panelRef.current,
          { opacity: 0, y: 14 },
          { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', overwrite: 'auto' },
        )
      }
    },
    { dependencies: [selected, reduced] },
  )

  const detailRows: Array<{ k: string; v: string; tone?: 'risk' | 'plain' }> = []
  if (node?.detail) {
    if (node.detail.owner) detailRows.push({ k: 'Owner', v: node.detail.owner })
    if (node.detail.decision) detailRows.push({ k: 'Related decision', v: node.detail.decision })
    if (node.detail.dependency) detailRows.push({ k: 'Dependency', v: node.detail.dependency })
    if (node.detail.risk)
      detailRows.push({ k: 'Risk', v: node.detail.risk, tone: 'risk' })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* Graph */}
      <div className="relative border border-white/15 bg-white/[0.03] p-3 lg:col-span-3">
        <svg
          ref={svgRef}
          viewBox="0 0 900 520"
          className="h-auto w-full"
          role="group"
          aria-label="Interactive knowledge graph — select a node to inspect its relationships"
        >
          {/* edges */}
          <g fill="none">
            {KNOWLEDGE_EDGES.map((e, i) => {
              const a = KNOWLEDGE_NODES.find((n) => n.id === e.from)!
              const b = KNOWLEDGE_NODES.find((n) => n.id === e.to)!
              const curve = i % 2 === 0 ? 26 : -26
              return (
                <path
                  key={`${e.from}-${e.to}`}
                  data-gedge
                  data-from={e.from}
                  data-to={e.to}
                  d={edgePath(a, b, curve)}
                  stroke="#4A7360"
                  strokeWidth={1.3}
                  strokeOpacity={0.75}
                />
              )
            })}
          </g>

          {/* edge labels on selection */}
          <g>
            {relatedEdges.map((e) => {
              const a = KNOWLEDGE_NODES.find((n) => n.id === e.from)!
              const b = KNOWLEDGE_NODES.find((n) => n.id === e.to)!
              const mx = (a.x + b.x) / 2 + nodeW(a) / 2
              const my = (a.y + b.y) / 2 + NODE_H / 2
              return (
                <g key={`lbl-${e.from}-${e.to}`}>
                  <rect
                    x={mx - e.label!.length * 3.6 - 6}
                    y={my - 9}
                    width={e.label!.length * 7.2 + 12}
                    height={18}
                    fill="#20231F"
                    stroke="#D96B32"
                    strokeWidth={0.8}
                  />
                  <text
                    x={mx}
                    y={my + 4}
                    textAnchor="middle"
                    fill="#E89161"
                    style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}
                  >
                    {e.label}
                  </text>
                </g>
              )
            })}
          </g>

          {/* nodes */}
          {KNOWLEDGE_NODES.map((n) => {
            const w = nodeW(n)
            const isSelected = n.id === selected
            return (
              <g
                key={n.id}
                data-gnode={n.id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={`${KIND_LABEL[n.kind]}: ${n.label}`}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelected(n.id)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault()
                    setSelected(n.id)
                  }
                }}
              >
                <rect
                  x={n.x}
                  y={n.y}
                  width={w}
                  height={NODE_H}
                  rx={n.kind === 'person' ? 20 : 4}
                  fill={KIND_FILL[n.kind]}
                  stroke={isSelected ? '#D96B32' : KIND_STROKE[n.kind]}
                  strokeWidth={isSelected ? 2.5 : 1.4}
                />
                <text
                  x={n.x + w / 2}
                  y={n.y + NODE_H / 2 + 4}
                  textAnchor="middle"
                  fill={KIND_TEXT[n.kind]}
                  style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5 }}
                  pointerEvents="none"
                >
                  {n.label}
                </text>
                {isSelected && (
                  <circle cx={n.x + w - 8} cy={n.y + 9} r={3.5} fill="#D96B32" />
                )}
              </g>
            )
          })}
        </svg>

        <p className="label-mono mt-2 px-1 text-white/40">
          Fig. 02 — click any node · relationships highlight automatically
        </p>
      </div>

      {/* Detail panel */}
      <div ref={panelRef} className="flex flex-col lg:col-span-2">
        <div className="flex items-start justify-between gap-4 border-b border-white/15 pb-4">
          <div>
            <p className="label-mono text-ember">
              {node ? KIND_LABEL[node.kind] : 'Selection'}
            </p>
            <h4 className="mt-2 font-display text-2xl leading-tight text-white">
              {node?.label ?? 'Select a node'}
            </h4>
          </div>
          {selected && (
            <button
              onClick={() => setSelected(null)}
              className="grid h-8 w-8 shrink-0 place-items-center border border-white/20 text-white/60 transition-colors hover:border-ember hover:text-ember"
              aria-label="Clear selection"
            >
              <X size={14} strokeWidth={1.8} />
            </button>
          )}
        </div>

        {node?.detail?.note && (
          <p className="mt-4 text-[0.9rem] leading-relaxed text-white/70">{node.detail.note}</p>
        )}

        <dl className="mt-5 space-y-3">
          {detailRows.map((r) => (
            <div key={r.k} className="flex items-baseline gap-4 border-b border-white/10 pb-3">
              <dt className="label-mono w-32 shrink-0 text-white/40">{r.k}</dt>
              <dd
                className={`text-[0.88rem] leading-snug ${
                  r.tone === 'risk' ? 'text-ember' : 'text-white/90'
                }`}
              >
                {r.v}
              </dd>
            </div>
          ))}
        </dl>

        {relatedEdges.length > 0 && (
          <div className="mt-5">
            <p className="label-mono text-white/40">Relationships ({relatedEdges.length})</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {relatedEdges.map((e) => {
                const otherId = e.from === selected ? e.to : e.from
                const other = KNOWLEDGE_NODES.find((n) => n.id === otherId)!
                return (
                  <li key={`${e.from}-${e.to}`}>
                    <button
                      onClick={() => setSelected(otherId)}
                      className="border border-white/20 px-2.5 py-1.5 text-[0.72rem] font-mono text-white/75 transition-colors hover:border-ember hover:text-ember"
                    >
                      {e.label} → {other.label}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {!node && (
          <p className="mt-6 text-sm leading-relaxed text-white/50">
            Knowledge Intelligence reconstructs what the organisation knows: people, decisions,
            tasks, documents, dependencies, risks — each tied to evidence.
          </p>
        )}
      </div>
    </div>
  )
}
