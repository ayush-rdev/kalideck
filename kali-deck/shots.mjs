// Capture README screenshots from the live deck through the SSH tunnel.
//   node shots.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.SHOT_URL || 'http://127.0.0.1:8080'
const PASSWORD = process.env.SHOT_PW
mkdirSync('../docs', { recursive: true })

const run = async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })

  // login
  await page.goto(`${BASE}/#login`, { waitUntil: 'networkidle' })
  await page.fill('input[type=password]', PASSWORD)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2500)

  const shots = [
    { hash: '/dashboard', file: '../docs/dashboard.png', wait: 3000 },
    { hash: '/tools', file: '../docs/tools.png', wait: 2500 },
    { hash: '/terminals', file: '../docs/terminals.png', wait: 4500 },
    { hash: '/docker', file: '../docs/docker.png', wait: 2500 },
    { hash: '/privacy', file: '../docs/privacy.png', wait: 2500 },
  ]
  for (const s of shots) {
    await page.evaluate(h => { location.hash = h }, s.hash)
    await page.waitForTimeout(s.wait)
    await page.screenshot({ path: s.file })
    console.log('captured', s.file)
  }

  await browser.close()
  console.log('done')
}

run().catch(e => { console.error(e); process.exit(1) })
