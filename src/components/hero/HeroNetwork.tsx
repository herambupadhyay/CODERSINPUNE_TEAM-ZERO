import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { usePrefersReducedMotion, useFinePointer } from '@/hooks/useMedia'
import { HERO_EDGES, HERO_FRAGMENTS, KIND_META, type Fragment } from '@/data/hero'

const VB_W = 1200
const VB_H = 760

function nodeWidth(f: Fragment) {
  return Math.max(96, f.label.length * 7.4 + 30)
}
const NODE_H = 38

function edgePath(
  a: Fragment,
  b: Fragment,
  curve = 0,
): string {
  const ax = a.x + nodeWidth(a) / 2
  const ay = a.y + NODE_H / 2
  const bx = b.x + nodeWidth(b) / 2
  const by = b.y + NODE_H / 2
  const mx = (ax + bx) / 2
  const my = (ay + by) / 2
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const cx = mx + nx * curve
  const cy = my + ny * curve
  return `M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`
}

/**
 * Hero visual: fragmented knowledge that connects into an intelligent network.
 * - edges draw in on load (DrawSVG)
 * - cursor-responsive parallax at three depths
 * - hover a node → its edges + neighbours light up, others recede
 */
export function HeroNetwork() {
  const rootRef = useRef<SVGSVGElement>(null)
  const reduced = usePrefersReducedMotion()
  const fine = useFinePointer()

  useGSAP(
    () => {
      const svg = rootRef.current
      if (!svg) return

      const nodes = gsap.utils.toArray<SVGGElement>(svg.querySelectorAll('[data-node]'))
      const edges = gsap.utils.toArray<SVGPathElement>(svg.querySelectorAll('[data-edge]'))
      const depthBack = gsap.utils.toArray<Element>(svg.querySelectorAll('[data-depth="back"]'))
      const depthMid = gsap.utils.toArray<Element>(svg.querySelectorAll('[data-depth="mid"]'))
      const depthFront = gsap.utils.toArray<Element>(svg.querySelectorAll('[data-depth="front"]'))

      if (reduced) {
        gsap.set(edges, { drawSVG: '0% 100%' })
        gsap.set(nodes, { opacity: 1, scale: 1 })
        return
      }

      // --- entrance ---
      const tl = gsap.timeline({ delay: 0.35 })
      tl.from(edges, {
        drawSVG: '0% 0%',
        duration: 1.5,
        stagger: 0.045,
        ease: 'power2.inOut',
      })
        .from(
          nodes,
          {
            opacity: 0,
            scale: 0.72,
            transformOrigin: 'center center',
            duration: 0.7,
            stagger: { each: 0.05, from: 'random' },
            ease: 'back.out(1.7)',
          },
          0.35,
        )
        .from(
          svg.querySelectorAll('[data-pulse]'),
          { opacity: 0, duration: 1.2, ease: 'sine.out' },
          1.2,
        )

      // --- idle pulse travelling along two edges ---
      const pulsePaths = gsap.utils.toArray<SVGPathElement>(svg.querySelectorAll('[data-pulse]'))
      pulsePaths.forEach((p, i) => {
        const len = p.getTotalLength()
        gsap.set(p, { strokeDasharray: `18 ${len}`, strokeDashoffset: len })
        gsap.to(p, {
          strokeDashoffset: -18,
          duration: 3.4 + i,
          repeat: -1,
          ease: 'none',
          delay: 1.6 + i * 0.8,
        })
      })

      // --- cursor parallax (three depths) ---
      if (fine) {
        const xBack = gsap.quickTo(depthBack, 'x', { duration: 1.4, ease: 'power3.out' })
        const yBack = gsap.quickTo(depthBack, 'y', { duration: 1.4, ease: 'power3.out' })
        const xMid = gsap.quickTo(depthMid, 'x', { duration: 1.0, ease: 'power3.out' })
        const yMid = gsap.quickTo(depthMid, 'y', { duration: 1.0, ease: 'power3.out' })
        const xFront = gsap.quickTo(depthFront, 'x', { duration: 0.6, ease: 'power3.out' })
        const yFront = gsap.quickTo(depthFront, 'y', { duration: 0.6, ease: 'power3.out' })

        const onMove = (e: PointerEvent) => {
          const nx = (e.clientX / window.innerWidth - 0.5) * 2
          const ny = (e.clientY / window.innerHeight - 0.5) * 2
          xBack(nx * -12)
          yBack(ny * -8)
          xMid(nx * -26)
          yMid(ny * -16)
          xFront(nx * -44)
          yFront(ny * -26)
        }
        window.addEventListener('pointermove', onMove, { passive: true })

        // --- hover interactions ---
        const cleanupHover: Array<() => void> = []
        for (const node of nodes) {
          const id = node.dataset.node
          const relatedEdges = edges.filter(
            (e) => e.dataset.from === id || e.dataset.to === id,
          )
          const relatedIds = new Set<string>()
          relatedEdges.forEach((e) => {
            if (e.dataset.from !== id) relatedIds.add(e.dataset.from!)
            if (e.dataset.to !== id) relatedIds.add(e.dataset.to!)
          })

          const enter = () => {
            gsap.to(edges, { opacity: 0.1, duration: 0.35, overwrite: 'auto' })
            gsap.to(relatedEdges, { opacity: 1, duration: 0.35, overwrite: 'auto' })
            gsap.to(nodes, { opacity: 0.28, duration: 0.35, overwrite: 'auto' })
            gsap.to(node, { opacity: 1, scale: 1.06, duration: 0.4, overwrite: 'auto' })
            relatedIds.forEach((rid) => {
              const el = svg.querySelector(`[data-node="${rid}"]`)
              if (el) gsap.to(el, { opacity: 1, duration: 0.35, overwrite: 'auto' })
            })
          }
          const leave = () => {
            gsap.to(edges, { opacity: 1, duration: 0.5, overwrite: 'auto' })
            gsap.to(nodes, { opacity: 1, scale: 1, duration: 0.5, overwrite: 'auto' })
          }
          node.addEventListener('mouseenter', enter)
          node.addEventListener('mouseleave', leave)
          cleanupHover.push(() => {
            node.removeEventListener('mouseenter', enter)
            node.removeEventListener('mouseleave', leave)
          })
        }

        return () => {
          window.removeEventListener('pointermove', onMove)
          cleanupHover.forEach((fn) => fn())
        }
      }

      return () => {
        tl.kill()
      }
    },
    { scope: rootRef, dependencies: [reduced, fine] },
  )

  return (
    <svg
      ref={rootRef}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className="h-auto w-full"
      role="img"
      aria-label="Fragmented project knowledge — meeting notes, decisions, tasks, people and evidence — connecting into a structured network"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* faint editorial grid */}
      <g data-depth="back" opacity={0.5}>
        {Array.from({ length: 9 }, (_, i) => (
          <line
            key={`v${i}`}
            x1={(i + 1) * 120}
            y1={0}
            x2={(i + 1) * 120}
            y2={VB_H}
            stroke="#EAEAE5"
            strokeWidth={1}
          />
        ))}
        {Array.from({ length: 6 }, (_, i) => (
          <line
            key={`h${i}`}
            x1={0}
            y1={(i + 1) * 120}
            x2={VB_W}
            y2={(i + 1) * 120}
            stroke="#EAEAE5"
            strokeWidth={1}
          />
        ))}
      </g>

      {/* edges */}
      <g data-depth="mid" fill="none">
        {HERO_EDGES.map((e) => {
          const a = HERO_FRAGMENTS.find((f) => f.id === e.from)!
          const b = HERO_FRAGMENTS.find((f) => f.id === e.to)!
          const d = edgePath(a, b, e.curve)
          const hot = a.kind === 'decision' || b.kind === 'decision'
          return (
            <g key={`${e.from}-${e.to}`}>
              <path
                data-edge
                data-from={e.from}
                data-to={e.to}
                d={d}
                stroke={hot ? '#315B45' : '#20231F'}
                strokeOpacity={hot ? 0.5 : 0.28}
                strokeWidth={1.4}
              />
              {/* travelling pulse on a subset of edges */}
              {(e.from === 'f2' && e.to === 'f3') ||
              (e.from === 'f6' && e.to === 'f10') ||
              (e.from === 'f9' && e.to === 'f13') ? (
                <path data-pulse d={d} stroke="#D96B32" strokeWidth={2.4} strokeLinecap="round" />
              ) : null}
            </g>
          )
        })}
      </g>

      {/* nodes */}
      <g data-depth="front">
        {HERO_FRAGMENTS.map((f) => {
          const w = nodeWidth(f)
          const meta = KIND_META[f.kind]
          return (
            <g
              key={f.id}
              data-node={f.id}
              style={{ cursor: fine ? 'pointer' : 'default' }}
              tabIndex={-1}
            >
              <rect
                x={f.x}
                y={f.y}
                width={w}
                height={NODE_H}
                rx={f.kind === 'person' || f.kind === 'decision' ? 19 : 4}
                fill={meta.fill}
                stroke={meta.stroke}
                strokeWidth={1.4}
              />
              <text
                x={f.x + w / 2}
                y={f.y + NODE_H / 2 + 4}
                textAnchor="middle"
                fill={meta.text}
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12.5,
                  letterSpacing: '0.02em',
                }}
              >
                {f.label}
              </text>
              {f.kind === 'evidence' && (
                <rect x={f.x} y={f.y} width={4} height={NODE_H} fill="#D96B32" />
              )}
            </g>
          )
        })}
      </g>
    </svg>
  )
}
