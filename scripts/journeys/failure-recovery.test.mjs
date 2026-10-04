// What the app does when the network lets it down.
//
// Three defects from the usability audit are covered here, and all three are
// the kind that only a browser with a failing network can show: a search that
// failed looked exactly like a search that found nothing, and a refresh that
// failed erased the records already on screen. Component tests can mock those
// responses, but they mock the *client*; these fail the real request the real
// app makes and then look at what a person would see.
//
// Requests are failed with Playwright's route interception rather than by
// breaking the server, so a failure can be aimed at one endpoint for one test
// and taken away again.

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright'

const appUrl = process.env.JOURNEY_APP_URL
const email = process.env.JOURNEY_EMAIL
const password = process.env.JOURNEY_PASSWORD

const WORKSPACE = 'Browser Fixtures'

let browser
let page

const json = (route, status, body) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })

const signIn = async () => {
  await page.goto(appUrl)
  const accept = page.getByRole('button', { name: 'Accept all' })
  if (await accept.count()) await accept.click()
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('textbox', { name: 'Password' }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForSelector('nav', { timeout: 30000 })

  const switcher = page.locator('aside button[aria-haspopup="true"]').first()
  await switcher.click()
  await page.getByRole('button', { name: WORKSPACE, exact: true }).first().click()
  await page.waitForFunction((name) => document.body.innerText.includes(name), WORKSPACE, {
    timeout: 30000,
  })
}

const searchBox = () => page.getByLabel('Search workspace').first()

before(async () => {
  browser = await chromium.launch()
  page = await browser.newPage()
  page.setDefaultTimeout(20000)
  await signIn()
}, { timeout: 90000 })

after(async () => {
  await browser?.close()
})

test('a search that fails says so, and offers a retry that works', async () => {
  let failNext = true
  await page.route('**/search/**', (route) =>
    failNext
      ? json(route, 500, { error: 'Search is unavailable right now.' })
      : route.continue(),
  )

  const box = searchBox()
  await box.click()
  await box.pressSequentially('Fixture task', { delay: 15 })

  // The failure, not an empty result set. This is the whole defect: before the
  // fix, a request that never ran left the field looking as though it had been
  // answered and found nothing.
  await page.getByText('Search is unavailable right now.').waitFor()
  assert.equal(
    await page.getByText(/No matches for/).count(),
    0,
    'a failed search must not read as an empty one',
  )

  // And the retry repeats the query rather than clearing it.
  failNext = false
  await page.getByRole('button', { name: 'Retry search' }).click()
  await page.locator('div.shadow-elevated', { hasText: 'Fixture task' }).first().waitFor()

  await page.unroute('**/search/**')
})

test('an expired session during a search is reported, not swallowed', async () => {
  await page.route('**/search/**', (route) =>
    json(route, 401, { error: 'Authentication is required.' }),
  )

  const box = searchBox()
  await box.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Backspace')
  await box.pressSequentially('Fixture task 2', { delay: 15 })

  await page.getByText('Authentication is required.').waitFor()
  assert.equal(
    await page.getByText(/No matches for/).count(),
    0,
    'an expired session must not read as an empty result',
  )

  await page.unroute('**/search/**')
})

test('a refresh that fails keeps the records already on screen, and says so', async () => {
  // Make the pulse report that chat moved, then fail the chat refetch. That is
  // the shape of the original defect: one endpoint fails during a refresh and
  // the records the reader could already see are replaced by nothing.
  await page.route('**/pulse/**', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    // A digest that cannot match what the client last saw.
    if (body.domains) body.domains.chat = 'moved-for-the-test'
    await route.fulfill({ response, body: JSON.stringify(body) })
  })
  await page.route('**/chat-messages/**', (route) =>
    json(route, 500, { error: 'Chat is unavailable.' }),
  )

  const tasksBefore = await page.locator('[data-panel="tasks"]').innerText()
  assert.match(tasksBefore, /Fixture task \d/, 'the fixture should be on screen to begin with')

  // Reconnecting asks the pulse straight away, which is how a refresh is
  // started without waiting out the polling timer.
  await page.evaluate(() => window.dispatchEvent(new Event('online')))

  const banner = page.getByText('Some workspace data could not be refreshed')
  await banner.waitFor({ timeout: 30000 })

  assert.equal(
    await page.locator('[data-panel="tasks"]').count(),
    1,
    'the board should still be there',
  )
  assert.match(
    await page.locator('[data-panel="tasks"]').innerText(),
    /Fixture task \d/,
    'a failed refresh must not erase records that were already loaded',
  )
  // And it names what went stale rather than saying "some data".
  assert.match(await page.locator('body').innerText(), /chat messages/i)

  await page.unroute('**/pulse/**')
  await page.unroute('**/chat-messages/**')
})
