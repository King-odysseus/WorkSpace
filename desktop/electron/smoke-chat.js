'use strict'

/*
 * The conversation screen, driven in real Electron.
 *
 * Why this is not a node test: every rule checked here is a property of React state
 * in a painted window. A business switch that leaves the previous conversation on
 * screen, a retry that re-sends an empty string, a fallback position nobody states,
 * an answer that pushes the layout sideways - none of those can be observed without
 * something mounting, so none of them can be proved from a file's text.
 *
 * The window is hidden throughout, for the same reason the rest of the smoke test
 * is: a test that flashes a window is a test nobody runs. It loads the real built
 * page and the real screen component; only the bridges are replaced, by
 * `smoke-chat-preload.js`, so no server, session or provider is involved.
 *
 * Both shapes are checked. `full` is Copilot mode; `dock` is the same screen in a
 * 360px column beside the web app, which the plan requires to be the same feature
 * set rather than a reduced one. A rule proved only in the wide shape would pass
 * while the dock, where the panel is actually meant to live, broke.
 *
 * Every read is polled rather than slept on. A fixed wait passes on a fast machine
 * and fails on a slow one, and either way it says nothing about what was proved:
 * polling asserts that the screen settled on the answer being checked.
 */

const path = require('node:path')

const CHAT_PAGE = path.join(__dirname, '..', 'build', 'renderer', 'index.html')
const STUB_PRELOAD = path.join(__dirname, 'smoke-chat-preload.js')

/** The screen's root, as the stylesheet and the renderer test both name it. */
const SCREEN = '[data-shell="chat-screen"]'

/**
 * The assistant opens on Home, so the conversation screen is one click away.
 *
 * Clicking the rail's own control is deliberate: it is the route a person takes, so
 * a screen reachable only by mounting it directly would pass a check that nobody
 * could reproduce in the app.
 */
const OPEN_CONVERSATIONS = `
  (() => {
    const nav = document.querySelector('[data-shell="copilot-conversations"]')
    if (nav) nav.click()
    return nav !== null
  })()
`

/**
 * The thread rail, as opposed to the assistant's navigation rail.
 *
 * Both are `<aside>`, so `querySelector('aside')` answers with whichever comes first
 * in the document - the nav - and a check written against it would pass or fail for
 * a reason that has nothing to do with the conversation. The rail is the one holding
 * the list of threads.
 */
const THREAD_RAIL = `(Array.from(document.querySelectorAll('aside')).find(node => node.querySelector('ul')) || null)`

/**
 * The chat screen's focus rule, read from the stylesheet that actually shipped.
 *
 * A hidden window never matches `:focus-visible`, even after a real Tab, so the
 * computed outline on a correct screen is `none`. What can be checked here is the
 * rule in the built CSS; `chatComposerReachableByKeyboard` checks the other half -
 * that Tab actually lands on the box.
 */
function readFocusRule () {
  const fs = require('node:fs')
  const assets = path.join(__dirname, '..', 'build', 'renderer', 'assets')
  let files = []
  try {
    files = fs.readdirSync(assets).filter(name => name.endsWith('.css'))
  } catch {
    return null
  }
  for (const name of files) {
    const css = fs.readFileSync(path.join(assets, name), 'utf8')
    const match = /(\[[^{}]*chat-screen[^{}]*\][^{}]*:focus-visible[^{}]*)\{([^}]*)\}/.exec(css)
    if (match !== null) return { file: name, selector: match[1].trim(), rule: match[2].trim() }
  }
  return null
}

function check (report, name, passed, detail) {
  report.checks[name] = { passed: Boolean(passed), detail: detail === undefined ? null : detail }
  if (!passed) report.failed.push(name)
}

function wait (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Read a value out of the page. A page that throws is a failed check, not a crash. */
async function readFrom (win, script, fallback) {
  try {
    return await win.webContents.executeJavaScript(script, true)
  } catch (error) {
    // A thrown script would otherwise read as an empty answer, which is
    // indistinguishable from "the screen has not settled yet" and hides the bug in
    // the check itself. Printed only when asked for, so a passing run stays quiet.
    if (process.env.KAI_SMOKE_DEBUG === '1') {
      process.stderr.write(`smoke-chat: script failed: ${(error && error.message) || 'unknown'}\n`)
    }
    return fallback
  }
}

/** Read until the page answers truthily, so a check waits for the frame it wants. */
async function waitFor (win, script, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await readFrom(win, script, null)
    if (last) return last
    await wait(50)
  }
  return last
}

/**
 * Type into a React-controlled field.
 *
 * Setting `value` directly does nothing, because React tracks the value on the node
 * and only listens for an input event. The native setter is what makes React see a
 * change rather than a silent overwrite.
 */
const TYPE_HELPER = `
  function typeInto (selector, value) {
    const element = document.querySelector(selector)
    if (element === null) return false
    const proto = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }
  function clickByText (text) {
    const buttons = Array.from(document.querySelectorAll('button'))
    const hit = buttons.find(button => (button.textContent || '').trim() === text)
    if (!hit) return false
    hit.click()
    return true
  }
`

/**
 * Every check for the conversation screen, in both shapes.
 *
 * The order matters in one place: the failed turn and its retry are checked before
 * the business switch, because a switch clears the conversation and the retry needs
 * the failure it is retrying to still be on screen.
 */
async function runChatScreenChecks (report) {
  const { BrowserWindow } = require('electron')

  const win = new BrowserWindow({
    width: 1120,
    height: 780,
    show: false,
    webPreferences: {
      preload: STUB_PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      /*
       * A hidden window is a background page, and Chromium clamps its timers: the
       * stub's deliberately slow reads then take many seconds instead of 120ms, and
       * every check that waits for a load times out on a screen that is fine. This
       * is a property of the test window only; the shipped window is not hidden.
       */
      backgroundThrottling: false,
    },
  })

  try {
    await win.loadFile(CHAT_PAGE, { hash: 'copilot' })

    /* Wait for the rail, let the first state and its loads settle, then take the
     * route a person would take. Clicking the instant the nav appears lands before
     * the shell's own state has arrived, and the click is then lost in a re-render. */
    await waitFor(win, `document.querySelector('[data-shell="copilot-conversations"]') !== null`)
    await wait(400)

    let drew = false
    for (let attempt = 0; attempt < 10 && drew !== true; attempt += 1) {
      await readFrom(win, OPEN_CONVERSATIONS, false)
      drew = await waitFor(win, `document.querySelector('${SCREEN}') !== null`, 2000)
    }
    check(report, 'chatScreenDraws', drew === true, drew)

    if (drew !== true) return

    /*
     * Open a conversation, which is what a person does next.
     *
     * Waiting for the screen to populate itself proved unreliable in a hidden window,
     * and it is not the behaviour under test: choosing a thread and seeing its
     * messages is. Clicking the row also proves the rail's own control is wired.
     */
    await readFrom(win, `(() => {
      const rail = ${THREAD_RAIL}
      const row = rail === null ? null : Array.from(rail.querySelectorAll('button'))
        .find(node => (node.textContent || '').trim().startsWith('Overdue invoices'))
      if (row) row.click()
      return row !== null
    })()`, false)

    /* ---------------------------------------------------------------- *
     * What the screen shows on arrival
     * ---------------------------------------------------------------- */

    /* The screen's own markers, and the controls it offers. Read once, because
     * they are decided by the render that drew the screen rather than by a load. */
    const shape = await readFrom(win, `(() => {
      const screen = document.querySelector('${SCREEN}')
      if (screen === null) return null
      const rail = ${THREAD_RAIL}
      return {
        bridge: screen.dataset.chatBridge,
        shell: screen.dataset.shell,
        rail: rail === null ? '' : (rail.textContent || ''),
        composer: document.querySelector('textarea[data-composer="true"]') !== null,
        business: document.querySelector('select[aria-label="Business"]') !== null,
        model: document.querySelector('select[aria-label="Model"]') !== null,
      }
    })()`, null)

    check(report, 'chatScreenMarkedAndBridged',
      shape !== null && shape.shell === 'chat-screen' && shape.bridge === 'present', shape)
    check(report, 'chatListsThreads',
      shape !== null && shape.rail.includes('Overdue invoices') && shape.rail.includes('Quote follow ups'),
      shape)
    check(report, 'chatOffersBusinessAndModel',
      shape !== null && shape.business === true && shape.model === true && shape.composer === true, shape)

    /* The conversation itself, awaited on its own so a slow load is a wait rather
     * than a failed check about markers. */
    const drawn = await waitFor(win, `(() => {
      const user = document.querySelectorAll('[data-bubble="user"]').length
      const assistant = document.querySelectorAll('[data-bubble="assistant"]').length
      return user === 1 && assistant === 2 ? { user, assistant } : null
    })()`, 8000)

    check(report, 'chatDrawsTheConversation', drawn !== null, drawn)

    /* ---------------------------------------------------------------- *
     * Attribution, the fallback position, sources
     * ---------------------------------------------------------------- */

    const attribution = await readFrom(win, `(() => {
      const chips = Array.from(document.querySelectorAll('[data-bubble="assistant"]'))
        .map(bubble => bubble.parentElement ? bubble.parentElement.textContent : '')
      const origins = Array.from(document.querySelectorAll('[data-origin]'))
        .map(node => node.dataset.origin)
      const fallback = document.querySelector('[data-fallback-note="none"]')
      return {
        answers: chips.length,
        namesTheModel: chips.some(text => text.includes('claude-sonnet-4-5')),
        origins,
        unrecorded: chips.some(text => text.includes('Origin not recorded')),
        fallbackDrawn: fallback !== null,
        fallback: fallback === null ? null : (fallback.textContent || '').trim(),
        sources: chips.some(text => text.includes('Documents are not used yet')),
      }
    })()`, null)

    /*
     * The chip is read from the stored row, so a reply that recorded its model says
     * which one, and a reply that recorded nothing says that instead of guessing.
     */
    check(report, 'chatAttributesEveryAnswer',
      attribution !== null &&
        attribution.namesTheModel === true &&
        attribution.origins.includes('cloud') === true &&
        attribution.unrecorded === true,
      attribution)

    /*
     * Every answer states the fallback position. Without this sentence a reply that
     * came from the chosen model reads the same as one swapped behind the person's
     * back, which is exactly the thing the sentence rules out.
     */
    check(report, 'chatStatesTheFallbackPosition',
      attribution !== null &&
        attribution.fallbackDrawn === true &&
        /no fallback is set up/i.test(String(attribution.fallback)),
      attribution)

    check(report, 'chatStatesNoSourcesYet',
      attribution !== null && attribution.sources === true, attribution)

    /* ---------------------------------------------------------------- *
     * A long unbroken message
     * ---------------------------------------------------------------- */

    const overflow = await readFrom(win, `(() => {
      const bubbles = Array.from(document.querySelectorAll('[data-bubble="assistant"]'))
      const long = bubbles.find(bubble => (bubble.textContent || '').length > 200)
      return {
        found: long !== undefined,
        bubbleOverflows: long === undefined ? null : long.scrollWidth > long.clientWidth + 1,
        pageOverflows: document.documentElement.scrollWidth > window.innerWidth + 1,
      }
    })()`, null)

    // A 600-character run with no spaces is what a pasted reference or a URL looks
    // like, and it is what pushes a narrow column sideways if the bubble does not wrap.
    check(report, 'chatWrapsALongUnbrokenAnswer',
      overflow !== null && overflow.found === true && overflow.bubbleOverflows === false &&
        overflow.pageOverflows === false,
      overflow)

    /* ---------------------------------------------------------------- *
     * Empty state, then a failed turn and its retry
     * ---------------------------------------------------------------- */

    const empty = await readFrom(win, `(async () => {
      ${TYPE_HELPER}
      const button = Array.from((${THREAD_RAIL} || document).querySelectorAll('button'))
        .find(node => (node.textContent || '').trim().startsWith('Quote follow ups'))
      if (!button) return { found: false }
      button.click()
      const deadline = Date.now() + 3000
      let text = ''
      while (Date.now() < deadline) {
        const screen = document.querySelector('${SCREEN}')
        text = screen ? (screen.textContent || '') : ''
        if (text.length > 0 && document.querySelectorAll('[data-bubble="user"]').length === 0) break
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      return {
        found: true,
        bubbles: document.querySelectorAll('[data-bubble="user"]').length,
        saysSomething: text.trim().length > 0,
      }
    })()`, { found: false })

    // An empty conversation that draws nothing at all reads as a broken screen, so
    // the check is that it draws something *and* no bubbles.
    check(report, 'chatEmptyThreadDrawsItsOwnState',
      empty !== null && empty.found === true && empty.bubbles === 0 && empty.saysSomething === true, empty)

    const failed = await readFrom(win, `(async () => {
      ${TYPE_HELPER}
      const asked = 'Which invoices are overdue?'
      if (!typeInto('textarea[data-composer="true"]', asked)) return { typed: false }
      await new Promise(resolve => setTimeout(resolve, 60))
      const send = document.querySelector('button[aria-label="Send"]')
      if (!send || send.disabled) return { typed: true, sent: false, disabled: !send ? null : true }
      send.click()

      const deadline = Date.now() + 4000
      let state = null
      while (Date.now() < deadline) {
        const screen = document.querySelector('${SCREEN}')
        state = screen ? screen.dataset.chatState : null
        if (state === 'error') break
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      const screen = document.querySelector('${SCREEN}')
      return {
        typed: true,
        sent: true,
        state,
        retryOffered: Array.from(document.querySelectorAll('button'))
          .some(node => (node.textContent || '').trim() === 'Try again'),
        saysSomething: screen ? (screen.textContent || '').includes('could not be reached') : false,
      }
    })()`, { typed: false })

    check(report, 'chatShowsAFailedTurn',
      failed !== null && failed.sent === true && failed.state === 'error' &&
        failed.retryOffered === true && failed.saysSomething === true,
      failed)

    /*
     * The retry, which is the whole reason this check exists in a real window.
     *
     * The composer is emptied when a turn is sent, so a retry that read its text from
     * the composer would send an empty string and nothing would happen. The assertion
     * is against what the screen actually asked the bridge to send, twice: the first
     * turn and the retry must carry the same words.
     */
    const retried = await readFrom(win, `(async () => {
      ${TYPE_HELPER}
      const clicked = clickByText('Try again')
      if (!clicked) return { clicked: false }

      const deadline = Date.now() + 4000
      let answered = false
      while (Date.now() < deadline) {
        /* The retry lands in the empty thread, so any answer at all is the proof:
         * a count taken from the thread we arrived on would be a different number. */
        if (document.querySelectorAll('[data-bubble="assistant"]').length >= 1) { answered = true; break }
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      const sent = window.__smoke ? window.__smoke.state().sent : []
      return { clicked: true, answered, sent }
    })()`, { clicked: false })

    check(report, 'chatRetrySendsTheOriginalWords',
      retried !== null && retried.clicked === true && retried.answered === true &&
        Array.isArray(retried.sent) && retried.sent.length === 2 &&
        retried.sent[0] === 'Which invoices are overdue?' &&
        retried.sent[1] === retried.sent[0],
      retried)

    /* ---------------------------------------------------------------- *
     * Keyboard focus, in a real field
     * ---------------------------------------------------------------- */

    /*
     * Tab from the top of the document until the composer has it.
     *
     * Real key events rather than `.focus()`, because the point is that a keyboard
     * user can reach the box: a scripted focus would prove only that the element
     * exists and can be focused programmatically, which is not the thing that breaks.
     */
    async function tabToComposer () {
      await readFrom(win, 'document.body.focus()', null)
      for (let step = 0; step < 40; step += 1) {
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
        await wait(25)
        const hit = await readFrom(win,
          `document.activeElement !== null && document.activeElement.matches('textarea[data-composer="true"]')`,
          false)
        if (hit === true) return { reached: true, steps: step + 1 }
      }
      return { reached: false, steps: 40 }
    }

    const tabbed = await tabToComposer()
    check(report, 'chatComposerReachableByKeyboard', tabbed.reached === true, tabbed)

    /*
     * The ring itself is asserted from the built stylesheet rather than from a
     * computed style, because the window is hidden and an unfocused window does not
     * match `:focus-visible` at all - even after a real Tab. Reading the computed
     * outline here would fail on a correct screen, so the check is that the shipped
     * stylesheet carries the rule, in the screen's own scope, with a real width.
     */
    const focusRule = readFocusRule()
    const ringDeclared = focusRule !== null &&
      /outline\s*:\s*\d+(\.\d+)?px/.test(focusRule.rule)
    check(report, 'chatFocusRingIsDeclared', ringDeclared, focusRule)

    /* ---------------------------------------------------------------- *
     * Dark theme, through the main process's own route
     * ---------------------------------------------------------------- */

    /* The composer's own surface is where the palette lands on this screen; the root
     * is transparent, so measuring it would read the same value in both themes. */
    const pale = await readFrom(win,
      `window.getComputedStyle(document.querySelector('textarea[data-composer="true"]')).backgroundColor`, null)

    await readFrom(win, `window.__smoke.setTheme('dark')`, null)
    const dark = await waitFor(win, `document.documentElement.classList.contains('dark')`)
    const darkBack = await readFrom(win,
      `window.getComputedStyle(document.querySelector('textarea[data-composer="true"]')).backgroundColor`,
      null)
    const darkDrew = await readFrom(win, `document.querySelector('${SCREEN}') !== null`, false)

    check(report, 'chatDarkThemeApplies',
      dark === true && darkDrew === true, { dark, darkDrew })
    // The palette has to actually reach the screen, not just the document element.
    check(report, 'chatDarkThemeReachesTheScreen',
      pale !== null && darkBack !== null && pale !== darkBack, { pale, darkBack })

    await readFrom(win, `window.__smoke.setTheme('light')`, null)
    await waitFor(win, `document.documentElement.classList.contains('dark') === false`)

    /* ---------------------------------------------------------------- *
     * Switching business clears the conversation at once
     * ---------------------------------------------------------------- */

    /*
     * Switch business, and check that nothing of the business that was left survives.
     *
     * The switch is driven through the control a person uses, and the reply is read
     * after the screen has settled. What is asserted is the rule that matters: once
     * the other business is selected, its thread is in the rail and none of the
     * previous conversation is drawn beside it. A single reading cannot show which
     * React commit cleared the rows, so the claim here is about the outcome rather
     * than about the ordering inside one batched render.
     */
    await readFrom(win, `(() => {
      const select = document.querySelector('select[aria-label="Business"]')
      if (!select) return false
      const other = Array.from(select.options).find(option => option.value === '12')
      if (!other) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
      setter.call(select, other.value)
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`, false)

    const afterSwitch = await waitFor(win, `(() => {
      const rail = ${THREAD_RAIL}
      const text = rail === null ? '' : (rail.textContent || '')
      const screen = document.querySelector('${SCREEN}')
      const body = screen ? (screen.textContent || '') : ''
      return text.includes('Stock levels') &&
        !body.includes('Overdue invoices') &&
        !body.includes('Three are overdue')
    })()`, 6000)

    check(report, 'chatSwitchLoadsTheOtherBusiness', afterSwitch === true, afterSwitch)

    /* ---------------------------------------------------------------- *
     * Signing out takes the whole conversation with it
     * ---------------------------------------------------------------- */

    const signedOut = await readFrom(win, `(async () => {
      await window.zuriAccess.signOut()
      const deadline = Date.now() + 3000
      let gate = null
      while (Date.now() < deadline) {
        gate = document.querySelector('[data-access="gate"]')
        if (gate !== null) break
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      const copilot = document.querySelector('[data-shell="copilot"]')
      return {
        gate: gate !== null,
        screen: document.querySelector('${SCREEN}') !== null,
        bubbles: document.querySelectorAll('[data-bubble]').length,
        navRows: document.querySelectorAll('[data-shell^="copilot-"]').length,
        accessState: copilot ? copilot.dataset.accessState : null,
      }
    })()`, null)

    check(report, 'chatSignOutShowsTheGate',
      signedOut !== null && signedOut.gate === true && signedOut.screen === false &&
        signedOut.bubbles === 0 && signedOut.navRows === 0,
      signedOut)
    check(report, 'chatSignOutRecordsALockedState',
      signedOut !== null && signedOut.accessState === 'locked', signedOut)

    /* ---------------------------------------------------------------- *
     * The dock: the same screen in 360px
     * ---------------------------------------------------------------- */

    /*
     * The dock is a fresh window rather than a resize, because the surface follows
     * the shell's mode rather than the window's width, and a resized full window
     * would prove nothing about the shape the panel actually ships in.
     */
    const dock = new BrowserWindow({
      width: 360,
      height: 720,
      show: false,
      webPreferences: {
        preload: STUB_PRELOAD,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })

    try {
      await dock.loadFile(CHAT_PAGE, { hash: 'copilot' })
      await readFrom(dock, `window.__smoke.setMode('workspace', true)`, null)
      await waitFor(dock, `document.querySelector('${SCREEN}') !== null`)

      const docked = await waitFor(dock, `(() => {
        const screen = document.querySelector('${SCREEN}')
        const root = document.querySelector('[data-shell="copilot"]')
        if (!screen || !root) return null
        if (root.dataset.surface !== 'dock') return null
        if (document.querySelectorAll('[data-bubble]').length === 0) return null
        return {
          surface: root.dataset.surface,
          screen: true,
          rail: document.querySelector('aside') !== null,
          composer: document.querySelector('textarea[data-composer="true"]') !== null,
          select: document.querySelector('select[aria-label="Conversation"]') !== null,
          threadRows: Array.from(document.querySelectorAll('aside button'))
            .map(button => (button.textContent || '').trim()),
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          bubbles: document.querySelectorAll('[data-bubble="user"]').length,
        }
      })()`, 6000)

      check(report, 'dockChatDrawsCompact',
        docked !== null && docked.surface === 'dock' && docked.screen === true, docked)
      // The dock is the same conversation, not a smaller feature set: the thread
      // picker and the composer are both there, and the rail has become a select.
      check(report, 'dockChatKeepsTheSameControls',
        docked !== null && docked.composer === true && docked.select === true &&
          docked.rail === false && docked.bubbles === 1,
        docked)
      check(report, 'dockChatDoesNotOverflowItsColumn',
        docked !== null && docked.overflow === false, docked)
    } finally {
      if (dock && !dock.isDestroyed()) dock.destroy()
    }
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
  }
}

module.exports = { runChatScreenChecks, CHAT_PAGE, STUB_PRELOAD }
