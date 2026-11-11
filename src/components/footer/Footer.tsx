import { useScroll } from '@/hooks/useScroll'
import { useNavigate } from 'react-router-dom'
import { SECTIONS } from '@/data/nav'
import { ArrowUpRight } from 'lucide-react'

const YEAR = new Date().getFullYear()

function GithubMark({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      focusable="false"
    >
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.009-.868-.014-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
    </svg>
  )
}

const FOOTER_LINKS = [
  { group: 'Product', items: [{ label: 'Overview', target: '#top' }, ...SECTIONS.map((s) => ({ label: s.label, target: `#${s.id}` }))] },
  { group: 'How it works', items: [{ label: 'The four stages', target: '#how-it-works' }, { label: 'Handover report', target: '#handover' }, { label: 'Departure impact', target: '#why' }] },
  { group: 'Intelligence', items: [{ label: 'Knowledge Intelligence', target: '#intelligence' }, { label: 'Authority Intelligence', target: '#intelligence' }, { label: 'Trust & control', target: '#trust' }] },
]

function LogoMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden focusable="false">
      <rect width="32" height="32" rx="7" fill="#315B45" />
      <path
        d="M6 17.5h4.6l2.1-6.2 3.4 10.4 2.6-7.4 1.6 3.2H26"
        fill="none"
        stroke="#D96B32"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Footer() {
  const { scrollTo } = useScroll()
  const navigate = useNavigate()

  const go = (target: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    scrollTo(target, -60)
  }

  return (
    <footer className="relative overflow-hidden border-t border-line bg-paper pt-20 pb-10">
      <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <div className="grid gap-12 lg:grid-cols-12">
          {/* Brand */}
          <div className="lg:col-span-5">
            <a href="#top" onClick={go('#top')} className="flex items-center gap-3">
              <LogoMark className="h-9 w-9" />
              <span className="font-display text-xl font-medium tracking-tight text-ink">
                Project<span className="text-ember">Pulse</span>
              </span>
            </a>
            <p className="mt-6 max-w-sm text-[0.92rem] leading-relaxed text-muted">
              A project knowledge assistant that reconstructs project knowledge, checks it against
              evidence, and scopes it to the people who are authorised to receive it.
            </p>
            <p className="mt-6 max-w-sm border-l-2 border-ember pl-4 font-display text-[1.05rem] leading-snug text-ink italic">
              Don&rsquo;t just transfer work. Transfer understanding.
            </p>
          </div>

          {/* Link columns */}
          <nav
            className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:col-span-6 lg:col-start-7"
            aria-label="Footer"
          >
            {FOOTER_LINKS.map((col) => (
              <div key={col.group}>
                <p className="label-mono text-muted">{col.group}</p>
                <ul className="mt-4 space-y-2.5">
                  {col.items.map((item) => (
                    <li key={item.label}>
                      <a
                        href={item.target}
                        onClick={go(item.target)}
                        className="group inline-flex items-center gap-1.5 text-[0.88rem] text-ink/80 transition-colors hover:text-ember"
                      >
                        {item.label}
                        <span
                          aria-hidden
                          className="inline-block opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:opacity-100"
                        >
                          →
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {/* Contact column */}
            <div className="col-span-2 sm:col-span-3 lg:col-span-3">
              <p className="label-mono text-muted">Contact</p>
              <ul className="mt-4 space-y-2.5">
                <li>
                  <a
                    href="mailto:hello@projectpulse.example"
                    className="group inline-flex items-center gap-1.5 text-[0.88rem] text-ink/80 transition-colors hover:text-ember"
                  >
                    hello@projectpulse.example
                    <ArrowUpRight
                      size={13}
                      strokeWidth={1.8}
                      className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                    />
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="group inline-flex items-center gap-2 text-[0.88rem] text-ink/80 transition-colors hover:text-ember"
                  >
                    <GithubMark />
                    GitHub <span className="text-muted">(placeholder)</span>
                  </a>
                </li>
                <li>
                  <button
                    onClick={() => navigate('/signup')}
                    className="text-[0.88rem] text-ink/80 transition-colors hover:text-ember"
                  >
                    Request early access
                  </button>
                </li>
              </ul>
            </div>
          </nav>
        </div>

        {/* Oversized wordmark */}
        <div
          aria-hidden
          className="mt-16 select-none overflow-hidden border-t border-line pt-8"
        >
          <p
            className="font-display leading-[0.8] tracking-[-0.045em] text-ink/[0.07]"
            style={{ fontSize: 'clamp(3.5rem, 15vw, 15rem)' }}
          >
            ProjectPulse
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="label-mono text-muted">
            © {YEAR} ProjectPulse
          </p>
          <p className="label-mono text-muted">
            Built for internal use
          </p>
        </div>
      </div>
    </footer>
  )
}
