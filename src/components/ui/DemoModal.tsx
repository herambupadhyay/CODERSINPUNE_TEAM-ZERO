import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { X, ArrowUpRight, Check } from 'lucide-react'
import { gsap, useGSAP } from '@/lib/gsap'

type DemoState = { open: boolean; variant: 'explore' | 'start' | null }

const DemoContext = createContext<{
  open: (variant?: 'explore' | 'start') => void
  close: () => void
}>({ open: () => {}, close: () => {} })

export function useDemo() {
  return useContext(DemoContext)
}

const COPY = {
  explore: {
    kicker: 'Product tour',
    title: 'This is a design prototype.',
    body: 'The full ProjectPulse application — workspaces, uploads, verified handover generation — is not part of this experiment. Everything you see on this page is a front-end reconstruction of the product experience.',
    points: [
      'Scroll the page to walk the full narrative',
      'Interact with the knowledge and authority demos',
      'The handover report below is sample data',
    ],
    cta: 'Back to the page',
  },
  start: {
    kicker: 'Early access',
    title: 'ProjectPulse is a prototype.',
    body: 'There is no account system behind this page. If this experiment resonates, the next step is the section above — not a signup form.',
    points: [
      'No data is collected or transmitted',
      'All sample projects are fictional',
      'Built as a front-end interaction study',
    ],
    cta: 'Understood',
  },
} as const

export function DemoModalProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>({ open: false, variant: null })
  const panelRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  const open = useCallback((variant: 'explore' | 'start' = 'explore') => {
    setState({ open: true, variant })
  }, [])
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), [])

  useEffect(() => {
    if (!state.open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [state.open, close])

  useGSAP(
    () => {
      if (state.open && panelRef.current) {
        gsap.fromTo(backdropRef.current, { opacity: 0 }, { opacity: 1, duration: 0.4 })
        gsap.fromTo(
          panelRef.current,
          { y: 40, opacity: 0, scale: 0.97 },
          { y: 0, opacity: 1, scale: 1, duration: 0.55, ease: 'power4.out' },
        )
      }
    },
    { dependencies: [state.open] },
  )

  const copy = COPY[state.variant ?? 'explore']

  return (
    <DemoContext.Provider value={{ open, close }}>
      {children}
      {state.open && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
            <div
              ref={backdropRef}
              className="absolute inset-0 bg-ink/45 backdrop-blur-[3px]"
              onClick={close}
              aria-hidden
            />
            <div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="demo-title"
              className="relative w-full max-w-lg border border-line bg-paper p-7 sm:p-9 shadow-[0_30px_80px_-30px_rgba(32,35,31,0.35)]"
            >
              <button
                onClick={close}
                aria-label="Close dialog"
                className="absolute right-4 top-4 grid h-9 w-9 place-items-center text-muted transition-colors hover:text-ink"
              >
                <X size={17} strokeWidth={1.6} />
              </button>

              <p className="label-mono text-ember">{copy.kicker}</p>
              <h2 id="demo-title" className="display-md mt-4 text-ink">
                {copy.title}
              </h2>
              <p className="mt-4 text-[0.95rem] leading-relaxed text-muted">{copy.body}</p>

              <ul className="mt-6 space-y-3 border-t border-line pt-6">
                {copy.points.map((p) => (
                  <li key={p} className="flex items-start gap-3 text-sm text-ink/80">
                    <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-forest text-paper">
                      <Check size={10} strokeWidth={3} />
                    </span>
                    {p}
                  </li>
                ))}
              </ul>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button
                  onClick={close}
                  className="group inline-flex items-center gap-2 bg-ink px-6 py-3.5 text-sm font-medium text-paper transition-colors hover:bg-forest"
                >
                  {copy.cta}
                  <ArrowUpRight
                    size={15}
                    strokeWidth={1.8}
                    className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  />
                </button>
              </div>
            </div>
          </div>
      )}
    </DemoContext.Provider>
  )
}
