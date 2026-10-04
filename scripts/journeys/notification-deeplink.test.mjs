// Following an alert has to land on the record it names.
//
// The bell is the one surface where a reader is handed a record rather than
// looking for one, so a link that opens the right page but not the right item
// is a dead end they cannot recover from by looking harder. The fixture seeds
// one unread alert naming a task, and this follows it.

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright'

const appUrl = process.env.JOURNEY_APP_URL
const email = process.env.JOURNEY_EMAIL
const password = process.env.JOURNEY_PASSWORD

const WORKSPACE = 'Browser Fixtures'
const ALERT = 'Fixture alert naming a task'

let browser
let page

before(async () => {
  browser = await chromium.launch()
  page = await browser.newPage()
  page.setDefaultTimeout(20000)

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
}, { timeout: 90000 })

after(async () => {
  await browser?.close()
})

test('a bell row opens the record it names, not just the page it lives on', async () => {
  await page.getByRole('button', { name: 'Open workspace activity notifications' }).click()

  const row = page.getByRole('button', { name: `Open ${ALERT}` })
  await row.waitFor()

  await row.click()

  // The task drawer, on the task the alert named.
  const drawer = page.locator('.task-dialog')
  await drawer.waitFor({ timeout: 20000 })

  const title = await drawer.locator('[name="title"]').inputValue()
  assert.match(
    title,
    /^Fixture task \d$/,
    'the alert should have opened the task it named',
  )
})
