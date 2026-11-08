import { useEffect } from 'react'
import { ScrollTrigger } from '@/lib/gsap'
import { ScrollProvider } from '@/hooks/useScroll'
import { DemoModalProvider } from '@/components/ui/DemoModal'
import { LiquidCursor } from '@/components/cursor/LiquidCursor'
import { Navbar } from '@/components/nav/Navbar'
import { Hero } from '@/components/hero/Hero'
import { ProblemScatter } from '@/components/problem/ProblemScatter'
import { ProcessHorizontal } from '@/components/process/ProcessHorizontal'
import { DualSystems } from '@/components/intelligence/DualSystems'
import { HandoverReport } from '@/components/handover/HandoverReport'
import { DepartureMap } from '@/components/departure/DepartureMap'
import { TrustSection } from '@/components/trust/TrustSection'
import { FinalCta } from '@/components/cta/FinalCta'
import { Footer } from '@/components/footer/Footer'

export default function App() {
  // recompute trigger positions once fonts finish loading (layout shift guard)
  useEffect(() => {
    let cancelled = false
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (!cancelled) ScrollTrigger.refresh()
      })
    }
    const t = window.setTimeout(() => {
      if (!cancelled) ScrollTrigger.refresh()
    }, 600)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [])

  return (
    <ScrollProvider>
      <DemoModalProvider>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:bg-ink focus:px-4 focus:py-3 focus:text-sm focus:text-paper"
        >
          Skip to content
        </a>

        <LiquidCursor />
        <Navbar />

        <main id="main">
          <Hero />
          <ProblemScatter />
          <ProcessHorizontal />
          <DualSystems />
          <HandoverReport />
          <DepartureMap />
          <TrustSection />
          <FinalCta />
        </main>

        <Footer />
      </DemoModalProvider>
    </ScrollProvider>
  )
}
