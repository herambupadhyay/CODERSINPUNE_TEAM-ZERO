import { useRef, type ElementType, type ReactNode } from 'react'
import { gsap, SplitText, useGSAP } from '@/lib/gsap'
import { usePrefersReducedMotion } from '@/hooks/useMedia'

type Mode = 'lines' | 'words' | 'chars'

type Props = {
  children: ReactNode
  as?: ElementType
  mode?: Mode
  stagger?: number
  delay?: number
  y?: number
  duration?: number
  /** animate when scrolled into view (default) or immediately on mount */
  onMount?: boolean
  className?: string
  once?: boolean
}

/**
 * SplitText reveal wrapper. Uses GSAP SplitText with line/word/char masks.
 * Reverts cleanly on unmount via useGSAP.
 */
export function Reveal({
  children,
  as: Tag = 'div',
  mode = 'lines',
  stagger = 0.08,
  delay = 0,
  y = 110,
  duration = 1,
  onMount = false,
  className = '',
  once = true,
}: Props) {
  const ref = useRef<HTMLElement>(null)
  const reduced = usePrefersReducedMotion()

  useGSAP(
    () => {
      const el = ref.current
      if (!el || reduced) return

      const split = SplitText.create(el, {
        type: mode,
        ...(mode === 'lines' ? ({ mask: 'lines' } as const) : {}),
        linesClass: 'split-line',
      })

      const targets =
        mode === 'lines' ? split.lines : mode === 'words' ? split.words : split.chars

      if (!targets.length) return

      const tween = gsap.from(targets, {
        yPercent: mode === 'lines' ? 110 : y,
        opacity: mode === 'lines' ? 1 : 0,
        duration,
        delay,
        stagger,
        ease: 'power4.out',
        paused: !onMount,
        scrollTrigger: onMount
          ? undefined
          : {
              trigger: el,
              start: 'top 88%',
              once,
            },
      })

      return () => {
        tween.scrollTrigger?.kill()
        tween.kill()
        split.revert()
      }
    },
    { scope: ref, dependencies: [mode, reduced, onMount, stagger, delay, y, duration, once] },
  )

  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  )
}
