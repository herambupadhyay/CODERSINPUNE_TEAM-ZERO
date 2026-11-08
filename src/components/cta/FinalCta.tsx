import { useRef } from 'react'
import { gsap, SplitText, useGSAP } from '@/lib/gsap'
import { usePrefersReducedMotion } from '@/hooks/useMedia'
import { useDemo } from '@/components/ui/DemoModal'
import { MagneticButton } from '@/components/ui/MagneticButton'
import { HERO_EDGES, HERO_FRAGMENTS } from '@/data/hero'
import { ArrowUpRight } from 'lucide-react'

const VB_W = 1200
const VB_H = 760
const NODE_H = 38

function nodeW(label: string) {
  return Math.max(96, label.length * 7.4 + 30)
}

function path(a: (typeof HERO_FRAGMENTS)[0], b: (typeof HERO_FRAGMENTS)[0], curve = 0) {
  const ax = a.x + nodeW(a.label) / 2
  const ay = a.y + NODE_H / 2
  const bx = b.x + nodeW(b.label) / 2
  const by = b.y + NODE_H / 2
  const mx = (ax + bx) / 2
  const my = (ay + by) / 2
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy) || 1
  return `M ${ax} ${ay} Q ${mx + (-dy / len) * curve} ${my + (dx / len) * curve} ${bx} ${by}`
}

/**
 * Section 09 — closing. Callback to the hero network, drawn in outline,
 * ending the page with a sense of completion.
 */
export function FinalCta() {
  const rootRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const reduced = usePrefersReducedMotion()
  const { open } = useDemo()

  useGSAP(
    () => {
      const root = rootRef.current
      const heading = headingRef.current
      if (!root || !heading) return

      const edges = root.querySelectorAll('[data-fedge]')
      const nodes = root.querySelectorAll('[data-fnode]')

      if (reduced) {
        gsap.set(edges, { drawSVG: '0% 100%', opacity: 0.5 })
        gsap.set(nodes, { opacity: 1 })
        return
      }

      // background network draws as the section enters
      gsap.fromTo(
        edges,
        { drawSVG: '0% 0%' },
        {
          drawSVG: '0% 100%',
          opacity: 0.4,
          duration: 1.6,
          stagger: 0.04,
          ease: 'power2.inOut',
          scrollTrigger: { trigger: root, start: 'top 75%', once: true },
        },
      )
      gsap.from(nodes, {
        opacity: 0,
        scale: 0.85,
        transformOrigin: 'center',
        duration: 0.7,
        stagger: { each: 0.04, from: 'random' },
        ease: 'back.out(1.6)',
        scrollTrigger: { trigger: root, start: 'top 75%', once: true },
      })

      // character-level reveal on the closing headline
      const split = SplitText.create(heading, {
        type: 'words, chars',
        charsClass: 'closing-char',
        smartWrap: true,
      })
      gsap.from(split.chars, {
        y: '0.4em',
        opacity: 0,
        duration: 0.9,
        stagger: 0.024,
        ease: 'power4.out',
        scrollTrigger: { trigger: heading, start: 'top 85%', once: true },
      })
    },
    { scope: rootRef, dependencies: [reduced] },
  )

  return (
    <section
      ref={rootRef}
      id="cta"
      aria-label="Get started"
      className="relative overflow-hidden bg-forest-deep py-28 text-white lg:py-40"
    >
      {/* outline network callback */}
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.55]"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid slice"
      >
        <g fill="none">
          {HERO_EDGES.map((e) => {
            const a = HERO_FRAGMENTS.find((f) => f.id === e.from)!
            const b = HERO_FRAGMENTS.find((f) => f.id === e.to)!
            return (
              <path
                key={`${e.from}-${e.to}`}
                data-fedge
                d={path(a, b, e.curve)}
                stroke="#4A7360"
                strokeWidth={1.2}
              />
            )
          })}
        </g>
        <g>
          {HERO_FRAGMENTS.map((f) => (
            <rect
              key={f.id}
              data-fnode
              x={f.x}
              y={f.y}
              width={nodeW(f.label)}
              height={NODE_H}
              rx={f.kind === 'person' || f.kind === 'decision' ? 19 : 4}
              fill="none"
              stroke={f.kind === 'person' || f.kind === 'evidence' ? '#D96B32' : '#4A7360'}
              strokeWidth={1.3}
            />
          ))}
        </g>
      </svg>

      {/* vignette so the type stays legible */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(36,69,52,0.94) 0%, rgba(36,69,52,0.82) 45%, rgba(36,69,52,0.55) 100%)',
        }}
      />

      <div className="relative mx-auto max-w-[1440px] px-5 text-center sm:px-8 lg:px-12">
        <p className="label-mono text-ember">08 / Begin</p>

        <h2
          ref={headingRef}
          className="mx-auto mt-7 max-w-5xl font-display text-[clamp(2.2rem,5.2vw,4.6rem)] leading-[1.04] tracking-[-0.03em]"
          aria-label="Let knowledge move forward. Not disappear."
        >
          Let knowledge move forward.{' '}
          <span className="block italic text-ember-soft">Not disappear.</span>
        </h2>

        <p
          className="mx-auto mt-8 max-w-xl text-[1.02rem] leading-relaxed text-white/65"
          style={{ textWrap: 'pretty' }}
        >
          Give every new team member the understanding they need to continue where others left
          off.
        </p>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
          <MagneticButton variant="ember" onClick={() => open('start')}>
            Start with ProjectPulse
            <ArrowUpRight
              size={15}
              strokeWidth={1.9}
              className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            />
          </MagneticButton>
          <MagneticButton
            variant="outline"
            className="border-white/30 text-white hover:border-white hover:bg-white hover:text-ink"
            onClick={() => open('explore')}
          >
            Revisit the demo
          </MagneticButton>
        </div>

        <p className="label-mono mt-14 text-white/35">
          Knowledge Intelligence <span className="text-ember">+</span> Authority Intelligence
        </p>
      </div>
    </section>
  )
}
