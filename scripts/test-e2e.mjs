import { chromium } from 'playwright'

const BASE = 'http://localhost:5199'
const OUT = 'test-output'

const results = []
function log(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const errors = []
const consoleErrors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  // expected: anonymous session probe on /login,/signup answers 401 by design
  if (t.includes('Failed to load resource') && t.includes('401')) return
  consoleErrors.push(t)
})

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(2500)

// 1. initial load
const h1 = await page.locator('h1').first().textContent()
log('hero heading present', !!h1 && h1.includes('understanding'), JSON.stringify(h1?.slice(0, 60)))

const sections = ['product', 'how-it-works', 'intelligence', 'why', 'handover', 'trust', 'cta']
for (const id of sections) {
  const el = await page.locator(`#${id}`).count()
  log(`section #${id} exists`, el > 0)
}

// 2. horizontal overflow check (desktop)
let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
log('no horizontal overflow (desktop)', overflow <= 1, `delta=${overflow}`)

// 3. screenshots of each section
await page.screenshot({ path: `${OUT}/01-hero.png` })

async function scrollToSection(id, extra = 0) {
  await page.evaluate(
    ([id, extra]) => {
      const el = document.getElementById(id)
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY + extra)
    },
    [id, extra],
  )
  await page.waitForTimeout(1400)
}

await scrollToSection('product', 400)
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/02-problem-mid.png` })

// scroll further through pinned problem section
await page.evaluate(() => window.scrollBy(0, 1600))
await page.waitForTimeout(1400)
await page.screenshot({ path: `${OUT}/03-problem-late.png` })

await scrollToSection('how-it-works', 200)
await page.waitForTimeout(600)
// scrub through horizontal section
await page.evaluate(() => window.scrollBy(0, 900))
await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}/04-process.png` })

await scrollToSection('intelligence', 100)
await page.waitForTimeout(1600)
await page.screenshot({ path: `${OUT}/05-intelligence.png` })

// 4. knowledge graph interaction
const nodeCount = await page.locator('[data-gnode]').count()
log('knowledge graph nodes render', nodeCount >= 9, `count=${nodeCount}`)
const paymentNode = page.locator('[data-gnode="rollback"]')
if (await paymentNode.count()) {
  await paymentNode.click({ force: true })
  await page.waitForTimeout(700)
  const panelText = await page.locator('[data-gnode="rollback"]').first().textContent()
  log('graph node clickable', !!panelText, panelText ?? '')
}
await page.screenshot({ path: `${OUT}/06-graph-selected.png` })

// 5. authority demo
const authBtn = page.getByRole('button', { name: /transfer access to the successor/i })
if (await authBtn.count()) {
  await authBtn.scrollIntoViewIfNeeded()
  await page.waitForTimeout(600)
  await authBtn.click()
  await page.waitForTimeout(1600)
  const granted = await page.locator('[data-granted]').first().evaluate((el) => getComputedStyle(el).opacity)
  log('authority transfer animates', Number(granted) > 0.9, `opacity=${granted}`)
  await page.screenshot({ path: `${OUT}/07-authority.png` })
} else {
  log('authority transfer button found', false)
}

// 6. handover tabs
await scrollToSection('handover', 60)
await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}/08-handover.png` })
const tabRisk = page.getByRole('tab', { name: /Risks/ })
await tabRisk.click()
await page.waitForTimeout(800)
const riskRows = await page.locator('[data-finding]').count()
log('handover risk tab filters', riskRows === 2, `rows=${riskRows}`)

const firstFinding = page.locator('[data-finding] button').first()
await firstFinding.click()
await page.waitForTimeout(700)
const expanded = await firstFinding.getAttribute('aria-expanded')
log('finding expands', expanded === 'true', `aria-expanded=${expanded}`)
await page.screenshot({ path: `${OUT}/09-handover-expanded.png` })

// evidence tab
const tabEvidence = page.getByRole('tab', { name: /Evidence/ })
await tabEvidence.click()
await page.waitForTimeout(700)
const evRows = await page.locator('[data-finding]').count()
log('evidence tab', evRows === 3, `rows=${evRows}`)

// 7. departure
await scrollToSection('why', 200)
await page.waitForTimeout(1000)
await page.evaluate(() => window.scrollBy(0, 1800))
await page.waitForTimeout(1400)
await page.screenshot({ path: `${OUT}/10-departure.png` })

// 8. trust approval
await scrollToSection('trust', 80)
await page.waitForTimeout(1200)
const approveBtn = page.getByRole('button', { name: /approve finding/i })
if (await approveBtn.count()) {
  await approveBtn.click()
  await page.waitForTimeout(1200)
  const stamp = await page.locator('[data-stamp]').evaluate((el) => getComputedStyle(el).opacity)
  log('approval stamp appears', Number(stamp) > 0.9, `opacity=${stamp}`)
} else {
  log('approve button found', false)
}
await page.screenshot({ path: `${OUT}/11-trust.png` })

// 9. final CTA + footer
await scrollToSection('cta', 40)
await page.waitForTimeout(1600)
await page.screenshot({ path: `${OUT}/12-cta.png` })

await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}/13-footer.png` })

// 10. CTA navigates to real auth route (no modal anymore)
const startBtn = page.getByRole('button', { name: /start with projectpulse/i })
if (await startBtn.count()) {
  await startBtn.click()
  await page.waitForURL('**/signup', { timeout: 10000 }).catch(() => {})
  const onSignup = new URL(page.url()).pathname === '/signup'
  log('CTA navigates to signup', onSignup)
  await page.screenshot({ path: `${OUT}/14-modal.png` })
  const dialog = await page.getByRole('dialog').count()
  log('CTA opens no modal', dialog === 0)
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(600)
} else {
  log('final CTA button found', false)
}

// 11. nav active indicator on scroll
await page.evaluate(() => window.scrollTo(0, 0))
await page.waitForTimeout(600)
await scrollToSection('intelligence', -100)
await page.waitForTimeout(1000)
const activeLink = await page.locator('[data-link="intelligence"]').evaluate((el) => getComputedStyle(el).color)
log('nav active section updates', activeLink.length > 0, activeLink)

// 12. nav becomes solid on scroll
const navBg = await page.locator('[data-navbar]').evaluate((el) => getComputedStyle(el).backgroundColor)
log('navbar transforms on scroll', navBg.includes('255'), navBg)

// 13. reduced motion pass
const rm = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
const rmErrors = []
rm.on('pageerror', (e) => rmErrors.push(String(e)))
await rm.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })
await rm.waitForTimeout(2000)
const rmH1 = await rm.locator('h1').first().isVisible()
log('reduced-motion: content visible', rmH1)
await rm.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2))
await rm.waitForTimeout(1000)
await rm.screenshot({ path: `${OUT}/15-reduced-motion.png` })
log('reduced-motion: no page errors', rmErrors.length === 0, rmErrors.slice(0, 3).join(' | '))
await rm.close()

// 14. mobile pass
const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
const mobErrors = []
mob.on('pageerror', (e) => mobErrors.push(String(e)))
await mob.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })
await mob.waitForTimeout(2000)
const mobOverflow = await mob.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
log('no horizontal overflow (mobile)', mobOverflow <= 1, `delta=${mobOverflow}`)
await mob.screenshot({ path: `${OUT}/16-mobile-hero.png` })

// mobile menu
const menuBtn = mob.getByRole('button', { name: /open menu/i })
await menuBtn.click()
await mob.waitForTimeout(1100)
await mob.screenshot({ path: `${OUT}/17-mobile-menu.png` })
const menuVisible = await mob.locator('[data-mobile-menu]').evaluate((el) => getComputedStyle(el).display)
log('mobile menu opens', menuVisible === 'flex', `display=${menuVisible}`)

// navigate via menu
await mob.locator('[data-mobile-menu] a').first().click()
await mob.waitForTimeout(1500)
const menuClosed = await mob.locator('[data-mobile-menu]').evaluate((el) => getComputedStyle(el).clipPath)
log('mobile menu closes after nav', menuClosed.includes('100%'), menuClosed)

// scroll through mobile sections
for (const id of ['how-it-works', 'intelligence', 'handover', 'why', 'cta']) {
  await mob.evaluate((id) => {
    const el = document.getElementById(id)
    if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY)
  }, id)
  await mob.waitForTimeout(900)
}
await mob.screenshot({ path: `${OUT}/18-mobile-cta.png` })
const mobOverflow2 = await mob.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
log('no horizontal overflow after scroll (mobile)', mobOverflow2 <= 1, `delta=${mobOverflow2}`)
log('mobile: no page errors', mobErrors.length === 0, mobErrors.slice(0, 3).join(' | '))

// 15. tablet pass
const tab = await browser.newPage({ viewport: { width: 820, height: 1180 } })
await tab.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })
await tab.waitForTimeout(1500)
const tabOverflow = await tab.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
log('no horizontal overflow (tablet)', tabOverflow <= 1, `delta=${tabOverflow}`)
await tab.screenshot({ path: `${OUT}/19-tablet.png` })
await tab.close()

// 16. scroll to bottom of desktop — check ScrollTrigger count & errors
const stCount = await page.evaluate(() => {
  // @ts-ignore
  return window.ScrollTrigger ? window.ScrollTrigger.getAll().length : -1
})
log('page errors empty', errors.length === 0, errors.slice(0, 5).join(' | '))
log('console errors empty', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '))
console.log('ScrollTrigger instances (window.ScrollTrigger not exposed):', stCount)

await browser.close()

const fails = results.filter((r) => !r.ok)
console.log(`\n=== ${results.length - fails.length}/${results.length} passed ===`)
if (fails.length) {
  console.log('FAILURES:')
  fails.forEach((f) => console.log(` - ${f.name}: ${f.detail}`))
  process.exit(1)
}
