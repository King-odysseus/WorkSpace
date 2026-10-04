// The core daily path, driven the way a person drives it: sign in, choose a
// workspace, write a task down, open it, change it, and find the change still
// there afterwards.
//
// It runs against whatever scripts/browser-journey.mjs has standing up: a
// throwaway database, a seeded workspace, and the built app. Nothing here
// reaches for an API directly, because the point is to exercise the wiring that
// only exists in a browser.

import assert from 'node:assert/strict'
import { after, before } from 'node:test'
import { journey } from './support.mjs'
import { chromium } from 'playwright'

const appUrl = process.env.JOURNEY_APP_URL
const email = process.env.JOURNEY_EMAIL
const password = process.env.JOURNEY_PASSWORD

const WORKSPACE = 'Browser Fixtures'
const SIGNED_IN_AS = 'Browser Owner'

let browser
let page

const signIn = async () => {
  await page.goto(appUrl)

  // The cookie banner is a real part of the first visit, and it sits over the
  // bottom of the page, so it goes first.
  const accept = page.getByRole('button', { name: 'Accept all' })
  if (await accept.count()) await accept.click()

  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('textbox', { name: 'Password' }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForSelector('nav', { timeout: 30000 })
}

// The switcher's own label, which is where the app shows which workspace you
// are in. Scoped to the sidebar because the page has other asides.
const switcherLabel = () =>
  page.locator('aside button[aria-haspopup="true"]').first().innerText()

const chooseWorkspace = async (name) => {
  const switcher = page.locator('aside button[aria-haspopup="true"]').first()
  await switcher.click()
  await page.getByRole('button', { name, exact: true }).first().click()
  await page.waitForFunction(
    (workspace) => document.body.innerText.includes(workspace),
    name,
    { timeout: 30000 },
  )
}

// The search box is how a person finds the task they just wrote when it is not
// among the five Today shows.
const searchFor = async (title) => {
  const box = page.getByLabel('Search workspace').first()
  await box.click()
  await box.pressSequentially(title, { delay: 15 })
  const row = page.locator('div.shadow-elevated', { hasText: title }).first()
  await row.waitFor({ timeout: 20000 })
  await row.locator('button').first().click()
}

before(async () => {
  browser = await chromium.launch()
  page = await browser.newPage()
  page.setDefaultTimeout(20000)
}, { timeout: 60000 })

after(async () => {
  await browser?.close()
})

journey('a task can be written, opened, changed, and found changed', async () => {
  const written = `Journey task ${Date.now()}`
  const changed = `${written} (updated)`

  await signIn()

  // The owner opens on the empty workspace, so this is a real choice.
  await chooseWorkspace(WORKSPACE)
  assert.match(
    await switcherLabel(),
    new RegExp(WORKSPACE),
    'the switcher should be showing the workspace that was chosen',
  )

  // Write it down through the full form, which is the path that asks for
  // ownership and placement.
  await page.getByRole('button', { name: 'New task' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add a task' })
  await dialog.waitFor()
  await page.getByLabel('Task name').fill(written)
  await page.getByRole('button', { name: 'Create task' }).click()
  await dialog.waitFor({ state: 'detached' })

  // Find it, open it, and change it.
  await searchFor(written)
  const drawer = page.locator('.task-dialog')
  await drawer.waitFor()
  const titleField = drawer.locator('[name="title"]')
  await titleField.fill(changed)
  await page.getByRole('button', { name: 'Save changes' }).click()
  await drawer.waitFor({ state: 'detached' })

  // And the change survives a reload, which is the only way to tell a saved
  // edit from one the page is still holding in memory.
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('nav', { timeout: 30000 })

  // The app remembers the last page across a reload but not the last workspace:
  // activeWorkspaceId is seeded from the account's default every time, so the
  // reload lands back on the empty workspace. Choosing again is what a person
  // has to do, so the journey does it too.
  await chooseWorkspace(WORKSPACE)

  await searchFor(changed)

  const reopened = page.locator('.task-dialog')
  await reopened.waitFor()
  assert.equal(
    await reopened.locator('[name="title"]').inputValue(),
    changed,
    'the edit should have been saved',
  )
}, { getPage: () => page })
