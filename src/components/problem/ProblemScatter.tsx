import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { usePrefersReducedMotion } from '@/hooks/useMedia'

type Piece = {
  id: string
  label: string
  meta: string
  /** final resting position (% of stage) */
  fx: number
  fy: number
  /** scattered start position offset */
  sx: number
  sy: number
  rot: number
  kind: 'note' | 'doc' | 'board' | 'tech' | 'decision' | 'chat' | 'person'
}

const PIECES: Piece[] = [
  { id: 'p1', label: 'Sprint review — notes', meta: 'Meeting · 12 Mar', fx: 8, fy: 14, sx: -14, sy: -22, rot: -7, kind: 'note' },
  { id: 'p2', label: 'Payments Platform brief', meta: 'Doc · v4', fx: 36, fy: 6, sx: 10, sy: -30, rot: 5, kind: 'doc' },
  { id: 'p3', label: 'PP-142 · Migration', meta: 'Board · In progress', fx: 68, fy: 12, sx: 22, sy: -16, rot: -4, kind: 'board' },
  { id: 'p4', label: 'Rollout runbook', meta: 'Tech doc · §2', fx: 86, fy: 34, sx: 30, sy: 8, rot: 8, kind: 'tech' },
  { id: 'p5', label: '“Go with Postgres”', meta: 'Decision · unlogged', fx: 58, fy: 44, sx: 6, sy: 14, rot: -3, kind: 'decision' },
  { id: 'p6', label: '#payments-platform', meta: 'Chat · 438 msgs', fx: 22, fy: 46, sx: -20, sy: 18, rot: 6, kind: 'chat' },
  { id: 'p7', label: 'A. Rahman', meta: 'Person · leaving', fx: 6, fy: 74, sx: -26, sy: 26, rot: -6, kind: 'person' },
  { id: 'p8', label: 'Q3 risk register', meta: 'Doc · stale', fx: 40, fy: 76, sx: 4, sy: 30, rot: 4, kind: 'doc' },
  { id: 'p9', label: 'PP-099 · Rollback', meta: 'Board · blocked', fx: 72, fy: 72, sx: 18, sy: 24, rot: -8, kind: 'board' },
  { id: 'p10', label: '“Ask Amir”', meta: 'Chat · unresolved', fx: 90, fy: 66, sx: 26, sy: 20, rot: 5, kind: 'chat' },
]

/** Connections that only become visible late in the scroll */
const LINKS: Array<[string, string]> = [
  ['p1', 'p5'],
  ['p5', 'p2'],
  ['p2', 'p3'],
  ['p3', 'p9'],
  ['p6', 'p5'],
  ['p6', 'p7'],
  ['p7', 'p9'],
  ['p4', 'p3'],
  ['p8', 'p5'],
  ['p10', 'p9'],
  ['p10', 'p4'],
  ['p1', 'p6'],
]

const KIND_STYLE: Record<Piece['kind'], string> = {
  note: 'bg-cream border-line text-ink',
  doc: 'bg-paper border-ink/20 text-ink',
  board: 'bg-paper border-forest/40 text-ink',
  tech: 'bg-cream border-line text-ink',
  decision: 'bg-forest border-forest text-paper',
  chat: 'bg-paper border-ember/50 text-ink',
  person: 'bg-ember border-ember text-paper',
}

/**
 * Section 03 — pinned scrub: fragments drift in independently, overlap,
 * then links draw and everything settles into an ordered lattice.
 */
export function ProblemScatter() {
  const rootRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()

  useGSAP(
    () => {
      const root = rootRef.current
      const stage = stageRef.current
      if (!root || !stage) return

      const pieces = gsap.utils.toArray<HTMLElement>(stage.querySelectorAll('[data-piece]'))
      const links = gsap.utils.toArray<SVGPathElement>(stage.querySelectorAll('[data-link]'))
      const heading = stage.querySelector('[data-problem-heading]')
      const caption = stage.querySelector('[data-problem-caption]')
      const order = stage.querySelector('[data-problem-order]')

      if (reduced) {
        gsap.set(pieces, { x: 0, y: 0, rotation: 0, opacity: 1 })
        gsap.set(links, { drawSVG: '0% 100%', opacity: 1 })
        gsap.set([caption, order], { opacity: 1 })
        return
      }

      // initial: scattered far from home
      pieces.forEach((el) => {
        const sx = Number(el.dataset.sx)
        const sy = Number(el.dataset.sy)
        const rot = Number(el.dataset.rot)
        gsap.set(el, { xPercent: sx * 3.4, yPercent: sy * 3.4, rotation: rot * 2.4, opacity: 0 })
      })
      gsap.set(links, { drawSVG: '0% 0%', opacity: 0 })
      gsap.set([caption, order], { opacity: 0 })

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: root,
          start: 'top top',
          end: '+=280%',
          pin: true,
          scrub: 1,
          anticipatePin: 1,
        },
      })

      // 1 — fragments appear at different depths
      tl.to(
        pieces,
        {
          opacity: 1,
          duration: 0.5,
          stagger: { each: 0.05, from: 'random' },
          ease: 'power2.out',
        },
        0,
      )

      // 2 — drift independently (imperfect, human placement)
      tl.to(
        pieces,
        {
          xPercent: (i: number) => (i % 2 === 0 ? 3.5 : -3),
          yPercent: (i: number) => (i % 3 === 0 ? -4 : 3),
          rotation: (i: number) => (i % 2 === 0 ? 3 : -3.5),
          duration: 1.4,
          stagger: { each: 0.03, from: 'random' },
          ease: 'sine.inOut',
        },
        0.35,
      )

      // 3 — overlap / crowd toward the centre
      tl.to(
        pieces,
        {
          xPercent: (i: number) => (i % 2 === 0 ? 14 : -12),
          yPercent: (i: number) => (i % 2 === 0 ? 10 : -8),
          duration: 1.1,
          stagger: { each: 0.02, from: 'center' },
          ease: 'power2.inOut',
        },
        1.6,
      )
      tl.to(caption, { opacity: 1, duration: 0.4 }, 1.7)

      // 4 — connections become visible
      tl.to(links, { opacity: 1, duration: 0.3, stagger: 0.03 }, 2.5)
      tl.to(links, { drawSVG: '0% 100%', duration: 1.1, stagger: 0.05, ease: 'power2.inOut' }, 2.55)

      // 5 — settle into the ordered lattice
      tl.to(
        pieces,
        {
          xPercent: 0,
          yPercent: 0,
          rotation: 0,
          duration: 1.3,
          stagger: { each: 0.03, from: 'edges' },
          ease: 'power3.inOut',
        },
        3.5,
      )
      tl.to(caption, { opacity: 0, duration: 0.4 }, 3.6)
      tl.to(order, { opacity: 1, duration: 0.5 }, 4.4)

      // heading emphasis: colour shift on "connected"
      const word = heading?.querySelector('[data-emph]')
      if (word) {
        tl.to(word, { color: '#D96B32', duration: 0.5 }, 4.3)
      }

      tl.to({}, { duration: 0.6 }) // hold at the end
    },
    { scope: rootRef, dependencies: [reduced] },
  )

  return (
    <section
      ref={rootRef}
      id="product"
      aria-label="The problem"
      className="relative bg-cream"
    >
      <div className="flex h-svh min-h-[640px] flex-col overflow-hidden">
        {/* Section header */}
        <div className="mx-auto w-full max-w-[1440px] shrink-0 px-5 pt-24 sm:px-8 lg:px-12 lg:pt-28">
          <div className="flex items-baseline justify-between border-b border-line pb-4">
            <span className="label-mono text-ember">02 / The problem</span>
            <span className="label-mono hidden text-muted sm:block">Fragmented reality</span>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-12">
            <h2
              data-problem-heading
              className="display-lg col-span-12 text-ink lg:col-span-7"
            >
              Your project has a memory. But is it{' '}
              <span data-emph className="text-muted">
                connected
              </span>
              ?
            </h2>
            <p className="body-lg col-span-12 max-w-md lg:col-span-4 lg:col-start-9 lg:pt-2">
              The same truth is scattered across a dozen tools. Reconstructing it by hand is
              slow, incomplete — and impossible the day someone leaves.
            </p>
          </div>
        </div>

        {/* Stage */}
        <div ref={stageRef} className="relative mx-auto w-full max-w-[1440px] flex-1 px-5 sm:px-8 lg:px-12">
          {/* links SVG */}
          <svg
            className="pointer-events-none absolute inset-5 z-0 h-[calc(100%-2.5rem)] w-[calc(100%-2.5rem)] sm:inset-8 lg:inset-12"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
          >
            {LINKS.map(([a, b]) => {
              const pa = PIECES.find((p) => p.id === a)!
              const pb = PIECES.find((p) => p.id === b)!
              return (
                <line
                  key={`${a}-${b}`}
                  data-link
                  x1={pa.fx + 7}
                  y1={pa.fy + 4}
                  x2={pb.fx + 7}
                  y2={pb.fy + 4}
                  stroke="#315B45"
                  strokeWidth={1.4}
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}
          </svg>

          {/* pieces */}
          {PIECES.map((p) => (
            <article
              key={p.id}
              data-piece
              data-sx={p.sx}
              data-sy={p.sy}
              data-rot={p.rot}
              className={`absolute z-10 border px-3.5 py-2.5 shadow-[0_10px_30px_-18px_rgba(32,35,31,0.4)] ${KIND_STYLE[p.kind]}`}
              style={{ left: `${p.fx}%`, top: `${p.fy}%`, width: 'clamp(140px, 15vw, 210px)' }}
            >
              <p className="truncate text-[0.8rem] leading-tight font-medium">{p.label}</p>
              <p
                className={`label-mono mt-1.5 text-[0.58rem] ${
                  p.kind === 'decision' || p.kind === 'person' ? 'text-paper/70' : 'text-muted'
                }`}
              >
                {p.meta}
              </p>
            </article>
          ))}

          {/* captions */}
          <p
            data-problem-caption
            className="label-mono pointer-events-none absolute bottom-6 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap bg-ink px-4 py-2 text-paper opacity-0"
          >
            10 sources · 0 connections
          </p>
          <p
            data-problem-order
            className="label-mono pointer-events-none absolute bottom-6 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap bg-forest px-4 py-2 text-paper opacity-0"
          >
            One reconstructable picture
          </p>
        </div>
      </div>
    </section>
  )
}
