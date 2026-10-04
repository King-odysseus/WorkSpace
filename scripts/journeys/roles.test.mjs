// What each role is actually shown.
//
// The permission model is thirteen granular keys enforced on the server, but the
// interface decides by role and uses one granular key anywhere. That makes the
// interface the thing worth checking: not whether the server would refuse an
// action, which the backend tests cover, but whether a person is offered
// something they cannot do, or denied something they can.
//
// The fixture has one account per role, so each is a sign-in rather than a
// separate setup.

import assert from 'node:assert/strict'
import { after, before } from 'node:test'
import { journey } from './support.mjs'
import { chromium } from 'playwright'

const appUrl = process.env.JOURNEY_APP_URL
const password = process.env.JOURNEY_PASSWORD
const workspace = process.env.JOURNEY_WORKSPACE

const ACCOUNTS = {
  owner: process.env.JOURNEY_EMAIL,
  manager: process.env.JOURNEY_MANAGER_EMAIL,
  member: process.env.JOURNEY_MEMBER_EMAIL,
}

// The four Settings sections owners and managers get and members do not.
const LEADER_ONLY_SECTIONS = ['Workspace access', 'AI settings', 'Integrations', 'Templates']
const EVERYONE_SECTIONS = ['Profile', 'Appearance', 'Notifications', 'Workspaces']

let browser
// The page the running journey is using, so a failure can be photographed.
let page

const signInAs = async (email) => {
  // Assigned, not declared: the module holds the page so a failure can be
  // photographed, and each test signs in as a different role.
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
  await page.getByRole('button', { name: workspace, exact: true }).first().click()
  await page.waitForFunction((name) => document.body.innerText.includes(name), workspace, {
    timeout: 30000,
  })

  return page
}

const openSettings = async (page) => {
  const menus = await page.getByRole('button', { name: /^Account menu for/ }).all()
  await menus[0].click()
  await page.getByRole('button', { name: 'Settings' }).first().click()
  await page.locator('.settings-view').waitFor({ timeout: 30000 })
}

const settingsSections = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.settings-nav button, .settings-nav a, [class*="settings-nav"] button')]
      .map((element) => element.innerText.trim())
      .filter(Boolean),
  )

before(async () => {
  browser = await chromium.launch()
}, { timeout: 60000 })

after(async () => {
  await browser?.close()
})

journey('a member gets personal settings and none of the workspace administration', async () => {
  page = await signInAs(ACCOUNTS.member)
  await openSettings(page)

  const shown = (await settingsSections(page)).join(' | ')
  for (const section of EVERYONE_SECTIONS) {
    assert.match(shown, new RegExp(section), `a member should still have ${section}`)
  }
  for (const section of LEADER_ONLY_SECTIONS) {
    assert.doesNotMatch(
      shown,
      new RegExp(section),
      `${section} is owner and manager only, and a member was offered it`,
    )
  }

  await page.close()
}, { getPage: () => page })

journey('a manager gets the workspace administration sections', async () => {
  page = await signInAs(ACCOUNTS.manager)
  await openSettings(page)

  const shown = (await settingsSections(page)).join(' | ')
  for (const section of LEADER_ONLY_SECTIONS) {
    assert.match(shown, new RegExp(section), `a manager should have ${section}`)
  }

  await page.close()
}, { getPage: () => page })

journey('a member is told an import can be previewed but not committed', async () => {
  page = await signInAs(ACCOUNTS.member)

  await page.getByRole('button', { name: 'Import data' }).first().click()
  await page.locator('.import-stepper, .import-layout').first().waitFor({ timeout: 30000 })

  // The page states the limit rather than hiding the whole feature, which is
  // the behaviour the guide documents.
  assert.match(
    await page.locator('body').innerText(),
    /preview files but cannot commit/i,
    'a member should be told what their role allows on an import',
  )

  await page.close()
}, { getPage: () => page })
