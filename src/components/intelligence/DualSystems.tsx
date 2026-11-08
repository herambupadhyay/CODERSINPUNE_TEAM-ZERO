import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { usePrefersReducedMotion } from '@/hooks/useMedia'
import { Reveal } from '@/components/ui/Reveal'
import { KnowledgeGraph } from '@/components/intelligence/KnowledgeGraph'
import { AuthorityLayer } from '@/components/intelligence/AuthorityLayer'
import { Network, KeyRound } from 'lucide-react'

/**
 * Section 05 — the two intelligence systems: connected, but separate.
 * Dark forest section for depth and contrast.
 */
export function DualSystems() {
  const rootRef = useRef<HTMLElement>(null)
  const reduced = usePrefersReducedMotion()

  useGSAP(
    () => {
      const root = rootRef.current
      if (!root || reduced) return

      // the "connector" line between the two systems draws on scroll
      const connector = root.querySelector('[data-connector]')
      if (connector) {
        gsap.fromTo(
          connector,
          { scaleX: 0 },
          {
            scaleX: 1,
            transformOrigin: 'left center',
            ease: 'none',
            scrollTrigger: {
              trigger: root,
              start: 'top 60%',
              end: 'center center',
              scrub: 0.6,
            },
          },
        )
      }

      // system headers rise in
      gsap.from(root.querySelectorAll('[data-system-head]'), {
        y: 40,
        opacity: 0,
        duration: 1,
        stagger: 0.15,
        ease: 'power4.out',
        scrollTrigger: { trigger: root, start: 'top 70%', once: true },
      })
    },
    { scope: rootRef, dependencies: [reduced] },
  )

  return (
    <section
      ref={rootRef}
      id="intelligence"
      aria-label="The two intelligence systems"
      className="relative bg-forest-deep py-24 text-white lg:py-32"
    >
      {/* subtle texture: vertical rules */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="mx-auto flex h-full max-w-[1440px] justify-between px-5 sm:px-8 lg:px-12">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className="block w-px bg-white/[0.05]" />
          ))}
        </div>
      </div>

      <div className="relative mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <div className="flex items-baseline justify-between border-b border-white/15 pb-4">
          <span className="label-mono text-ember">04 / Intelligence</span>
          <span className="label-mono hidden text-white/40 sm:block">Two systems · one handover</span>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-12">
          <Reveal as="h2" mode="lines" className="display-lg col-span-12 lg:col-span-8">
            One system knows what the organisation knows. The other knows who may act on it.
          </Reveal>
          <p className="body-lg col-span-12 max-w-md self-end lg:col-span-4" style={{ color: 'rgba(255,255,255,0.6)' }}>
            Connected, but deliberately separate. The knowledge graph never enforces access —
            it only informs it.
          </p>
        </div>

        {/* connector rule */}
        <div className="relative mt-14 h-px w-full bg-white/10" aria-hidden>
          <span
            data-connector
            className="absolute inset-0 block h-px origin-left"
            style={{ background: 'linear-gradient(90deg,#D96B32,#4A7360)' }}
          />
        </div>

        {/* System A */}
        <div className="mt-14" data-system-head>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="grid h-11 w-11 place-items-center border border-ember text-ember">
                <Network size={18} strokeWidth={1.6} />
              </span>
              <div>
                <p className="label-mono text-ember">System A</p>
                <h3 className="mt-1.5 font-display text-[clamp(1.6rem,2.6vw,2.4rem)] leading-none">
                  Knowledge Intelligence
                </h3>
              </div>
            </div>
            <p className="max-w-sm text-[0.9rem] leading-relaxed text-white/60">
              <span className="text-white">What does the organisation know?</span> It connects
              people, decisions, tasks, documents, dependencies, risks and evidence.
            </p>
          </div>

          <div className="mt-8">
            <KnowledgeGraph />
          </div>
        </div>

        {/* Divider statement */}
        <figure className="my-16 border-y border-white/15 py-10 lg:my-20">
          <blockquote className="mx-auto max-w-3xl text-center font-display text-[clamp(1.4rem,2.6vw,2.2rem)] leading-snug italic text-white">
            &ldquo;Receiving someone&rsquo;s knowledge does not mean inheriting their
            authority.&rdquo;
          </blockquote>
        </figure>

        {/* System B */}
        <div data-system-head>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="grid h-11 w-11 place-items-center border border-ember text-ember">
                <KeyRound size={18} strokeWidth={1.6} />
              </span>
              <div>
                <p className="label-mono text-ember">System B</p>
                <h3 className="mt-1.5 font-display text-[clamp(1.6rem,2.6vw,2.4rem)] leading-none">
                  Authority Intelligence
                </h3>
              </div>
            </div>
            <p className="max-w-sm text-[0.9rem] leading-relaxed text-white/60">
              <span className="text-white">Who is allowed to access or act on it?</span> Roles,
              scopes and approval rights stay explicit — and enforceable.
            </p>
          </div>

          <div className="mt-8">
            <AuthorityLayer />
          </div>
        </div>
      </div>
    </section>
  )
}
