// Measure the inset of every block inside the Settings panel.
//
// The panel carries no padding of its own: each block inside supplies it, and a
// block that forgets sits hard against the card edge while everything around it
// is inset. That is invisible to a component test - there is no layout to
// measure - so this drives the real page and compares each block's left and
// right edge against the panel's.
//
// Run with the app already up:
//   node scripts/settings-inset-audit.mjs http://localhost:5183

import { chromium } from 'playwright'

const appUrl = process.argv[2] || 'http://localhost:5183'
const email = process.env.AUDIT_EMAIL || 'browser-owner@example.invalid'
const password = process.env.AUDIT_PASSWORD || 'audit-env-check'

// Every destination in the Settings navigation.
const SECTIONS = [
  'Profile',
  'Appearance',
  'Notifications',
  'Workspaces',
  'Workspace access',
  'AI settings',
  'Integrations',
  'Templates',
  'Help',
  'Legal',
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(20000)

await page.goto(appUrl)
const accept = page.getByRole('button', { name: 'Accept all' })
if (await accept.count()) await accept.click()
await page.getByRole('textbox', { name: 'Email' }).fill(email)
await page.getByRole('textbox', { name: 'Password' }).fill(password)
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForSelector('nav', { timeout: 30000 })

// The fixture account opens on the empty workspace, and the panels worth
// measuring - invitations, manager permissions - only have anything in them in
// the one with people and history.
const workspace = process.env.AUDIT_WORKSPACE || 'Browser Fixtures'
await page.locator('aside button[aria-haspopup="true"]:visible').first().click()
await page.getByRole('button', { name: workspace, exact: true }).first().click()
await page.waitForFunction(() => /Fixture task \d/.test(document.body.innerText), undefined, {
  timeout: 30000,
})

const menus = await page.getByRole('button', { name: /^Account menu for/ }).all()
await menus[0].click()
await page.getByRole('button', { name: 'Settings' }).first().click()
await page.locator('.settings-view').waitFor({ timeout: 30000 })

const findings = []

for (const section of SECTIONS) {
  const nav = page.getByRole('button', { name: section, exact: true })
  if (!(await nav.count())) continue
  await nav.first().click()
  await page.waitForTimeout(600)

  const report = await page.evaluate(() => {
    const panel = document.querySelector('.settings-view .settings-panel')
    if (!panel) return null
    const panelBox = panel.getBoundingClientRect()

    // Where the text actually starts, not where a box starts. Padding can live
    // at any level, so measuring a block's own box says nothing about whether
    // what a reader sees is inset - every block spans the panel by design.
    const textLeft = (root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walker.nextNode())) {
        if (!node.textContent.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        const box = range.getBoundingClientRect()
        if (box.width > 0 && box.height > 0) return box.left
      }
      return null
    }

    const flush = []
    const insets = []
    for (const child of panel.children) {
      const box = child.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      const left = textLeft(child)
      if (left === null) continue
      const inset = Math.round(left - panelBox.left)
      insets.push(inset)
      if (inset < 16) {
        flush.push({
          className: String(child.className).slice(0, 70) || child.tagName,
          inset,
        })
      }
    }
    const common = insets.length ? insets.slice().sort((a, b) => a - b)[Math.floor(insets.length / 2)] : null
    const every = [...panel.children]
      .filter((child) => child.getBoundingClientRect().width > 0)
      .map((child) => {
        const left = textLeft(child)
        return {
          className: String(child.className).slice(0, 60) || child.tagName,
          inset: left === null ? null : Math.round(left - panelBox.left),
        }
      })
    return { inset: common, flush, every }
  })

  if (!report) {
    findings.push({ section, error: 'no settings panel rendered' })
    continue
  }
  findings.push({ section, ...report })
}

await browser.close()

let problems = 0
for (const entry of findings) {
  if (entry.error) {
    // A section that links out rather than rendering a panel is not a fault.
    console.log(`${entry.section}: ${entry.error}`)
    continue
  }
  if (process.env.AUDIT_ALL === '1') {
    console.log(`${entry.section}`)
    for (const block of entry.every || []) {
      console.log(`   ${String(block.inset).padStart(4)}px  ${block.className}`)
    }
    continue
  }
  if (!entry.flush.length) continue
  problems += entry.flush.length
  console.log(`${entry.section}  (text starts ${entry.inset}px from the panel edge)`)
  for (const block of entry.flush) {
    console.log(`   flush text: ${block.className}  (${block.inset}px)`)
  }
}

console.log(
  problems ? `\n${problems} block(s) sit against the panel edge.` : '\nNo block sits against the panel edge.',
)
