// Shared bits for the journeys.

import { test } from 'node:test'

const slug = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)

/**
 * A journey, which leaves a picture behind when it fails.
 *
 * A Playwright stack trace says which line threw. It does not say what was on
 * the screen, which is usually the thing you need: whether the click missed,
 * whether a banner was covering the control, whether the app was somewhere
 * entirely different from where the journey thought it was. CI collects these
 * as an artifact.
 *
 * The page is read through a function rather than passed directly, because a
 * page is created in a before() hook: reading it here would capture undefined
 * and the screenshot would silently never happen.
 *
 * @param {string} name
 * @param {() => Promise<void>} body
 * @param {{ getPage?: () => import('playwright').Page, timeout?: number }} options
 */
export const journey = (name, body, { getPage, timeout = 60000 } = {}) =>
  test(
    name,
    async () => {
      try {
        await body()
      } catch (error) {
        const page = getPage?.()
        if (page) {
          await page
            .screenshot({ path: `journey-failure-${slug(name)}.png` })
            .catch(() => {
              // The page may already be closed, which is itself worth knowing
              // but not worth replacing the real failure with.
            })
        }
        throw error
      }
    },
    { timeout },
  )
