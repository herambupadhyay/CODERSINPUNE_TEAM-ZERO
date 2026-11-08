import { useEffect, useRef } from 'react'
import Lenis from 'lenis'
import { gsap, ScrollTrigger } from '@/lib/gsap'
import { usePrefersReducedMotion } from '@/hooks/useMedia'

/**
 * Lenis smooth scroll wired into GSAP's ticker + ScrollTrigger.
 * Disabled for reduced-motion and coarse pointers.
 */
export function useLenis() {
  const reduced = usePrefersReducedMotion()
  const lenisRef = useRef<Lenis | null>(null)

  useEffect(() => {
    if (reduced) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    if (window.matchMedia('(max-width: 1023px)').matches) return

    const lenis = new Lenis({
      duration: 1.1,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      syncTouch: false,
    })

    lenis.on('scroll', ScrollTrigger.update)

    const tick = (time: number) => lenis.raf(time * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)

    lenisRef.current = lenis

    return () => {
      gsap.ticker.remove(tick)
      lenis.destroy()
      lenisRef.current = null
    }
  }, [reduced])

  const scrollTo = (target: string | number, offset = 0) => {
    const lenis = lenisRef.current
    if (lenis) {
      lenis.scrollTo(target, { offset, duration: 1.2 })
    } else if (typeof target === 'string') {
      const el = document.querySelector(target)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const stop = () => lenisRef.current?.stop()
  const start = () => lenisRef.current?.start()

  return { scrollTo, stop, start }
}
