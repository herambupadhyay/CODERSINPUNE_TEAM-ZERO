import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { useDesktop, usePrefersReducedMotion } from '@/hooks/useMedia'
import { Reveal } from '@/components/ui/Reveal'
import { DEPARTURE_EDGES, DEPARTURE_NODES, DEPARTURE_PHASES } from '@/data/departure'

const KIND_STYLE: Record<string, { fill: string; stroke: string; text: string }> = {
  person: { fill: '#D96B32', stroke: '#D96B32', text: '#FFFFFF' },
  responsibility: { fill: '#315B45', stroke: '#315B45', text: '#FFFFFF' },
  task: { fill: '#FFFFFF', stroke: '#20231F', text: '#20231F' },
  dependent: { fill: '#FAF8F4', stroke: '#315B45', text: '#315B45' },
  risk: { fill: '#20231F', stroke: '#D96B32', text: '#D96B32' },
  gap: { fill: '#D96B32', stroke: '#D96B32', text: '#FFFFFF' },
}

/** phase → node kinds highlighted */
const PHASE_KINDS: string[][] = [
  ['person'],
  ['person', 'responsibility'],
  ['person', 'responsibility', 'task'],
  ['person', 'responsibility', 'task', 'dependent'],
  ['person', 'responsibility', 'task', 'dependent', 'risk'],
  ['person', 'responsibility', 'task', 'dependent', 'risk', 'gap'],
]

function nodeW(label: string) {
  return Math.max(112, label.length * 7.4 + 30)
}
const NODE_H = 40

function edgePath(aId: string, bId: string) {
  const a = DEPARTURE_NODES.find((n) => n.id === aId)!
  const b = DEPARTURE_NODES.find((n) => n.id === bId)!
  const ax = a.x + nodeW(a.label) / 2
  const ay = a.y + NODE_H / 2
  const bx = b.x + nodeW(b.label) / 2
  const by = b.y + NODE_H / 2
  return `M ${ax} ${ay} L ${bx} ${by}`
}

function edgePhase(from: string, to: string) {
  const order = ['amir', 'r1', 'r2', 'r3', 't1', 't2', 'd1', 'd2', 'k1', 'k2', 'g1']
  const fi = order.indexOf(from)
  const ti = order.indexOf(to)
  // phase at which both endpoints are revealed
  const kindOf = (id: string) => DEPARTURE_NODES.find((n) => n.id === id)!.kind
  const phaseOfKind: Record<string, number> = {
    person: 0,
    responsibility: 1,
    task: 2,
    dependent: 3,
    risk: 4,
    gap: 5,
  }
  const p = Math.max(phaseOfKind[kindOf(from)], phaseOfKind[kindOf(to)])
  return Math.min(p, 5) + (fi < 0 || ti < 0 ? 0 : 0)
}

/**
 * Section 07 — scrubbed dependency map of a departure.
 */
export function DepartureMap() {
  const rootRef = useRef<HTMLElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const phaseRef = useRef<HTMLOListElement>(null)
  const reduced = usePrefersReducedMotion()
  const desktop = useDesktop()

  useGSAP(
    () => {
      const root = rootRef.current
      const svg = svgRef.current
      const phases = phaseRef.current
      if (!root || !svg || !phases) return

      const items = gsap.utils.toArray<HTMLElement>(phases.querySelectorAll('[data-phase]'))
      const caps = gsap.utils.toArray<HTMLElement>(
        root.querySelectorAll('[data-phase-caption]'),
      )
      const nodes = gsap.utils.toArray<SVGGElement>(svg.querySelectorAll('[data-dnode]'))
      const edges = gsap.utils.toArray<SVGPathElement>(svg.querySelectorAll('[data-dedge]'))
      const closing = root.querySelector('[data-departure-close]')

      // Mobile / reduced-motion: reveal everything as a static end state.
      if (reduced || !desktop) {
        gsap.set(nodes, { opacity: 1, scale: 1, clearProps: 'transform' })
        gsap.set(edges, { opacity: 0.75, drawSVG: '0% 100%' })
        gsap.set(items, { opacity: 1, y: 0 })
        gsap.set(caps, { opacity: 0 })
        if (caps[0]) gsap.set(caps[0], { opacity: 1 })
        gsap.set(closing, { opacity: 1, y: 0 })
        return
      }

      // initial state
      nodes.forEach((n) => gsap.set(n, { opacity: 0.12, scale: 0.94, transformOrigin: 'center' }))
      edges.forEach((e) => gsap.set(e, { opacity: 0, drawSVG: '0% 0%' }))
      gsap.set(items, { opacity: 0.25, y: 18 })
      gsap.set(items[0], { opacity: 1, y: 0 })
      if (caps.length) {
        gsap.set(caps, { opacity: 0, y: 10 })
        gsap.set(caps[0], { opacity: 1, y: 0 })
      }
      gsap.set(closing, { opacity: 0, y: 30 })

      const total = DEPARTURE_PHASES.length

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: root,
          start: 'top top',
          end: `+=${total * 60}%`,
          pin: true,
          scrub: 0.8,
          anticipatePin: 1,
        },
      })

      for (let p = 0; p < total; p++) {
        const pos = p // one unit per phase
        const kinds = PHASE_KINDS[p]

        // reveal nodes of this phase's kinds (those not present in the previous phase)
        const prevKinds = PHASE_KINDS[Math.max(0, p - 1)]
        const entering = nodes.filter((n) => {
          const kind = n.dataset.kind!
          return kinds.includes(kind) && !prevKinds.includes(kind)
        })
        if (entering.length) {
          tl.to(
            entering,
            {
              opacity: 1,
              scale: 1,
              duration: 0.5,
              stagger: 0.08,
              ease: 'power3.out',
              overwrite: 'auto',
            },
            pos,
          )
        }

        // dim nodes still out of scope (keep it readable: just leave them at 0.12)

        // reveal edges whose phase matches
        const enteringEdges = edges.filter((e) => edgePhase(e.dataset.from!, e.dataset.to!) === p)
        if (enteringEdges.length) {
          tl.to(
            enteringEdges,
            {
              opacity: 0.75,
              drawSVG: '0% 100%',
              duration: 0.6,
              stagger: 0.05,
              ease: 'power2.inOut',
              overwrite: 'auto',
            },
            pos + 0.1,
          )
        }

        // phase caption swap
        tl.to(items, { opacity: 0.25, y: -12, duration: 0.3, overwrite: 'auto' }, pos)
        tl.to(
          items[p],
          { opacity: 1, y: 0, duration: 0.4, overwrite: 'auto' },
          pos + 0.25,
        )
        if (caps.length) {
          tl.to(caps, { opacity: 0, y: -8, duration: 0.25, overwrite: 'auto' }, pos)
          tl.to(
            caps[p],
            { opacity: 1, y: 0, duration: 0.4, overwrite: 'auto' },
            pos + 0.3,
          )
        }
      }

      // final: pulse the gap node, then closing line
      const gap = svg.querySelector('[data-dnode="g1"]')
      if (gap) {
        tl.to(gap, { scale: 1.1, duration: 0.3, yoyo: true, repeat: 3, ease: 'sine.inOut' }, total - 0.3)
      }
      tl.to(closing, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, total - 0.1)
      tl.to({}, { duration: 0.5 })
    },
    { scope: rootRef, dependencies: [reduced, desktop] },
  )

  return (
    <section
      ref={rootRef}
      id="why"
      aria-label="Departure impact analysis"
      className="relative bg-paper"
    >
      <div className="flex flex-col py-20 lg:h-svh lg:min-h-[700px] lg:overflow-hidden lg:py-14">
        <div className="mx-auto w-full max-w-[1440px] shrink-0 px-5 sm:px-8 lg:px-12">
          <div className="flex items-baseline justify-between border-b border-line pb-3">
            <span className="label-mono text-ember">06 / Departure impact</span>
            <span className="label-mono hidden text-muted sm:block">Dependency map</span>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-12">
            <Reveal
              as="h2"
              mode="lines"
              className="display-lg col-span-12 text-ink lg:col-span-6 lg:text-[clamp(1.9rem,3vw,3.1rem)]"
            >
              What breaks when someone leaves?
            </Reveal>
            <p className="body-lg col-span-12 max-w-md self-end lg:col-span-4 lg:col-start-9 lg:text-[0.95rem]">
              Scroll to trace the impact — from one departure to every task, person and risk it
              touches.
            </p>
          </div>
        </div>

        <div className="mx-auto grid w-full max-w-[1440px] flex-1 grid-cols-1 items-center gap-6 px-5 pt-4 sm:px-8 lg:grid-cols-12 lg:gap-10 lg:px-12">
          {/* Phases */}
          <ol
            ref={phaseRef}
            className="order-2 flex gap-4 overflow-x-auto pb-2 lg:order-1 lg:col-span-4 lg:flex-col lg:gap-4 lg:overflow-visible lg:pb-0"
          >
            {DEPARTURE_PHASES.map((ph) => (
              <li
                key={ph.n}
                data-phase
                className="min-w-[240px] border-l-2 border-line pl-4 lg:min-w-0"
              >
                <span className="label-mono text-ember">{ph.n}</span>
                <p className="mt-1 font-display text-[1.05rem] leading-tight text-ink lg:text-lg">
                  {ph.label}
                </p>
                <p className="mt-1.5 hidden text-[0.82rem] leading-relaxed text-muted sm:block lg:hidden">
                  {ph.body}
                </p>
              </li>
            ))}
          </ol>

          {/* Map */}
          <div className="order-1 lg:order-2 lg:col-span-8">
            <div className="lg:h-[54vh] lg:max-h-[530px] lg:min-h-[360px]">
              <svg
                ref={svgRef}
                viewBox="0 0 960 640"
                className="h-auto w-full lg:h-full"
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label="Dependency map showing a departing team member and everything connected to them"
              >
              <g fill="none">
                {DEPARTURE_EDGES.map((e) => {
                  const phase = edgePhase(e.from, e.to)
                  const isRiskEdge =
                    DEPARTURE_NODES.find((n) => n.id === e.from)?.kind === 'risk' ||
                    DEPARTURE_NODES.find((n) => n.id === e.to)?.kind === 'risk'
                  return (
                    <path
                      key={`${e.from}-${e.to}`}
                      data-dedge
                      data-from={e.from}
                      data-to={e.to}
                      d={edgePath(e.from, e.to)}
                      stroke={isRiskEdge ? '#D96B32' : '#315B45'}
                      strokeWidth={isRiskEdge ? 1.8 : 1.4}
                      strokeDasharray={isRiskEdge ? '6 5' : undefined}
                      data-phase={phase}
                    />
                  )
                })}
              </g>

              {DEPARTURE_NODES.map((n) => {
                const w = nodeW(n.label)
                const s = KIND_STYLE[n.kind]
                return (
                  <g key={n.id} data-dnode={n.id} data-kind={n.kind}>
                    <rect
                      x={n.x}
                      y={n.y}
                      width={w}
                      height={NODE_H}
                      rx={n.kind === 'person' || n.kind === 'gap' ? 20 : 4}
                      fill={s.fill}
                      stroke={s.stroke}
                      strokeWidth={1.5}
                    />
                    <text
                      x={n.x + w / 2}
                      y={n.y + NODE_H / 2 + 4}
                      textAnchor="middle"
                      fill={s.text}
                      style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5 }}
                      pointerEvents="none"
                    >
                      {n.label}
                    </text>
                  </g>
                )
              })}
            </svg>
            </div>

            {/* Desktop: active phase caption under the map */}
            <div className="mt-3 hidden lg:block" aria-live="polite">
              <div className="relative h-12">
                {DEPARTURE_PHASES.map((ph, i) => (
                  <p
                    key={ph.n}
                    data-phase-caption={i}
                    className="absolute inset-x-0 top-0 text-[0.88rem] leading-relaxed text-muted opacity-0"
                  >
                    <span className="label-mono mr-2 text-ember">{ph.n}</span>
                    {ph.body}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Closing line */}
        <div className="mx-auto w-full max-w-[1440px] shrink-0 px-5 pt-2 sm:px-8 lg:px-12">
          <p
            data-departure-close
            className="border-t border-line pt-5 font-display text-[clamp(1.2rem,2.2vw,1.85rem)] leading-snug text-ink opacity-0"
          >
            Know what needs to be transferred{' '}
            <em className="italic text-ember">before it becomes a problem.</em>
          </p>
        </div>
      </div>
    </section>
  )
}
