import { chromium } from 'playwright'

const BASE = 'http://localhost:5199'
const OUT = 'test-output'
const results = []
const log = (n, ok, d = '') => {
  results.push({ n, ok, d })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(2800)

// hero: CTAs must be above the fold
const ctaVisible = await page
  .getByRole('button', { name: /Explore ProjectPulse/i })
  .isVisible()
const ctaBox = await page.getByRole('button', { name: /Explore ProjectPulse/i }).boundingBox()
log('hero CTA above fold', ctaVisible && ctaBox && ctaBox.y + ctaBox.height < 900, `y=${ctaBox?.y}`)
await page.screenshot({ path: `${OUT}/fix-01-hero.png` })

// hero: no node clipped — check all node rects within svg viewport
const clipped = await page.evaluate(() => {
  const svg = document.querySelector('svg[aria-label*="Fragmented"]')
  if (!svg) return ['no svg']
  const vb = svg.viewBox.baseVal
  const bad = []
  svg.querySelectorAll('[data-node] rect').forEach((r) => {
    const x = Number(r.getAttribute('x'))
    const w = Number(r.getAttribute('width'))
    if (x < 0 || x + w > vb.width) bad.push(`${r.parentElement?.getAttribute('data-node')}: ${x + w}`)
  })
  return bad
})
log('hero nodes inside viewBox', clipped.length === 0, clipped.join(', '))

// process: pinned content fits in viewport
const procSection = await page.locator('#how-it-works')
await procSection.scrollIntoViewIfNeeded()
await page.waitForTimeout(1200)
await page.evaluate(() => window.scrollBy(0, 400))
await page.waitForTimeout(1200)
const procOverflow = await page.evaluate(() => {
  const pin = document.querySelector('#how-it-works > div')
  if (!pin) return -1
  return Math.round(pin.scrollHeight - pin.clientHeight)
})
log('process pinned content fits', procOverflow <= 2, `overflow=${procOverflow}px`)
await page.screenshot({ path: `${OUT}/fix-02-process.png` })

// scrub through the horizontal track
await page.evaluate(() => window.scrollBy(0, 1400))
await page.waitForTimeout(1300)
await page.screenshot({ path: `${OUT}/fix-03-process-end.png` })

// departure: fits + nodes inside viewBox
await page.locator('#why').scrollIntoViewIfNeeded()
await page.waitForTimeout(1000)
const depFit = await page.evaluate(() => {
  const wrap = document.querySelector('#why > div')
  if (!wrap) return -1
  return Math.round(wrap.scrollHeight - wrap.clientHeight)
})
log('departure content fits', depFit <= 2, `overflow=${depFit}px`)

const depClipped = await page.evaluate(() => {
  const svg = document.querySelector('#why svg[aria-label*="Dependency"]')
  if (!svg) return ['no svg']
  const vb = svg.viewBox.baseVal
  const bad = []
  svg.querySelectorAll('[data-dnode] rect').forEach((r) => {
    const x = Number(r.getAttribute('x'))
    const w = Number(r.getAttribute('width'))
    const y = Number(r.getAttribute('y'))
    if (x < 0 || x + w > vb.width || y < 0) bad.push(`${r.parentElement?.getAttribute('data-dnode')}: right=${x + w}`)
  })
  return bad
})
log('departure nodes inside viewBox', depClipped.length === 0, depClipped.join(', '))

// scrub to end of departure
for (let i = 0; i < 8; i++) {
  await page.evaluate(() => window.scrollBy(0, 500))
  await page.waitForTimeout(250)
}
await page.waitForTimeout(900)
await page.screenshot({ path: `${OUT}/fix-04-departure-end.png` })
const closingVisible = await page.locator('[data-departure-close]').evaluate((el) => {
  const r = el.getBoundingClientRect()
  return r.bottom <= window.innerHeight + 2 && getComputedStyle(el).opacity !== '0'
})
log('departure closing line visible', closingVisible)

// final CTA: no mid-word break
await page.locator('#cta').scrollIntoViewIfNeeded()
await page.waitForTimeout(1800)
const wordBroken = await page.evaluate(() => {
  const h = document.querySelector('#cta h2')
  if (!h) return true
  const chars = [...h.querySelectorAll('.closing-char')]
  if (!chars.length) return false
  const lines = new Map()
  chars.forEach((c) => {
    const top = Math.round(c.getBoundingClientRect().top)
    lines.set(top, (lines.get(top) || '') + c.textContent)
  })
  const texts = [...lines.values()].map((t) => t.replace(/\s+/g, ''))
  const expected = (h.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()
  // original positions of every non-space char
  const pos = []
  for (let i = 0; i < expected.length; i++) if (expected[i] !== ' ') pos.push(i)

  let cursor = 0
  for (let li = 0; li < texts.length; li++) {
    const plain = texts[li]
    const start = cursor
    for (const ch of plain) {
      if (cursor >= pos.length || expected[pos[cursor]] !== ch) return true
      cursor++
    }
    // start boundary (not first line): previous original char must be followed by a space
    if (start > 0 && expected[pos[start - 1] + 1] !== ' ') return true
    // end boundary (not last line): char after line's last char must be a space
    if (li < texts.length - 1 && expected[pos[cursor - 1] + 1] !== ' ') return true
  }
  return cursor !== pos.length
})
log('CTA headline has no mid-word break', !wordBroken)
await page.screenshot({ path: `${OUT}/fix-05-cta.png` })

// full page walkthrough errors
await page.evaluate(() => window.scrollTo(0, 0))
await page.waitForTimeout(500)
for (let y = 0; y < 30000; y += 700) {
  await page.evaluate((y) => window.scrollTo(0, y), y)
  await page.waitForTimeout(90)
}
await page.waitForTimeout(800)
log('no errors after full scroll', errors.length === 0, errors.slice(0, 4).join(' | '))

// mobile re-check
const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
const mobErr = []
mob.on('pageerror', (e) => mobErr.push(String(e)))
await mob.goto(BASE, { waitUntil: 'networkidle' })
await mob.waitForTimeout(2000)
for (const id of ['product', 'how-it-works', 'intelligence', 'handover', 'why', 'trust', 'cta']) {
  await mob.evaluate((id) => {
    const el = document.getElementById(id)
    if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY)
  }, id)
  await mob.waitForTimeout(700)
}
const mobOver = await mob.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
log('mobile no overflow after full walk', mobOver <= 1, `delta=${mobOver}`)
log('mobile no errors', mobErr.length === 0, mobErr.slice(0, 3).join(' | '))
await mob.evaluate(() => window.scrollTo(0, 0))
await mob.waitForTimeout(900)
await mob.screenshot({ path: `${OUT}/fix-06-mobile-hero.png` })

// tablet
const tab = await browser.newPage({ viewport: { width: 820, height: 1180 } })
await tab.goto(BASE, { waitUntil: 'networkidle' })
await tab.waitForTimeout(1500)
await tab.locator('#how-it-works').scrollIntoViewIfNeeded()
await tab.waitForTimeout(1000)
await tab.screenshot({ path: `${OUT}/fix-07-tablet-process.png` })
const tabOver = await tab.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
log('tablet no overflow', tabOver <= 1, `delta=${tabOver}`)
await tab.close()

await browser.close()
const fails = results.filter((r) => !r.ok)
console.log(`\n=== ${results.length - fails.length}/${results.length} passed ===`)
fails.forEach((f) => console.log(`FAIL: ${f.n} — ${f.d}`))
if (fails.length) process.exit(1)
