// Chat, check-ins, and what happens to a half-written one.
//
// The last three things UX-23 lists that no journey covered. Draft recovery in
// particular is a promise about what survives a dismissal, and the only way to
// check a promise about surviving is to dismiss something and come back.

import assert from 'node:assert/strict'
import { after, before } from 'node:test'
import { chromium } from 'playwright'
import { journey } from './support.mjs'

const appUrl = process.env.JOURNEY_APP_URL
const email = process.env.JOURNEY_EMAIL
const password = process.env.JOURNEY_PASSWORD
const workspace = process.env.JOURNEY_WORKSPACE

let browser
let page

const signIn = async () => {
  page = await browser.newPage()
  page.setDefaultTimeout(20000)

  await page.goto(appUrl)
  const accept = page.getByRole('button', { name: 'Accept all' })
  if (await accept.count()) await accept.click()

  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('textbox', { name: 'Password' }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForSelector('nav', { timeout: 30000 })

  await page.locator('aside button[aria-haspopup="true"]:visible').first().click()
  await page.getByRole('button', { name: workspace, exact: true }).first().click()
  await page.waitForFunction(() => /Fixture task \d/.test(document.body.innerText), undefined, {
    timeout: 30000,
  })
}

const openCheckInComposer = async () => {
  await page.getByRole('button', { name: 'Check-ins' }).first().click()
  await page.getByRole('button', { name: 'My check-in' }).click({ timeout: 20000 })
  const dialog = page.getByRole('dialog', { name: 'Daily check-in' })
  await dialog.waitFor()
  return dialog
}

before(async () => {
  browser = await chromium.launch()
  await signIn()
}, { timeout: 90000 })

after(async () => {
  await browser?.close()
})

journey(
  'the seeded channel opens with its message in it',
  async () => {
    await page.getByRole('button', { name: 'Channels' }).first().click()

    // The reader's own message, in the room it was posted to.
    await page
      .getByText('Fixture message for the chat journey.')
      .first()
      .waitFor({ timeout: 30000 })
  },
  { getPage: () => page, timeout: 90000 },
)

journey(
  'a check-in that is closed before saving comes back with its text',
  async () => {
    const written = `Half-written check-in ${Date.now()}`
    const dialog = await openCheckInComposer()

    await dialog.getByLabel('What did you complete?').fill(written)

    // Closing is the dismissal the draft exists for. Nothing is saved here, so
    // the only thing that can bring this text back is the draft.
    await page.getByRole('button', { name: 'Close workspace update dialog' }).click()
    await dialog.waitFor({ state: 'detached' })

    const reopened = await openCheckInComposer()
    assert.equal(
      await reopened.getByLabel('What did you complete?').inputValue(),
      written,
      'the typing should have come back',
    )
    assert.ok(
      await reopened.getByText('Restored your unsaved draft').isVisible(),
      'and the form should say that is what happened',
    )

    // Discarding starts the form over rather than closing it.
    await page.getByRole('button', { name: 'Discard draft' }).click()
    assert.equal(await reopened.getByLabel('What did you complete?').inputValue(), '')
    await page.getByRole('button', { name: 'Close workspace update dialog' }).click()
    await reopened.waitFor({ state: 'detached' })
  },
  { getPage: () => page, timeout: 120000 },
)

journey(
  'a check-in can be written and saved',
  async () => {
    const written = `Finished the fixture journey ${Date.now()}`
    const dialog = await openCheckInComposer()

    await dialog.getByLabel('What did you complete?').fill(written)
    await dialog.getByRole('button', { name: /Save update|Sending/ }).click()
    await dialog.waitFor({ state: 'detached', timeout: 20000 })

    // Saved, so it is on the page, and the draft it was written from is gone.
    await page.getByText(written).first().waitFor({ timeout: 20000 })
    const draftsLeft = await page.evaluate(() =>
      Object.keys(window.localStorage).filter((key) =>
        key.startsWith('workspace-record-draft:') && key.endsWith(':checkin'),
      ),
    )
    assert.deepEqual(draftsLeft, [], 'a saved check-in should leave no draft behind')
  },
  { getPage: () => page, timeout: 120000 },
)
