import { useRef, useState } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { usePrefersReducedMotion } from '@/hooks/useMedia'
import { ROLES, SUCCESSOR_DENIED, SUCCESSOR_GRANTED } from '@/data/intelligence'
import { Check, Lock, ChevronRight } from 'lucide-react'

/**
 * Authority Intelligence: a scoped permission boundary demo.
 * Forest green = authorised. Burnt orange = boundary / denied.
 */
export function AuthorityLayer() {
  const [active, setActive] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()

  useGSAP(
    () => {
      const root = rootRef.current
      if (!root || reduced) return

      const boundary = root.querySelector('[data-boundary]')
      const granted = root.querySelectorAll('[data-granted]')
      const denied = root.querySelectorAll('[data-denied]')
      const roleChips = root.querySelectorAll('[data-role]')

      gsap.set(boundary, { scaleX: 0, transformOrigin: 'left center' })
      gsap.set(granted, { opacity: 0.35, x: -8 })
      gsap.set(denied, { opacity: 0.35, x: -8 })

      const tl = gsap.timeline({ paused: true })
      tl.to(roleChips, {
        borderColor: (i: number) => (i === ROLES.length - 1 ? '#D96B32' : 'rgba(255,255,255,0.2)'),
        color: (i: number) => (i === ROLES.length - 1 ? '#D96B32' : 'rgba(255,255,255,0.85)'),
        duration: 0.4,
        stagger: 0.08,
      })
        .to(boundary, { scaleX: 1, duration: 0.7, ease: 'power4.inOut' }, 0.3)
        .to(granted, { opacity: 1, x: 0, duration: 0.45, stagger: 0.09, ease: 'power3.out' }, 0.7)
        .to(denied, { opacity: 1, x: 0, duration: 0.45, stagger: 0.09, ease: 'power3.out' }, 1.0)

      if (active) tl.play()
      else tl.reverse()

      return () => {
        tl.kill()
      }
    },
    { scope: rootRef, dependencies: [active, reduced] },
  )

  return (
    <div ref={rootRef} className="grid gap-6 lg:grid-cols-2">
      {/* Role ladder */}
      <div className="border border-white/15 bg-white/[0.03] p-6">
        <p className="label-mono text-white/40">Authority hierarchy</p>
        <ol className="mt-5 space-y-3">
          {ROLES.map((r, i) => (
            <li key={r.id} data-role>
              <div
                className="flex items-center gap-4 border px-4 py-3.5 transition-colors duration-500"
                style={{
                  marginLeft: `${i * 14}px`,
                  borderColor: 'rgba(255,255,255,0.14)',
                  background: i === ROLES.length - 1 ? 'rgba(217,107,50,0.07)' : 'transparent',
                }}
              >
                <span className="label-mono w-6 shrink-0 text-white/35">0{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.92rem] font-medium text-white/90">{r.label}</p>
                  <p className="label-mono mt-1 text-white/40">{r.scope}</p>
                </div>
                {i > 0 && (
                  <ChevronRight size={14} className="shrink-0 text-white/25" aria-hidden />
                )}
              </div>
              {i < ROLES.length - 1 && (
                <span
                  aria-hidden
                  className="ml-[26px] block h-3 w-px bg-white/15"
                  style={{ marginLeft: `${i * 14 + 26}px` }}
                />
              )}
            </li>
          ))}
        </ol>

        <button
          onClick={() => setActive((v) => !v)}
          className="mt-6 w-full border border-ember bg-ember/10 px-5 py-3.5 text-sm font-medium text-ember transition-colors duration-300 hover:bg-ember hover:text-paper"
          aria-expanded={active}
        >
          {active ? 'Reset the transfer' : 'Transfer access to the successor'}
        </button>
      </div>

      {/* Scope boundary */}
      <div className="relative overflow-hidden border border-white/15 bg-white/[0.03] p-6">
        <p className="label-mono text-white/40">Scoped transfer · New successor</p>

        <div className="mt-5">
          <p className="label-mono mb-3 text-forest-soft" style={{ color: '#8FBFA5' }}>
            Granted — authorised scope
          </p>
          <ul className="space-y-2.5">
            {SUCCESSOR_GRANTED.map((g) => (
              <li
                key={g}
                data-granted
                className="flex items-start gap-3 border border-forest/50 bg-forest/20 px-3.5 py-3 text-[0.85rem] leading-snug text-white/90"
              >
                <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-forest">
                  <Check size={10} strokeWidth={3} color="#fff" />
                </span>
                {g}
              </li>
            ))}
          </ul>

          <div className="my-7">
            <p className="label-mono mb-2.5 text-center" style={{ color: '#D96B32' }}>
              Permission boundary
            </p>
            <span
              data-boundary
              aria-hidden
              className="block h-3.5 w-full origin-left"
              style={{
                background:
                  'repeating-linear-gradient(90deg, #D96B32 0 10px, transparent 10px 18px)',
                opacity: 0.5,
              }}
            />
          </div>

          <p className="label-mono mb-3" style={{ color: '#D96B32' }}>
            Not inherited — outside scope
          </p>
          <ul className="space-y-2.5">
            {SUCCESSOR_DENIED.map((d) => (
              <li
                key={d}
                data-denied
                className="flex items-start gap-3 border border-ember/50 bg-ember/[0.08] px-3.5 py-3 text-[0.85rem] leading-snug text-white/75"
              >
                <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border border-ember">
                  <Lock size={9} strokeWidth={2.5} color="#D96B32" />
                </span>
                {d}
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-6 border-t border-white/10 pt-4 text-[0.8rem] leading-relaxed text-white/50">
          Receiving someone&rsquo;s knowledge does not mean inheriting their authority.
        </p>
      </div>
    </div>
  )
}
