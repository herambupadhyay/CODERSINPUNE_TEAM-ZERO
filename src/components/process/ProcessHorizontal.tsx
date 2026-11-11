import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { usePrefersReducedMotion, useDesktop } from '@/hooks/useMedia'
import { Reveal } from '@/components/ui/Reveal'
import { FileStack, ScanLine, ShieldCheck, ArrowRight } from 'lucide-react'

type Stage = {
  n: string
  title: string
  lead: string
  body: string
  icon: typeof FileStack
  meta: string
}

const STAGES: Stage[] = [
  {
    n: '01',
    title: 'Ingest',
    lead: "Bring your project's knowledge together.",
    body: 'Upload authorised project documents, meeting notes, task exports and technical records. Sources stay traceable from the first byte.',
    icon: FileStack,
    meta: 'Docs · Notes · Boards · Exports',
  },
  {
    n: '02',
    title: 'Understand',
    lead: 'Extract what actually matters.',
    body: 'Identify decisions, ownership, unfinished work, risks, dependencies and project context — connected to the people who hold them.',
    icon: ScanLine,
    meta: 'Decisions · Owners · Risks · Context',
  },
  {
    n: '03',
    title: 'Verify',
    lead: 'Every important claim needs evidence.',
    body: 'Connect findings to source documents. Identify missing information, conflicting records and uncertain claims before anyone relies on them.',
    icon: ShieldCheck,
    meta: 'Evidence · Conflicts · Gaps · Confidence',
  },
  {
    n: '04',
    title: 'Handover',
    lead: 'Make continuity possible.',
    body: 'Generate structured, role-appropriate handovers that help the next person continue with clarity — approved by people.',
    icon: ArrowRight,
    meta: 'Scoped · Reviewed · Approved',
  },
]

/** Micro-illustration that transforms across stages */
function StageVisual({ index }: { index: number }) {
  return (
    <div data-bar className="relative h-48 w-full overflow-hidden border border-line bg-cream sm:h-52 lg:h-44">
      {/* progress spine */}
      <div className="absolute left-8 top-0 h-full w-px bg-line" aria-hidden />
      <div
        className="absolute left-8 top-0 w-px bg-ember transition-all duration-700 ease-out"
        style={{ height: `${((index + 1) / STAGES.length) * 100}%` }}
        aria-hidden
      />

      <div className="relative flex h-full flex-col justify-center gap-3 pl-16 pr-6">
        {[0, 1, 2, 3, 4].map((i) => {
          const active = i <= index
          const isNow = i === index
          return (
            <div
              key={i}
              className={`h-8 border transition-all duration-500 ease-out ${
                isNow
                  ? 'w-[85%] border-ember bg-ember/10'
                  : active
                    ? 'w-[70%] border-forest/40 bg-forest/5'
                    : 'w-[55%] border-line bg-paper'
              }`}
              style={{
                transitionDelay: `${i * 60}ms`,
                paddingLeft: '0.75rem',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <span
                className={`label-mono text-[0.55rem] ${isNow ? 'text-ember' : active ? 'text-forest' : 'text-muted/60'}`}
              >
                {isNow ? 'active' : active ? 'resolved' : 'raw'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Section 04 — one connected process.
 * Desktop: pinned horizontal track with drawn progress path.
 * Mobile: vertical stack with reveal-on-enter.
 */
export function ProcessHorizontal() {
  const rootRef = useRef<HTMLElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const pinRef = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()
  const desktop = useDesktop()

  useGSAP(
    () => {
      const root = rootRef.current
      const track = trackRef.current
      const pin = pinRef.current
      if (!root || !track || !pin) return

      const panels = gsap.utils.toArray<HTMLElement>(track.querySelectorAll('[data-stage]'))
      const progressBar = root.querySelector('[data-progress]')
      const stepDots = gsap.utils.toArray<HTMLElement>(root.querySelectorAll('[data-dot]'))

      if (reduced || !desktop) {
        gsap.set(panels, { clearProps: 'all' })
        return
      }

      const getDistance = () => track.scrollWidth - pin.offsetWidth

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: root,
          start: 'top top',
          end: () => `+=${getDistance() + window.innerHeight * 0.6}`,
          pin: pin,
          scrub: 1,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            if (progressBar) {
              gsap.set(progressBar, { scaleX: self.progress })
            }
            const idx = Math.min(
              STAGES.length - 1,
              Math.floor(self.progress * STAGES.length + 0.15),
            )
            stepDots.forEach((d, i) => {
              d.classList.toggle('bg-ember', i <= idx)
              d.classList.toggle('bg-line', i > idx)
              d.classList.toggle('w-10', i === idx)
              d.classList.toggle('w-4', i !== idx)
            })
          },
        },
      })

      tl.to(track, {
        x: () => -getDistance(),
        ease: 'none',
        duration: 1,
      })

      // per-stage activation: visual transforms as each panel centres
      panels.forEach((panel, i) => {
        const visual = panel.querySelectorAll('[data-bar]')
        if (!visual.length) return
        tl.fromTo(
          visual,
          { filter: 'saturate(0.4)', opacity: 0.7 },
          { filter: 'saturate(1)', opacity: 1, duration: 0.18 },
          i / STAGES.length,
        )
      })

      return () => {
        tl.scrollTrigger?.kill()
        tl.kill()
      }
    },
    { scope: rootRef, dependencies: [reduced, desktop] },
  )

  const content = (
    <div className="mx-auto w-full max-w-[1440px] px-5 sm:px-8 lg:px-12">
      <div className="flex items-baseline justify-between border-b border-line pb-3 lg:pb-2.5">
        <span className="label-mono text-ember">03 / How it works</span>
        <span className="label-mono hidden text-muted sm:block">Four stages · one process</span>
      </div>

      <div className="mt-5 grid gap-5 lg:mt-4 lg:grid-cols-12 lg:gap-6">
        <Reveal
          as="h2"
          mode="lines"
          className="display-lg col-span-12 text-ink lg:col-span-7 lg:text-[clamp(1.9rem,3vw,3.1rem)]"
        >
          From scattered files to a handover someone can actually use.
        </Reveal>
        <p className="body-lg col-span-12 max-w-md lg:col-span-4 lg:col-start-9 lg:self-end lg:pt-0 lg:text-[0.95rem]">
          Each stage feeds the next. Nothing is summarised into thin air — every claim keeps a
          line back to its source.
        </p>
      </div>

      {/* progress indicator */}
      <div className="mt-6 flex items-center gap-4 lg:mt-5" aria-hidden>
        <div className="relative h-px flex-1 bg-line">
          <div
            data-progress
            className="absolute inset-y-0 left-0 w-full origin-left scale-x-0 bg-ember"
          />
        </div>
        <div className="flex items-center gap-2">
          {STAGES.map((s) => (
            <span
              key={s.n}
              data-dot
              className="block h-1 w-4 bg-line transition-all duration-300"
            />
          ))}
        </div>
      </div>
    </div>
  )

  const stagePanel = (s: Stage, i: number, horizontal: boolean) => {
    const Icon = s.icon
    return (
      <article
        key={s.n}
        data-stage
        className={
          horizontal
            ? 'flex w-[86vw] shrink-0 flex-col justify-center sm:w-[74vw] lg:w-[56vw] xl:w-[46vw]'
            : 'flex w-full flex-col'
        }
        aria-label={`Stage ${s.n}: ${s.title}`}
      >
        <div className="flex items-center gap-4">
          <span className="label-mono text-ember">{s.n}</span>
          <span className="h-px flex-1 bg-line" />
          <Icon size={18} strokeWidth={1.5} className="text-muted" />
        </div>

        <h3 className="mt-5 font-display text-[clamp(2rem,3.4vw,3.25rem)] leading-none tracking-tight text-ink">
          {s.title}
        </h3>
        <p className="mt-3.5 max-w-lg font-display text-[clamp(1.1rem,1.5vw,1.4rem)] leading-snug text-forest italic">
          {s.lead}
        </p>
        <p className="mt-3.5 max-w-lg text-[0.92rem] leading-relaxed text-muted">{s.body}</p>

        <div className="mt-6">
          <StageVisual index={i} />
          <p className="label-mono mt-2.5 text-muted">{s.meta}</p>
        </div>
      </article>
    )
  }

  return (
    <section
      ref={rootRef}
      id="how-it-works"
      aria-label="How ProjectPulse works"
      className="relative bg-paper"
    >
      <div
        ref={pinRef}
        className="overflow-hidden py-24 lg:flex lg:h-svh lg:min-h-[700px] lg:flex-col lg:justify-center lg:py-16"
      >
        {content}

        {desktop && !reduced ? (
          <div className="mt-12 lg:mt-8">
            <div
              ref={trackRef}
              className="flex items-stretch gap-10 pl-5 pr-5 sm:gap-14 sm:pl-8 sm:pr-8 lg:gap-20 lg:pl-12 lg:pr-12"
            >
              {STAGES.map((s, i) => stagePanel(s, i, true))}
            </div>
          </div>
        ) : (
          <div className="mt-12 flex flex-col gap-16">
            {STAGES.map((s, i) => stagePanel(s, i, false))}
          </div>
        )}
      </div>
    </section>
  )
}
