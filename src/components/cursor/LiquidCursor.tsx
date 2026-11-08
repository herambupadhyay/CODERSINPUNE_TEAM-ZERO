import { useEffect, useRef } from 'react'
import { useFinePointer, usePrefersReducedMotion } from '@/hooks/useMedia'

type Point = {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  life: number
  max: number
}

type Ripple = { x: number; y: number; r: number; max: number; alpha: number }

/**
 * Liquid cursor: a metaball field rendered on an offscreen canvas,
 * thresholded into soft merged blobs that stretch with pointer velocity,
 * plus click ripples. Desktop fine-pointer only; never intercepts input.
 */
export function LiquidCursor() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fine = useFinePointer()
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    if (!fine || reduced) return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // low-res buffer for the metaball threshold pass (perf)
    const buffer = document.createElement('canvas')
    const bctx = buffer.getContext('2d', { willReadFrequently: true })
    if (!bctx) return
    // second buffer: thresholded result, upscaled onto the visible canvas
    const outCanvas = document.createElement('canvas')
    const outCtx = outCanvas.getContext('2d')
    if (!outCtx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    let width = 0
    let height = 0
    const SCALE = 0.4 // buffer resolution factor
    // preallocated frame buffers (avoids per-frame GC churn)
    let alpha = new Uint8ClampedArray(0)
    let smoothed = new Uint8ClampedArray(0)
    let out: ImageData | null = null

    const resize = () => {
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      buffer.width = Math.max(2, Math.floor(width * SCALE))
      buffer.height = Math.max(2, Math.floor(height * SCALE))
      outCanvas.width = buffer.width
      outCanvas.height = buffer.height
      const n = buffer.width * buffer.height
      alpha = new Uint8ClampedArray(n)
      smoothed = new Uint8ClampedArray(n)
      out = outCtx.createImageData(buffer.width, buffer.height)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const pointer = { x: width / 2, y: height / 2, px: width / 2, py: height / 2, active: false }
    const points: Point[] = []
    const ripples: Ripple[] = []
    const MAX_POINTS = 26
    let raf = 0
    let lastSpawn = 0
    let hidden = false

    const onMove = (e: PointerEvent) => {
      pointer.px = pointer.x
      pointer.py = pointer.y
      pointer.x = e.clientX
      pointer.y = e.clientY
      pointer.active = true

      const now = performance.now()
      const speed = Math.hypot(pointer.x - pointer.px, pointer.y - pointer.py)
      if (now - lastSpawn > 16 && (speed > 1.5 || points.length < 6)) {
        lastSpawn = now
        const angle = Math.atan2(pointer.y - pointer.py, pointer.x - pointer.px)
        points.push({
          x: pointer.x,
          y: pointer.y,
          vx: Math.cos(angle) * Math.min(speed * 0.08, 3),
          vy: Math.sin(angle) * Math.min(speed * 0.08, 3),
          r: Math.min(9 + speed * 0.35, 26),
          life: 0,
          max: 42,
        })
        if (points.length > MAX_POINTS) points.splice(0, points.length - MAX_POINTS)
      }
    }

    const onDown = (e: PointerEvent) => {
      ripples.push({ x: e.clientX, y: e.clientY, r: 6, max: 120, alpha: 0.5 })
      // seed a core blob so the click feels liquid
      points.push({
        x: e.clientX,
        y: e.clientY,
        vx: 0,
        vy: 0,
        r: 22,
        life: 0,
        max: 30,
      })
    }

    const onLeave = () => {
      pointer.active = false
    }

    const onVisibility = () => {
      hidden = document.hidden
      if (!hidden) raf = requestAnimationFrame(tick)
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown, { passive: true })
    document.addEventListener('mouseleave', onLeave)
    document.addEventListener('visibilitychange', onVisibility)

    let last = performance.now()

    const tick = (now: number) => {
      if (hidden) return
      const dt = Math.min((now - last) / 16.67, 2.5)
      last = now

      // decay + drift
      for (let i = points.length - 1; i >= 0; i--) {
        const p = points[i]
        p.life += dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vx *= 0.92
        p.vy *= 0.92
        p.r *= 0.975
        if (p.life > p.max || p.r < 1.5) points.splice(i, 1)
      }
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i]
        rp.r += (rp.max - rp.r) * 0.08 * dt
        rp.alpha *= 0.94
        if (rp.alpha < 0.02 || rp.r > rp.max - 2) ripples.splice(i, 1)
      }

      // ---- render metaball field into buffer ----
      bctx.clearRect(0, 0, buffer.width, buffer.height)
      bctx.globalCompositeOperation = 'lighter'

      const s = SCALE
      // core blob following the pointer with lag (the "drop")
      if (pointer.active) {
        const grd = bctx.createRadialGradient(pointer.x * s, pointer.y * s, 0, pointer.x * s, pointer.y * s, 16 * s)
        grd.addColorStop(0, 'rgba(255,255,255,1)')
        grd.addColorStop(0.55, 'rgba(255,255,255,0.55)')
        grd.addColorStop(1, 'rgba(255,255,255,0)')
        bctx.fillStyle = grd
        bctx.beginPath()
        bctx.arc(pointer.x * s, pointer.y * s, 16 * s, 0, Math.PI * 2)
        bctx.fill()
      }

      for (const p of points) {
        const fade = 1 - p.life / p.max
        const grd = bctx.createRadialGradient(p.x * s, p.y * s, 0, p.x * s, p.y * s, p.r * s)
        grd.addColorStop(0, `rgba(255,255,255,${0.9 * fade})`)
        grd.addColorStop(0.5, `rgba(255,255,255,${0.45 * fade})`)
        grd.addColorStop(1, 'rgba(255,255,255,0)')
        bctx.fillStyle = grd
        bctx.beginPath()
        bctx.arc(p.x * s, p.y * s, p.r * s, 0, Math.PI * 2)
        bctx.fill()
      }

      // ---- threshold pass: read buffer, build hard-edged metaball mask ----
      const img = bctx.getImageData(0, 0, buffer.width, buffer.height)
      const data = img.data
      const w = buffer.width
      const h = buffer.height
      const THRESHOLD = 140

      // ---- paint final liquid onto main canvas (smoothed upscale = soft edge) ----
      ctx.clearRect(0, 0, width, height)
      ctx.save()
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'medium'

      if (out && alpha.length === w * h) {
        // cheap 3x3 blur of alpha to smooth threshold artifacts
        for (let i = 0, j = 0; i < data.length; i += 4, j++) {
          alpha[j] = data[i + 3]
        }
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = y * w + x
            let sum = 0
            let count = 0
            for (let oy = -1; oy <= 1; oy++) {
              const ny = y + oy
              if (ny < 0 || ny >= h) continue
              const row = ny * w
              for (let ox = -1; ox <= 1; ox++) {
                const nx = x + ox
                if (nx < 0 || nx >= w) continue
                sum += alpha[row + nx]
                count++
              }
            }
            smoothed[i] = sum / count
          }
        }

        // ---- build tinted output at buffer resolution ----
        const od = out.data
        for (let i = 0, p = 0; i < smoothed.length; i++, p += 4) {
          const v = smoothed[i]
          if (v >= THRESHOLD) {
            const edge = Math.min((v - THRESHOLD) / 70, 1)
            od[p] = 217 // R - ember
            od[p + 1] = 107 // G
            od[p + 2] = 50 // B
            od[p + 3] = Math.round(90 * edge) // A
          } else {
            od[p + 3] = 0
          }
        }

        outCtx.putImageData(out, 0, 0)
        ctx.drawImage(outCanvas, 0, 0, width, height)
      }

      // ember radial sheen at the pointer
      ctx.globalCompositeOperation = 'lighter'
      if (pointer.active) {
        const g2 = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 30)
        g2.addColorStop(0, 'rgba(217,107,50,0.22)')
        g2.addColorStop(1, 'rgba(217,107,50,0)')
        ctx.fillStyle = g2
        ctx.beginPath()
        ctx.arc(pointer.x, pointer.y, 30, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'

      // ripples
      for (const rp of ripples) {
        ctx.strokeStyle = `rgba(217,107,50,${rp.alpha})`
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2)
        ctx.stroke()
      }

      ctx.restore()
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      document.removeEventListener('mouseleave', onLeave)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [fine, reduced])

  if (!fine || reduced) return null

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[90]"
    />
  )
}
