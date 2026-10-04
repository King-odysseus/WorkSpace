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
import { after, before } from 'node:test'
import { journey } from './support.mjs'
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
  // No service worker. The app polls through it, and a worker's own fetch does
  // not pass through route interception - so the pulse would keep answering
  // with the real thing while the test believed it had changed it.
  page = await browser.newPage({ serviceWorkers: 'block' })
  page.setDefaultTimeout(20000)
  await signIn()
}, { timeout: 90000 })

after(async () => {
  await browser?.close()
})

journey('a search that fails says so, and offers a retry that works', async () => {
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
}, { getPage: () => page })

journey('an expired session during a search is reported, not swallowed', async () => {
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
}, { getPage: () => page })

journey('a refresh that fails keeps the records already on screen, and says so', async () => {
  // Make the pulse report that chat moved, then fail the chat refetch. That is
  // the shape of the original defect: one endpoint fails during a refresh and
  // the records the reader could already see are replaced by nothing.
  let pulseIntercepts = 0
  let chatIntercepts = 0
  await page.route('**/pulse/**', async (route) => {
    pulseIntercepts += 1
    const response = await route.fetch()
    const body = await response.json()
    // Both have to move. The client compares the overall fingerprint first and
    // skips everything when it matches, so changing only the domain digest
    // makes this test pass or fail on whether the app happened to have read the
    // pulse yet - which is how it passed before it was written properly.
    body.fingerprint = 'moved-for-the-test'
    if (body.domains) body.domains.chat = 'moved-for-the-test'
    // A fresh response rather than the one that was fetched: fulfilling with
    // the original keeps its Content-Length, and a longer body than the header
    // promises arrives truncated - which reads as "nothing moved" rather than
    // as an error.
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.route('**/chat-messages/**', (route) => {
    chatIntercepts += 1
    return json(route, 500, { error: 'Chat is unavailable.' })
  })

  const tasksBefore = await page.locator('[data-panel="tasks"]').innerText()
  assert.match(tasksBefore, /Fixture task \d/, 'the fixture should be on screen to begin with')

  // Let the first load finish. A refresh asked for while one is already running
  // is declined rather than queued, which is correct but means the test has to
  // wait for the page to be settled before asking.
  await page.waitForFunction(
    () => !document.body.innerText.includes('Loading workspace data'),
    undefined,
    { timeout: 30000 },
  )

  // What the page asked for after reconnecting, so a failure here says whether
  // the refresh ran at all rather than only that a banner is missing.
  const asked = []
  page.on('request', (request) => asked.push(request.url()))

  // Reconnecting asks the pulse straight away, which is how a refresh is
  // started without waiting out the polling timer.
  await page.evaluate(() => window.dispatchEvent(new Event('online')))

  const banner = page.getByText('Some workspace data could not be refreshed')
  try {
    await banner.waitFor({ timeout: 20000 })
  } catch {
    const pulses = asked.filter((url) => url.includes('/pulse/')).length
    const chats = asked.filter((url) => url.includes('chat-messages')).length
    throw new Error(
      `no stale banner appeared. After reconnecting the page made ${pulses} pulse ` +
        `request(s) and ${chats} chat request(s), and the interceptors saw ` +
        `${pulseIntercepts} pulse and ${chatIntercepts} chat.`,
    )
  }

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
}, { getPage: () => page })
