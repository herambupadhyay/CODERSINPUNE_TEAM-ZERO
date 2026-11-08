import { useEffect, useRef, useState } from 'react'
import { gsap, ScrollTrigger, useGSAP } from '@/lib/gsap'
import { useScroll } from '@/hooks/useScroll'
import { useNavigate } from 'react-router-dom'
import { SECTIONS } from '@/data/nav'
import { Menu, X, ArrowUpRight } from 'lucide-react'

function LogoMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden focusable="false">
      <rect width="32" height="32" rx="7" className="fill-forest" />
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

export function Navbar() {
  const { scrollTo } = useScroll()
  const navigate = useNavigate()
  const [scrolled, setScrolled] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const barRef = useRef<HTMLElement>(null)
  const indicatorRef = useRef<HTMLSpanElement>(null)
  const linksRef = useRef<HTMLDivElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const menuPanelRef = useRef<HTMLDivElement>(null)

  // ---- scroll state + section spy ----
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })

    const triggers: ScrollTrigger[] = []
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id)
      if (!el) continue
      const st = ScrollTrigger.create({
        trigger: el,
        start: 'top 45%',
        end: 'bottom 45%',
        onToggle: (self) => {
          if (self.isActive) setActive(s.id)
        },
      })
      triggers.push(st)
    }

    return () => {
      window.removeEventListener('scroll', onScroll)
      triggers.forEach((t) => t.kill())
    }
  }, [])

  // ---- animated active indicator ----
  useGSAP(
    () => {
      const indicator = indicatorRef.current
      const container = linksRef.current
      if (!indicator || !container) return
      const target = active ? container.querySelector<HTMLElement>(`[data-link="${active}"]`) : null
      if (!target) {
        gsap.to(indicator, { opacity: 0, scaleX: 0.4, duration: 0.3, ease: 'power2.in' })
        return
      }
      gsap.to(indicator, {
        opacity: 1,
        scaleX: 1,
        x: target.offsetLeft,
        width: target.offsetWidth,
        duration: 0.5,
        ease: 'power4.out',
      })
    },
    { dependencies: [active] },
  )

  // ---- nav bar entrance/transform ----
  useGSAP(
    () => {
      gsap.to(barRef.current, {
        backgroundColor: scrolled ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0)',
        borderBottomColor: scrolled ? 'rgba(234,234,229,1)' : 'rgba(234,234,229,0)',
        backdropFilter: scrolled ? 'blur(14px)' : 'blur(0px)',
        duration: 0.45,
        ease: 'power2.out',
      })
    },
    { dependencies: [scrolled] },
  )

  // ---- mobile menu ----
  useGSAP(
    () => {
      const panel = menuPanelRef.current
      if (!panel) return
      const items = panel.querySelectorAll('[data-menu-item]')
      if (menuOpen) {
        gsap.set(panel, { display: 'flex' })
        gsap.fromTo(
          panel,
          { clipPath: 'inset(0 0 100% 0)' },
          { clipPath: 'inset(0 0 0% 0)', duration: 0.7, ease: 'power4.inOut' },
        )
        gsap.fromTo(
          items,
          { y: 34, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.6, stagger: 0.06, delay: 0.25, ease: 'power4.out' },
        )
      } else {
        gsap.to(panel, {
          clipPath: 'inset(0 0 100% 0)',
          duration: 0.5,
          ease: 'power4.inOut',
          onComplete: () => gsap.set(panel, { display: 'none' }),
        })
      }
    },
    { dependencies: [menuOpen] },
  )

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [menuOpen])

  const go = (id: string) => {
    setMenuOpen(false)
    // let the menu close begin, then scroll
    window.setTimeout(() => scrollTo(`#${id}`, -70), menuOpen ? 350 : 0)
  }

  return (
    <>
      <header
        ref={barRef}
        className="fixed inset-x-0 top-0 z-[80] border-b border-transparent"
        data-navbar
      >
        <nav
          className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12"
          aria-label="Primary"
        >
          {/* Wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault()
              scrollTo('#top', 0)
            }}
            className="group flex items-center gap-2.5"
          >
            <LogoMark className="h-7 w-7 transition-transform duration-500 group-hover:rotate-[-8deg]" />
            <span className="font-display text-[1.05rem] font-medium tracking-tight text-ink">
              Project<span className="text-ember">Pulse</span>
            </span>
          </a>

          {/* Centre links */}
          <div ref={linksRef} className="relative hidden items-center gap-1 lg:flex">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                data-link={s.id}
                href={`#${s.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  go(s.id)
                }}
                className={`relative px-4 py-2 text-[0.82rem] font-medium tracking-tight transition-colors duration-300 ${
                  active === s.id ? 'text-ink' : 'text-muted hover:text-ink'
                }`}
              >
                {s.label}
              </a>
            ))}
            <span
              ref={indicatorRef}
              aria-hidden
              className="pointer-events-none absolute bottom-0 left-0 h-[2px] bg-ember opacity-0"
              style={{ transformOrigin: 'left center' }}
            />
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => navigate('/login')}
              className="hidden px-3 py-2 text-[0.82rem] font-medium text-muted transition-colors hover:text-ink sm:block"
            >
              Sign in
            </button>
            <button
              onClick={() => navigate('/signup')}
              className="group hidden items-center gap-1.5 bg-ink px-5 py-2.5 text-[0.82rem] font-medium text-paper transition-colors duration-300 hover:bg-forest sm:inline-flex"
            >
              Get Started
              <ArrowUpRight
                size={13}
                strokeWidth={2}
                className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              />
            </button>
            <button
              ref={menuBtnRef}
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              className="grid h-10 w-10 place-items-center text-ink lg:hidden"
            >
              {menuOpen ? <X size={20} strokeWidth={1.6} /> : <Menu size={20} strokeWidth={1.6} />}
            </button>
          </div>
        </nav>
      </header>

      {/* Mobile full-screen menu */}
      <div
        ref={menuPanelRef}
        data-mobile-menu
        className="fixed inset-0 z-[75] hidden flex-col justify-between bg-cream px-6 pb-10 pt-24"
        style={{ clipPath: 'inset(0 0 100% 0)' }}
      >
        <nav className="flex flex-col gap-1" aria-label="Mobile">
          {SECTIONS.map((s, i) => (
            <a
              key={s.id}
              data-menu-item
              href={`#${s.id}`}
              onClick={(e) => {
                e.preventDefault()
                go(s.id)
              }}
              className="group flex items-baseline justify-between border-b border-line py-5"
            >
              <span className="font-display text-[2rem] leading-none tracking-tight text-ink transition-colors group-hover:text-ember">
                {s.label}
              </span>
              <span className="label-mono text-muted">0{i + 1}</span>
            </a>
          ))}
        </nav>
        <div data-menu-item className="flex flex-col gap-3">
          <button
            onClick={() => {
              setMenuOpen(false)
              navigate('/signup')
            }}
            className="w-full bg-ink px-6 py-4 text-sm font-medium text-paper"
          >
            Get Started
          </button>
          <button
            onClick={() => {
              setMenuOpen(false)
              navigate('/login')
            }}
            className="w-full border border-ink/20 px-6 py-4 text-sm font-medium text-ink"
          >
            Sign in
          </button>
        </div>
      </div>
    </>
  )
}
