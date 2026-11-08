import { useRef } from 'react'
import { gsap, SplitText, useGSAP } from '@/lib/gsap'
import { usePrefersReducedMotion } from '@/hooks/useMedia'
import { useScroll } from '@/hooks/useScroll'
import { useDemo } from '@/components/ui/DemoModal'
import { MagneticButton } from '@/components/ui/MagneticButton'
import { HeroNetwork } from '@/components/hero/HeroNetwork'
import { ArrowDown, Play } from 'lucide-react'

export function Hero() {
  const rootRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const reduced = usePrefersReducedMotion()
  const { scrollTo } = useScroll()
  const { open } = useDemo()

  useGSAP(
    () => {
      const root = rootRef.current
      const heading = headingRef.current
      if (!root || !heading) return

      if (reduced) {
        gsap.set(root.querySelectorAll('[data-hero-fade]'), { opacity: 1, y: 0 })
        return
      }

      SplitText.create(heading, {
        type: 'lines, words',
        mask: 'lines',
        linesClass: 'split-line',
        autoSplit: true,
        onSplit(self) {
          return gsap
            .timeline({ delay: 0.15 })
            .from(self.lines, {
              yPercent: 112,
              duration: 1.15,
              stagger: 0.09,
              ease: 'power4.out',
            })
            .from(
              root.querySelectorAll('[data-hero-fade]'),
              { opacity: 0, y: 26, duration: 0.9, stagger: 0.1, ease: 'power3.out' },
              0.55,
            )
            .from(
              root.querySelector('[data-hero-visual]'),
              { opacity: 0, scale: 0.965, duration: 1.4, ease: 'power3.out' },
              0.3,
            )
            .from(root.querySelector('[data-scroll-cue]'), { opacity: 0, duration: 0.8 }, 1.4)
        },
      })

      // parallax on the visual while scrolling out of the hero
      gsap.to(root.querySelector('[data-hero-visual]'), {
        yPercent: 12,
        ease: 'none',
        scrollTrigger: {
          trigger: root,
          start: 'top top',
          end: 'bottom top',
          scrub: true,
        },
      })

      // headline fades slightly as you leave
      gsap.to(root.querySelector('[data-hero-copy]'), {
        opacity: 0.15,
        y: -40,
        ease: 'none',
        scrollTrigger: {
          trigger: root,
          start: '40% top',
          end: 'bottom top',
          scrub: true,
        },
      })
    },
    { scope: rootRef, dependencies: [reduced] },
  )

  return (
    <section
      ref={rootRef}
      id="top"
      aria-label="Introduction"
      className="relative overflow-hidden bg-paper pt-28 sm:pt-32 lg:pt-36"
    >
      {/* editorial top rule */}
      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <div className="flex items-center justify-between border-b border-line pb-4" data-hero-fade>
          <span className="label-mono text-muted">AI Handover Assistant</span>
          <span className="label-mono hidden text-muted sm:block">
            Knowledge Intelligence <span className="text-ember">·</span> Authority Intelligence
          </span>
          <span className="label-mono text-muted">01 / 10</span>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1440px] gap-10 px-5 pt-10 sm:px-8 lg:grid-cols-12 lg:gap-6 lg:px-12 lg:pt-16">
        {/* Copy column — asymmetric: sits cols 1-6, with offset */}
        <div data-hero-copy className="lg:col-span-6 lg:pr-6 xl:col-span-5">
          <h1
            ref={headingRef}
            className="display-xl text-ink"
            aria-label="Don't just transfer work. Transfer understanding."
          >
            Don&rsquo;t just transfer work. Transfer{' '}
            <em className="italic text-ember">
              understanding
            </em>
            .
          </h1>

          <p data-hero-fade className="body-lg mt-8 max-w-xl">
            ProjectPulse turns scattered project knowledge into structured, connected and
            actionable handovers — so your team&rsquo;s progress doesn&rsquo;t disappear when
            someone moves on.
          </p>

          <div data-hero-fade className="mt-10 flex flex-wrap items-center gap-3">
            <MagneticButton variant="solid" onClick={() => open('explore')}>
              Explore ProjectPulse
              <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">
                →
              </span>
            </MagneticButton>
            <MagneticButton variant="outline" onClick={() => scrollTo('#how-it-works', -60)}>
              <Play size={13} strokeWidth={2} className="fill-current" />
              See how it works
            </MagneticButton>
          </div>

          {/* micro stats strip */}
          <dl
            data-hero-fade
            className="mt-14 grid max-w-md grid-cols-3 gap-4 border-t border-line pt-6"
          >
            {[
              { t: 'Sources', v: 'Docs · Notes · Tasks' },
              { t: 'Output', v: 'Evidence-backed' },
              { t: 'Control', v: 'Human-approved' },
            ].map((s) => (
              <div key={s.t}>
                <dt className="label-mono text-muted">{s.t}</dt>
                <dd className="mt-1.5 text-[0.8rem] leading-snug font-medium text-ink">{s.v}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Visual column */}
        <div
          data-hero-visual
          className="relative lg:col-span-6 lg:col-start-7 xl:col-span-7"
        >
          <div className="relative">
            {/* corner ticks — editorial framing */}
            <span className="absolute -left-2 -top-2 h-4 w-4 border-l border-t border-ink/25" aria-hidden />
            <span className="absolute -right-2 -top-2 h-4 w-4 border-r border-t border-ink/25" aria-hidden />
            <span className="absolute -bottom-2 -left-2 h-4 w-4 border-b border-l border-ink/25" aria-hidden />
            <span className="absolute -bottom-2 -right-2 h-4 w-4 border-b border-r border-ink/25" aria-hidden />
            <HeroNetwork />
          </div>
          <p
            data-hero-fade
            className="label-mono mt-4 text-center text-muted lg:text-right"
          >
            Fig. 01 — fragments → connected understanding
          </p>
        </div>
      </div>

      {/* Scroll cue */}
      <div
        data-scroll-cue
        className="mx-auto mt-14 flex max-w-[1440px] items-center gap-4 px-5 pb-10 sm:px-8 lg:px-12"
      >
        <button
          onClick={() => scrollTo('#product', -60)}
          className="group flex items-center gap-3 text-muted transition-colors hover:text-ink"
        >
          <span className="relative grid h-9 w-9 place-items-center rounded-full border border-line">
            <ArrowDown
              size={14}
              strokeWidth={1.8}
              className="transition-transform duration-500 group-hover:translate-y-1"
            />
            <span className="absolute inset-0 rounded-full border border-ember/0 transition-colors duration-500 group-hover:border-ember/60" />
          </span>
          <span className="label-mono">Scroll to reconstruct</span>
        </button>
        <span className="hidden h-px flex-1 bg-line sm:block" />
      </div>
    </section>
  )
}
