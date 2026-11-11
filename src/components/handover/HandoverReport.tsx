import { useRef, useState } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { usePrefersReducedMotion } from '@/hooks/useMedia'
import { Reveal } from '@/components/ui/Reveal'
import {
  CONFIDENCE_META,
  FINDINGS,
  HANDOVER_PROJECT,
  type Finding,
} from '@/data/handover'
import { ChevronDown, FileText, Sparkles } from 'lucide-react'

const TABS = [
  { id: 'all', label: 'Overview' },
  { id: 'decision', label: 'Decisions' },
  { id: 'task', label: 'Tasks' },
  { id: 'risk', label: 'Risks' },
  { id: 'dependency', label: 'Dependencies' },
  { id: 'evidence', label: 'Evidence' },
] as const

type TabId = (typeof TABS)[number]['id']

function FindingRow({ finding, index }: { finding: Finding; index: number }) {
  const [open, setOpen] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()

  useGSAP(
    () => {
      const el = bodyRef.current
      if (!el) return
      if (reduced) {
        gsap.set(el, { height: open ? 'auto' : 0, opacity: open ? 1 : 0 })
        return
      }
      gsap.to(el, {
        height: open ? 'auto' : 0,
        opacity: open ? 1 : 0,
        duration: 0.45,
        ease: 'power3.inOut',
        overwrite: 'auto',
      })
    },
    { dependencies: [open, reduced] },
  )

  const meta = CONFIDENCE_META[finding.confidence]

  return (
    <li data-finding className="border-b border-line last:border-b-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group flex w-full items-start gap-4 px-5 py-5 text-left transition-colors hover:bg-cream/70 sm:px-7"
      >
        <span className="label-mono mt-1 w-7 shrink-0 text-muted">
          {String(index + 1).padStart(2, '0')}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2.5">
            <span
              className={`label-mono inline-flex items-center gap-1.5 border px-2 py-0.5 ${meta.className}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
              {meta.label}
            </span>
            <span className="label-mono text-muted">{finding.type}</span>
          </span>
          <span className="mt-2 block text-[0.98rem] leading-snug font-medium text-ink">
            {finding.title}
          </span>
        </span>

        <ChevronDown
          size={16}
          strokeWidth={1.7}
          className={`mt-1 shrink-0 text-muted transition-transform duration-400 group-hover:text-ink ${
            open ? 'rotate-180' : ''
          }`}
          aria-hidden
        />
      </button>

      <div ref={bodyRef} className="overflow-hidden" style={{ height: 0, opacity: 0 }}>
        <div className="px-5 pb-6 pl-[3.75rem] sm:px-7 sm:pl-[4.75rem]">
          <p className="max-w-2xl text-[0.9rem] leading-relaxed text-muted">{finding.body}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="label-mono text-muted">Evidence:</span>
            {finding.sources.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1.5 border border-line bg-cream px-2.5 py-1 font-mono text-[0.68rem] text-ink/80"
              >
                <FileText size={10} strokeWidth={1.8} className="text-ember" />
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>
    </li>
  )
}

/**
 * Section 06 — a credible, product-like handover report with
 * animated tab transitions and expandable evidence.
 */
export function HandoverReport() {
  const [tab, setTab] = useState<TabId>('all')
  const listRef = useRef<HTMLUListElement>(null)
  const reduced = usePrefersReducedMotion()

  const visible =
    tab === 'all' ? FINDINGS.filter((f) => f.type !== 'evidence') : FINDINGS.filter((f) => f.type === tab)

  const counts = {
    all: FINDINGS.filter((f) => f.type !== 'evidence').length,
    decision: FINDINGS.filter((f) => f.type === 'decision').length,
    task: FINDINGS.filter((f) => f.type === 'task').length,
    risk: FINDINGS.filter((f) => f.type === 'risk').length,
    dependency: FINDINGS.filter((f) => f.type === 'dependency').length,
    evidence: FINDINGS.filter((f) => f.type === 'evidence').length,
  } as Record<TabId, number>

  // animate list on tab change
  useGSAP(
    () => {
      const list = listRef.current
      if (!list || reduced) return
      const items = list.querySelectorAll('[data-finding]')
      gsap.fromTo(
        items,
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.45, stagger: 0.05, ease: 'power3.out', overwrite: true },
      )
    },
    { dependencies: [tab, reduced] },
  )

  // animate the active tab background
  useGSAP(
    () => {
      const bg = document.querySelector('[data-tab-bg]')
      if (!bg || reduced) return
      gsap.fromTo(
        bg,
        { scaleX: 0.4, opacity: 0 },
        { scaleX: 1, opacity: 1, duration: 0.4, ease: 'power3.out', transformOrigin: 'left center' },
      )
    },
    { dependencies: [tab, reduced] },
  )

  return (
    <section
      id="handover"
      aria-label="The handover experience"
      className="relative bg-cream py-24 lg:py-32"
    >
      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <div className="flex items-baseline justify-between border-b border-line pb-4">
          <span className="label-mono text-ember">05 / The handover</span>
          <span className="label-mono hidden text-muted sm:block">Sample report · demonstration</span>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-12">
          <Reveal as="h2" mode="lines" className="display-lg col-span-12 lg:col-span-7">
            Not a summary. A report you can defend.
          </Reveal>
          <p className="body-lg col-span-12 max-w-md self-end lg:col-span-4 lg:col-start-9">
            Every claim carries evidence, a confidence label and a place in the record — so the
            next person inherits understanding, not assumptions.
          </p>
        </div>

        {/* Simulated product window */}
        <div className="mt-14 overflow-hidden border border-ink/15 bg-paper shadow-[0_40px_90px_-50px_rgba(32,35,31,0.45)]">
          {/* window chrome */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-ink px-5 py-3.5 sm:px-7">
            <div className="flex items-center gap-3.5">
              <span className="flex gap-1.5" aria-hidden>
                <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
              </span>
              <span className="font-mono text-[0.72rem] text-white/60">
                handover / {HANDOVER_PROJECT.name.toLowerCase().replace(' ', '-')}
              </span>
            </div>
            <span className="label-mono border border-ember px-2.5 py-1 text-ember">
              {HANDOVER_PROJECT.status}
            </span>
          </div>

          {/* report header */}
          <div className="grid gap-5 border-b border-line px-5 py-7 sm:px-7 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-7">
              <p className="label-mono text-muted">{HANDOVER_PROJECT.window}</p>
              <h3 className="mt-2.5 font-display text-[clamp(1.7rem,3vw,2.6rem)] leading-none tracking-tight text-ink">
                {HANDOVER_PROJECT.name}
              </h3>
              <p className="mt-3 text-[0.88rem] text-muted">
                {HANDOVER_PROJECT.from} <span className="text-ember">→</span>{' '}
                {HANDOVER_PROJECT.to}
              </p>
            </div>
            <dl className="grid grid-cols-3 gap-4 lg:col-span-5">
              {[
                { t: 'Findings', v: String(counts.all) },
                { t: 'Evidence links', v: String(FINDINGS.reduce((n, f) => n + f.sources.length, 0)) },
                { t: 'Gaps flagged', v: '3' },
              ].map((s) => (
                <div key={s.t} className="border-l border-line pl-3.5">
                  <dt className="label-mono text-muted">{s.t}</dt>
                  <dd className="mt-1 font-display text-2xl leading-none text-ink">{s.v}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Note */}
          <div className="flex items-start gap-3 border-b border-line bg-forest/[0.05] px-5 py-4 sm:px-7">
            <Sparkles size={14} strokeWidth={1.8} className="mt-0.5 shrink-0 text-ember" />
            <p className="text-[0.82rem] leading-relaxed text-ink/75">
              <span className="label-mono mr-2 text-forest">Finding</span>
              Generated from 214 authorised files. Human review required before sharing —
              confidence labels below are not certifications.
            </p>
          </div>

          {/* tabs */}
          <div
            role="tablist"
            aria-label="Report sections"
            className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2.5 sm:px-5"
          >
            {TABS.map((t) => {
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  className={`relative shrink-0 px-4 py-2.5 text-[0.8rem] font-medium tracking-tight transition-colors duration-300 ${
                    active ? 'text-paper' : 'text-muted hover:text-ink'
                  }`}
                >
                  {active && (
                    <span aria-hidden className="absolute inset-0 bg-ink" data-tab-bg />
                  )}
                  <span className="relative">
                    {t.label}
                    <span
                      className={`ml-2 font-mono text-[0.65rem] ${active ? 'text-ember-soft' : 'text-muted/70'}`}
                    >
                      {counts[t.id]}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          {/* list */}
          <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
            <ul ref={listRef}>
              {visible.map((f, i) => (
                <FindingRow key={f.id} finding={f} index={i} />
              ))}
            </ul>
            {visible.length === 0 && (
              <p className="px-7 py-10 text-center text-sm text-muted">No findings in this view.</p>
            )}
          </div>

          {/* footer bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-cream px-5 py-4 sm:px-7">
            <p className="label-mono text-muted">Demonstration data · fictional project</p>
            <p className="label-mono text-forest">
              {visible.length} shown · {counts.evidence} evidence sources
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
