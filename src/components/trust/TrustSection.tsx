import { useRef, useState } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { usePrefersReducedMotion } from '@/hooks/useMedia'
import { Reveal } from '@/components/ui/Reveal'
import { Check, AlertTriangle, GitCompare, Undo2 } from 'lucide-react'

const PRINCIPLES = [
  {
    n: '01',
    title: 'Evidence-backed information',
    body: 'Every finding links to the document, section or record it came from. Nothing floats free of its source.',
  },
  {
    n: '02',
    title: 'Uncertainty is clearly identified',
    body: 'Verified, uncertain and conflicting are first-class labels — not footnotes. Missing information is stated as missing.',
  },
  {
    n: '03',
    title: 'Human review before sharing',
    body: 'Drafts are checked by people before anything is final. Nothing leaves the workspace without a reviewer.',
  },
  {
    n: '04',
    title: 'Role-appropriate information access',
    body: 'Authority Intelligence scopes what each recipient sees — separate from what the system knows.',
  },
  {
    n: '05',
    title: 'Controlled handover approval',
    body: 'A named approver signs off the final handover, with a record of what was included and why.',
  },
]

type Status = 'awaiting' | 'approved' | 'revised'

const LEGEND = [
  { label: 'Verified', color: 'bg-forest', text: 'text-forest', border: 'border-forest/40' },
  { label: 'Uncertain', color: 'bg-ember', text: 'text-ember', border: 'border-ember/40' },
  { label: 'Conflicting', color: 'bg-ink', text: 'text-ink', border: 'border-ink/40' },
]

function ApprovalCard() {
  const [status, setStatus] = useState<Status>('awaiting')
  const cardRef = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()

  useGSAP(
    () => {
      const card = cardRef.current
      if (!card) return
      const stamp = card.querySelector('[data-stamp]')
      const row = card.querySelector('[data-actions]')
      if (status === 'awaiting') {
        gsap.set(stamp, { opacity: 0, scale: 1.4, rotation: -14 })
        gsap.set(row, { opacity: 1, y: 0 })
        return
      }
      if (reduced) {
        gsap.set(stamp, { opacity: 1, scale: 1, rotation: -8 })
        gsap.set(row, { opacity: 0 })
        return
      }
      const tl = gsap.timeline()
      tl.to(row, { opacity: 0, y: 10, duration: 0.3, ease: 'power2.in' })
        .fromTo(
          stamp,
          { opacity: 0, scale: 1.8, rotation: -22 },
          {
            opacity: 1,
            scale: 1,
            rotation: -8,
            duration: 0.5,
            ease: 'back.out(2.4)',
          },
          0.15,
        )
        .fromTo(
          card,
          { boxShadow: '0 0 0 0 rgba(217,107,50,0)' },
          {
            boxShadow: '0 0 0 6px rgba(217,107,50,0.12)',
            duration: 0.4,
            yoyo: true,
            repeat: 1,
          },
          0.3,
        )
      return () => {
        tl.kill()
      }
    },
    { dependencies: [status, reduced] },
  )

  return (
    <div
      ref={cardRef}
      className="relative overflow-hidden border border-ink/15 bg-paper p-6 shadow-[0_30px_70px_-45px_rgba(32,35,31,0.5)] sm:p-8"
    >
      {/* status stamp */}
      <div
        data-stamp
        className={`pointer-events-none absolute right-5 top-5 -rotate-8 border-2 px-3 py-1.5 font-mono text-[0.7rem] font-semibold tracking-widest uppercase opacity-0 ${
          status === 'approved'
            ? 'border-forest text-forest'
            : 'border-ember text-ember'
        }`}
        style={{ opacity: 0 }}
        aria-hidden
      >
        {status === 'approved' ? 'Approved' : 'Revised'}
      </div>

              <p className="label-mono text-ember">Generated finding</p>
      <h4 className="mt-3 max-w-md font-display text-[1.4rem] leading-snug text-ink">
        No documented rollback procedure found
      </h4>

      <div className="mt-5 grid gap-4 border-y border-line py-5 sm:grid-cols-2">
        <div>
          <p className="label-mono text-muted">Supporting source</p>
          <p className="mt-1.5 text-[0.85rem] text-ink">Runbook §4 → target missing</p>
          <p className="mt-1 font-mono text-[0.7rem] text-muted">repo search · 0 matches</p>
        </div>
        <div>
          <p className="label-mono text-muted">Confidence</p>
          <p className="mt-1.5 inline-flex items-center gap-2 border border-ember/40 bg-ember/10 px-2.5 py-1 text-[0.78rem] font-medium text-ember">
            <AlertTriangle size={12} strokeWidth={2} />
            Conflicting records
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <span className="label-mono text-muted">Review status</span>
        <span className="h-px flex-1 bg-line" />
        <span
          className={`label-mono ${
            status === 'approved' ? 'text-forest' : status === 'revised' ? 'text-ember' : 'text-muted'
          }`}
        >
          {status === 'awaiting' ? 'Awaiting human review' : status === 'approved' ? 'Accepted' : 'Sent back'}
        </span>
      </div>

      <div data-actions className="mt-6 flex flex-wrap gap-3">
        <button
          onClick={() => setStatus('approved')}
          className="inline-flex items-center gap-2 bg-forest px-5 py-3 text-[0.82rem] font-medium text-paper transition-colors hover:bg-forest-deep"
        >
          <Check size={14} strokeWidth={2.4} />
          Approve finding
        </button>
        <button
          onClick={() => setStatus('revised')}
          className="inline-flex items-center gap-2 border border-ink/25 px-5 py-3 text-[0.82rem] font-medium text-ink transition-colors hover:border-ink"
        >
          <Undo2 size={14} strokeWidth={2} />
          Request revision
        </button>
      </div>

      {status !== 'awaiting' && (
        <button
          onClick={() => setStatus('awaiting')}
          className="mt-4 font-mono text-[0.7rem] text-muted underline underline-offset-4 hover:text-ink"
        >
          reset demonstration
        </button>
      )}
    </div>
  )
}

export function TrustSection() {
  return (
    <section
      id="trust"
      aria-label="Trust, evidence and control"
      className="relative bg-cream py-24 lg:py-32"
    >
      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <div className="flex items-baseline justify-between border-b border-line pb-4">
          <span className="label-mono text-ember">07 / Trust &amp; control</span>
          <span className="label-mono hidden text-muted sm:block">Evidence · Review · Approval</span>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-12">
          <div className="col-span-12 lg:col-span-7">
            <Reveal as="h2" mode="lines" className="display-lg text-ink">
              Systems organise the knowledge. People remain in control.
            </Reveal>

            {/* principles as editorial rows */}
            <ol className="mt-12 border-t border-line">
              {PRINCIPLES.map((p) => (
                <li
                  key={p.n}
                  className="group grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 border-b border-line py-6 transition-colors hover:bg-paper sm:grid-cols-[auto_minmax(0,18rem)_1fr] sm:gap-x-8"
                >
                  <span className="label-mono pt-1.5 text-ember">{p.n}</span>
                  <h3 className="font-display text-[1.15rem] leading-snug tracking-tight text-ink">
                    {p.title}
                  </h3>
                  <p className="col-span-2 text-[0.88rem] leading-relaxed text-muted sm:col-span-1">
                    {p.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>

          {/* approval demo + legend */}
          <div className="col-span-12 lg:col-span-4 lg:col-start-9">
            <div className="lg:sticky lg:top-28">
              <ApprovalCard />

              <div className="mt-6 border border-line bg-paper p-5">
                <p className="label-mono text-muted">How to read the labels</p>
                <ul className="mt-4 space-y-3">
                  {LEGEND.map((l) => (
                    <li key={l.label} className="flex items-center gap-3">
                      <span className={`h-2.5 w-2.5 ${l.color}`} aria-hidden />
                      <span className={`label-mono ${l.text}`}>{l.label}</span>
                      <span className="ml-auto text-[0.72rem] text-muted">
                        {l.label === 'Verified'
                          ? 'sourced & consistent'
                          : l.label === 'Uncertain'
                            ? 'single or weak source'
                            : 'sources disagree'}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-5 border-t border-line pt-4 text-[0.72rem] leading-relaxed text-muted">
                  Labels describe this prototype’s evidence state only. No security or compliance
                  certification is implied.
                </p>
              </div>

              <p className="mt-5 flex items-start gap-2.5 text-[0.8rem] leading-relaxed text-muted">
                <GitCompare size={14} strokeWidth={1.7} className="mt-0.5 shrink-0 text-forest" />
                Conflicts are shown as conflicts — never silently resolved by the model.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
