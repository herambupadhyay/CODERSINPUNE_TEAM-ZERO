import { useRef, type ReactNode } from 'react'
import { gsap, useGSAP } from '@/lib/gsap'
import { useFinePointer } from '@/hooks/useMedia'

type Props = {
  children: ReactNode
  onClick?: () => void
  href?: string
  variant?: 'solid' | 'outline' | 'ghost' | 'ember'
  className?: string
  type?: 'button' | 'submit'
  ariaLabel?: string
}

const BASE =
  'group relative inline-flex items-center justify-center gap-2.5 px-7 py-4 text-sm font-medium tracking-tight transition-colors duration-300 select-none'

const VARIANTS: Record<NonNullable<Props['variant']>, string> = {
  solid: 'bg-ink text-paper hover:bg-forest',
  ember: 'bg-ember text-paper hover:bg-[#c45c27]',
  outline: 'border border-ink/25 text-ink hover:border-ink hover:bg-ink hover:text-paper',
  ghost: 'text-ink hover:text-ember',
}

export function MagneticButton({
  children,
  onClick,
  href,
  variant = 'solid',
  className = '',
  type = 'button',
  ariaLabel,
}: Props) {
  const ref = useRef<HTMLElement>(null)
  const fine = useFinePointer()

  useGSAP(
    () => {
      const el = ref.current
      if (!el || !fine) return

      const xTo = gsap.quickTo(el, 'x', { duration: 0.5, ease: 'power3.out' })
      const yTo = gsap.quickTo(el, 'y', { duration: 0.5, ease: 'power3.out' })

      const onMove = (e: globalThis.MouseEvent) => {
        const rect = el.getBoundingClientRect()
        const relX = e.clientX - rect.left - rect.width / 2
        const relY = e.clientY - rect.top - rect.height / 2
        xTo(relX * 0.28)
        yTo(relY * 0.35)
      }
      const onLeave = () => {
        xTo(0)
        yTo(0)
      }

      el.addEventListener('mousemove', onMove)
      el.addEventListener('mouseleave', onLeave)
      return () => {
        el.removeEventListener('mousemove', onMove)
        el.removeEventListener('mouseleave', onLeave)
      }
    },
    { scope: ref, dependencies: [fine] },
  )

  const cls = `${BASE} ${VARIANTS[variant]} ${className}`

  if (href) {
    return (
      <a ref={ref as React.Ref<HTMLAnchorElement>} href={href} className={cls} aria-label={ariaLabel}>
        {children}
      </a>
    )
  }

  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type={type}
      onClick={onClick}
      className={cls}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  )
}
