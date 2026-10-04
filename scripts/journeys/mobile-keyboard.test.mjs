// The phone widths and the keyboard.
//
// Two things a component test cannot see: whether anything overflows sideways at
// 320px, which no assertion in happy-dom can detect because there is no layout,
// and where the tab key goes, which is a property of the rendered tree rather
// than of any component.
//
// 320px is the narrowest width the app claims to support, so it is the width
// worth checking; the desktop check is here too, because the same journey
// passing at both is the point.

import assert from 'node:assert/strict'
import { after, before } from 'node:test'
import { chromium } from 'playwright'
import { journey } from './support.mjs'

const appUrl = process.env.JOURNEY_APP_URL
const email = process.env.JOURNEY_EMAIL
const password = process.env.JOURNEY_PASSWORD
const workspace = process.env.JOURNEY_WORKSPACE

const NARROW = { width: 320, height: 844 }
const DESKTOP = { width: 1440, height: 900 }

let browser
let page

const signIn = async (viewport) => {
  page = await browser.newPage({ viewport })
  page.setDefaultTimeout(20000)

  await page.goto(appUrl)
  const accept = page.getByRole('button', { name: 'Accept all' })
  if (await accept.count()) await accept.click()

  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('textbox', { name: 'Password' }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForSelector('nav', { timeout: 30000 })

  // On a phone the switcher lives in the drawer, which the More tab opens; on a
  // desktop it is already in the sidebar.
  const more = page.getByRole('button', { name: 'More', exact: true })
  if (await more.count()) await more.first().click()

  // :visible, because the sidebar holds a switcher for the desktop rail too and
  // at this width that one is off screen. Clicking the first match would wait
  // on an element that is never going to be visible.
  await page.locator('aside button[aria-haspopup="true"]:visible').first().click()
  await page.getByRole('button', { name: workspace, exact: true }).first().click()

  // Wait for the fixture's own work to appear rather than for its name: the
  // switcher's label carries the workspace mark as well, and the fixture's
  // other workspace has this one's name as a prefix, so a name match could pass
  // while sitting somewhere with no board at all.
  await page.waitForFunction(
    () => /Fixture task \d/.test(document.body.innerText),
    undefined,
    { timeout: 30000 },
  )

  const close = page.getByRole('button', { name: 'Close sidebar' })
  if (await close.count()) await close.first().click()
  await page.waitForTimeout(400)
}

const overflow = () =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    overflowing: document.documentElement.scrollWidth > window.innerWidth + 1,
    widest: [...document.querySelectorAll('body *')]
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 3)
      .map((element) => `${element.tagName}.${String(element.className).slice(0, 40)}`),
  }))

before(async () => {
  browser = await chromium.launch()
}, { timeout: 60000 })

after(async () => {
  await browser?.close()
})

journey(
  'nothing overflows sideways at 320px',
  async () => {
    await signIn(NARROW)

    const today = await overflow()
    assert.equal(
      today.overflowing,
      false,
      `the day view is wider than the screen: ${today.widest.join(', ')}`,
    )

    // A task drawer is the heaviest thing the phone opens, so it is the layout
    // most likely to be built for a wider screen.
    await page.getByPlaceholder('Add a task').waitFor({ timeout: 20000 })
  },
  { getPage: () => page, timeout: 90000 },
)

journey(
  'the tab key reaches the controls in the order they are drawn',
  async () => {
    await signIn(DESKTOP)

    const visited = []
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press('Tab')
      const focused = await page.evaluate(() => {
        const element = document.activeElement
        if (!element) return null
        const box = element.getBoundingClientRect()
        return {
          label:
            element.getAttribute('aria-label') ||
            (element.innerText || element.value || element.tagName).trim().slice(0, 40),
          visible: box.width > 0 && box.height > 0,
          onScreen: box.right <= window.innerWidth + 1 && box.left >= -1,
        }
      })
      if (focused) visited.push(focused)
    }

    assert.ok(visited.length >= 8, 'the keyboard should have somewhere to go')
    for (const stop of visited) {
      assert.ok(stop.visible, `focus landed on something invisible: ${stop.label}`)
      assert.ok(stop.onScreen, `focus landed off screen: ${stop.label}`)
    }
  },
  { getPage: () => page, timeout: 90000 },
)
