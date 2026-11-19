'use strict'

/*
 * The controls a person actually uses, measured where they are drawn.
 *
 * The stylesheet test next door pins the rules that fixed five visibility defects -
 * a screen that collapsed to 557px inside an 800px window, a current nav row squared
 * off while its neighbours were pills, rail labels rendered at 16px and split as
 * "Works pace", conversation pickers filled the same white as the panel behind them,
 * and a disabled button still offering a pointer cursor. A rule in a file is not the
 * same claim as a control on screen: the token sheet pins several of these properties
 * with `!important`, so a rule can be present, correct and still lose. Every check
 * here therefore measures the built page in a real window - computed style, bounding
 * boxes and hit testing - rather than reading CSS.
 *
 * Two windows carry the work: the title bar page, which is where the 76px rail lives,
 * and the assistant page, which draws the sidebar, the assistant nav, the Models
 * screen and the conversation screen. A third, narrow window proves the same controls
 * survive the 360px dock.
 *
 * "Visible" is asked three ways, because each way catches a different defect: is there
 * a box at all, is that box inside the window, and does a click at its centre land on
 * it rather than on something covering it. A control can be present, sized, styled and
 * still unusable because a sibling overlaps it, which no amount of CSS reading shows.
 */

const path = require('node:path')

const { STUB_PRELOAD } = require('./smoke-chat.js')

const PAGE = path.join(__dirname, '..', 'build', 'renderer', 'index.html')

const COPILOT_ROOT = '[data-shell="copilot"]'
const COPILOT_NAV = 'nav[aria-label="ZuriCopilot"] button'
const CHROME_RAIL = '[data-shell="rail"] button'
const CHAT_SCREEN = '[data-shell="chat-screen"]'
const MODELS_SCREEN = '[data-shell="models-screen"]'

/* The controls each screen asks a person to use. Deliberately a short list of the
 * real ones rather than every node: a check that enumerates the whole tree reports
 * "everything" when it fails, which tells nobody which control broke. */
const CHROME_CONTROLS = [
  '[data-shell="mode-workspace"]',
  '[data-shell="mode-copilot"]',
  '[data-shell="dock-toggle"]',
  '[data-shell="window-close"]',
]

const ASSISTANT_CONTROLS = [
  '[data-shell="copilot-home"]',
  '[data-shell="copilot-conversations"]',
  '[data-shell="copilot-models"]',
  '[data-shell="copilot-open-workspace"]',
]

const MODELS_CONTROLS = [
  '[data-shell="models-test"]',
  '[data-shell="models-remove"]',
  '[data-shell="models-discover"]',
  '[data-shell="models-base-url"]',
  '[data-shell="models-default-model"]',
]

/**
 * Read a computed property from every control matching a selector.
 *
 * Runs inside the page, so the answer is what the engine resolved after every
 * cascade layer and `!important` has been applied.
 */
const SHAPES = `
  function shapes (selector) {
    return Array.from(document.querySelectorAll(selector)).map(row => {
      const style = window.getComputedStyle(row)
      const corners = [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius,
      ]
      return {
        key: row.dataset.shell || (row.textContent || '').trim().slice(0, 24),
        current: row.getAttribute('aria-current') === 'page',
        radius: corners.join(' '),
      }
    })
  }
`

/**
 * The three questions that together mean "a person can use this".
 *
 * Returned as a list of problems so a failure names the control and the reason
 * instead of only reporting "false".
 */
/** The surface a control actually sits on. */
const SURFACE = `
  function surfaceBehind (element) {
    let node = element.parentElement
    while (node !== null) {
      const colour = window.getComputedStyle(node).backgroundColor
      if (colour !== 'rgba(0, 0, 0, 0)' && colour !== 'transparent') return colour
      node = node.parentElement
    }
    return window.getComputedStyle(document.body).backgroundColor
  }
`

const AUDIT = SURFACE + `
  function audit (selectors) {
    const problems = []
    const seen = new Set()
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (seen.has(element)) continue
        seen.add(element)
        /*
         * Bring the control into view first, because a person would. A control
         * below the fold of a scrolling panel is reachable and therefore fine; what
         * is not fine is one that is still outside the window once scrolled to, or
         * one whose centre is covered.
         */
        element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        const label = (element.dataset.shell || element.getAttribute('aria-label') ||
          (element.textContent || '').trim()).slice(0, 32)
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        const hidden = element.closest('[hidden], [aria-hidden="true"]') !== null
        if (rect.width < 1 || rect.height < 1) {
          problems.push({ control: label, why: 'no size' })
          continue
        }
        if (style.visibility !== 'visible' || style.display === 'none' || hidden) {
          problems.push({ control: label, why: 'not drawn' })
          continue
        }
        if (Number.parseFloat(style.opacity || '1') < 0.4) {
          problems.push({ control: label, why: 'almost transparent' })
          continue
        }
        if (rect.top < -1 || rect.left < -1 ||
            rect.bottom > window.innerHeight + 1 || rect.right > window.innerWidth + 1) {
          problems.push({
            control: label,
            why: 'outside the window even after scrolling to it',
            rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(window.innerHeight) },
          })
          continue
        }
        // Where the click would land. A control whose centre belongs to something
        // else is present, sized and unusable at the same time.
        const hit = document.elementFromPoint(
          Math.round(rect.left + rect.width / 2),
          Math.round(rect.top + rect.height / 2))
        if (hit === null) {
          problems.push({ control: label, why: 'nothing at its centre' })
          continue
        }
        if (!(hit === element || element.contains(hit) || hit.contains(element))) {
          problems.push({ control: label, why: 'covered by another element', by: (hit.dataset.shell || hit.tagName) })
        }
      }
    }
    return problems
  }
`

/** Every rail label's size and whether it stayed on one line. */
const LABELS = `
  function railLabels (selector) {
    return Array.from(document.querySelectorAll(selector)).map(row => {
      const label = row.querySelector('span')
      if (label === null) return { text: null, fontSize: null, lines: null, clips: null, tall: null }
      const style = window.getComputedStyle(label)
      const rect = label.getBoundingClientRect()
      return {
        text: (label.textContent || '').trim(),
        fontSize: style.fontSize,
        lines: label.getClientRects().length,
        clips: label.scrollWidth > label.clientWidth + 1,
        tall: rect.height > 14,
      }
    })
  }
`

/**
 * Is a control distinguishable from the surface it sits on?
 *
 * Transparent counts as indistinguishable, not as different: a field whose own fill
 * is transparent shows whatever is behind it, so on a panel of the same colour it is
 * invisible even though the two computed values differ. That is exactly the defect
 * this check exists for, so it is written as one rule rather than three comparisons.
 */
function findable (background, surface) {
  if (background === null || background === undefined) return false
  if (surface === null || surface === undefined) return false
  if (background === 'rgba(0, 0, 0, 0)' || background === 'transparent') return false
  return background !== surface
}

async function readFrom (win, script, fallback) {
  try {
    return await win.webContents.executeJavaScript(script, true)
  } catch (error) {
    if (process.env.KAI_SMOKE_DEBUG === '1') {
      process.stderr.write(`smoke-controls: script failed: ${(error && error.message) || 'unknown'}\n`)
    }
    return fallback
  }
}

function wait (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Press Enter the way a keyboard does: key down, character, key up.
 *
 * All three, because the first two are not equivalent. Measured in a hidden window:
 * a key down followed straight by the key up leaves a focused button untouched, and
 * the character event in between is what makes Chromium run the button's default
 * action. A physical key always produces all three, so sending only two would have
 * reported a working control as broken.
 */
function pressEnter (win) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
  win.webContents.sendInputEvent({ type: 'char', keyCode: 'Return' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
}

/** Wait until the page answers truthily, so a check measures a settled frame. */
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
 * A hidden window is a background page, and Chromium clamps its timers.
 *
 * The same setting the conversation checks use: without it the stub's reads take
 * seconds instead of milliseconds and every check times out on a screen that is
 * fine. It applies to the test window only.
 */
function windowFor (width, height) {
  const { BrowserWindow } = require('electron')
  return new BrowserWindow({
    width,
    height,
    show: false,
    webPreferences: {
      preload: STUB_PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
}

/**
 * The title bar page: the 76px rail with its mode, dock and account controls.
 *
 * This page is reached without the `copilot` hash, which is what makes it the
 * chrome rather than the assistant: `App` chooses between them by the local view,
 * not by the shell's mode.
 */
async function checkChromeRail (report) {
  const win = windowFor(1280, 800)

  try {
    await win.loadFile(PAGE, { hash: 'chrome' })
    const ready = await waitFor(win, `document.querySelector('[data-shell="rail"]') !== null`, 12000)
    if (ready !== true) {
      check(report, 'controlsChromeRailDraws', false, ready)
      return
    }
    await wait(400)

    /* ---------------------------------------------------------------- *
     * The labels: 10px, one line, inside the rail's 60px
     * ---------------------------------------------------------------- */

    const labels = await readFrom(win, `(() => {
      ${LABELS}
      return railLabels('[data-shell="rail"] button')
    })()`, null)

    /*
     * The defect was not a missing label but a split one: at 16px "Workspace"
     * measured 87px inside a 52px box and broke into "Works pace". One client rect
     * means one line, and `clips` false means the text fits rather than being cut.
     */
    const labelsFit = Array.isArray(labels) && labels.length >= 3 &&
      labels.every(entry => entry.fontSize === '10px' && entry.lines === 1 &&
        entry.clips === false && entry.tall === false)
    check(report, 'controlsChromeRailLabelsFitOnOneLine', labelsFit, labels)

    /* ---------------------------------------------------------------- *
     * The rows: one shape, whatever their state
     * ---------------------------------------------------------------- */

    const rows = await readFrom(win, `(() => {
      ${SHAPES}
      return shapes('[data-shell="rail"] button')
    })()`, null)

    const current = Array.isArray(rows) ? rows.filter(entry => entry.current) : []
    const radiusUnchanged = current.length === 1 &&
      rows.every(entry => entry.radius === current[0].radius) &&
      !/^0px 0px 0px 0px$/.test(current[0].radius)
    check(report, 'controlsChromeRailRowsShareOneShape', radiusUnchanged,
      { rows, current: current.length })

    /* ---------------------------------------------------------------- *
     * Every control present, inside the window and not covered
     * ---------------------------------------------------------------- */

    const problems = await readFrom(win, `(() => {
      ${AUDIT}
      return audit(${JSON.stringify(CHROME_CONTROLS)})
    })()`, null)

    check(report, 'controlsChromeRailControlsAreUsable',
      Array.isArray(problems) && problems.length === 0, problems)

    /* ---------------------------------------------------------------- *
     * Clicking and tabbing actually switch the mode
     * ---------------------------------------------------------------- */

    /*
     * The click is dispatched on the control a person sees, and the proof that it
     * worked is the shell's own state coming back changed: the current row has to
     * move to the mode that was clicked.
     */
    const clicked = await readFrom(win, `(async () => {
      const target = document.querySelector('[data-shell="mode-workspace"]')
      if (target === null) return { found: false }
      target.click()
      const deadline = Date.now() + 3000
      while (Date.now() < deadline) {
        const current = document.querySelector('[data-shell="rail"] button[aria-current="page"]')
        if (current !== null && current.dataset.shell === 'mode-workspace') return { found: true, current: current.dataset.shell }
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      const current = document.querySelector('[data-shell="rail"] button[aria-current="page"]')
      return { found: true, current: current === null ? null : current.dataset.shell }
    })()`, null)

    check(report, 'controlsChromeModeSwitchWorksByMouse',
      clicked !== null && clicked.found === true && clicked.current === 'mode-workspace', clicked)

    /*
     * The same control by keyboard: Tab until it has focus, then Enter.
     *
     * Real key events rather than `.focus()`, because the point is that a keyboard
     * user can reach and use the control. A scripted focus would prove only that the
     * node is focusable.
     */
    let reached = false
    let activated = null
    await readFrom(win, 'document.body.focus()', null)
    for (let step = 0; step < 40 && reached !== true; step += 1) {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
      await wait(25)
      reached = await readFrom(win,
        `document.activeElement !== null && document.activeElement.dataset !== undefined &&
         document.activeElement.dataset.shell === 'mode-copilot'`, false)
    }

    if (reached === true) {
      pressEnter(win)
      activated = await waitFor(win,
        `(() => {
          const current = document.querySelector('[data-shell="rail"] button[aria-current="page"]')
          return current !== null && current.dataset.shell === 'mode-copilot' ? current.dataset.shell : null
        })()`, 3000)
    }

    check(report, 'controlsChromeModeSwitchWorksByKeyboard',
      reached === true && activated === 'mode-copilot', { reached, activated })
  } finally {
    win.destroy()
  }
}

/**
 * The assistant page: the sidebar, its nav, the Models screen and the conversation.
 *
 * The three defects that lived here are measured in order, because each needs a
 * different screen: the window height on the first screen drawn, the nav shape on
 * the rail, the pickers and the disabled composer on the conversation.
 */
async function checkAssistantControls (report) {
  const win = windowFor(1120, 780)

  try {
    await win.loadFile(PAGE, { hash: 'copilot' })
    const ready = await waitFor(win, `document.querySelector(${JSON.stringify(COPILOT_ROOT)}) !== null`, 12000)
    if (ready !== true) {
      check(report, 'controlsAssistantDraws', false, ready)
      return
    }
    await wait(500)

    /* ---------------------------------------------------------------- *
     * The screen fills the window
     * ---------------------------------------------------------------- */

    /*
     * Measured at 557px inside an 800px window before the height was made definite:
     * the assistant screen sizes itself with `height: 100%`, and a percentage height
     * resolves against the parent's height rather than its minimum. The check is the
     * one that defect would have failed - the root's own height against the window's.
     */
    const filled = await readFrom(win, `(() => {
      const root = document.querySelector(${JSON.stringify(COPILOT_ROOT)})
      if (root === null) return null
      const rect = root.getBoundingClientRect()
      return {
        windowHeight: window.innerHeight,
        height: Math.round(rect.height),
        bottom: Math.round(rect.bottom),
        fills: rect.height >= window.innerHeight - 2 && rect.bottom <= window.innerHeight + 1,
      }
    })()`, null)

    check(report, 'controlsAssistantFillsTheWindow',
      filled !== null && filled.fills === true, filled)

    /* ---------------------------------------------------------------- *
     * The assistant's nav rows are one shape
     * ---------------------------------------------------------------- */

    const navRows = await readFrom(win, `(() => {
      ${SHAPES}
      return shapes(${JSON.stringify(COPILOT_NAV)})
    })()`, null)

    const navCurrent = Array.isArray(navRows) ? navRows.filter(entry => entry.current) : []
    const navShape = navCurrent.length === 1 &&
      navRows.every(entry => entry.radius === navCurrent[0].radius) &&
      !/^0px 0px 0px 0px$/.test(navCurrent[0].radius)
    check(report, 'controlsAssistantNavRowsShareOneShape', navShape,
      { rows: navRows, current: navCurrent.length })

    const assistantProblems = await readFrom(win, `(() => {
      ${AUDIT}
      return audit(${JSON.stringify(ASSISTANT_CONTROLS)})
    })()`, null)

    check(report, 'controlsAssistantNavIsUsable',
      Array.isArray(assistantProblems) && assistantProblems.length === 0, assistantProblems)

    /* ---------------------------------------------------------------- *
     * The conversation: a disabled control says so
     * ---------------------------------------------------------------- */

    const conversation = await readFrom(win, `(async () => {
      const open = () => {
        const row = document.querySelector('[data-shell="copilot-conversations"]')
        if (row === null) return false
        row.click()
        return true
      }
      let drawn = document.querySelector(${JSON.stringify(CHAT_SCREEN)}) !== null
      for (let attempt = 0; attempt < 10 && drawn !== true; attempt += 1) {
        open()
        const deadline = Date.now() + 1200
        while (Date.now() < deadline) {
          drawn = document.querySelector(${JSON.stringify(CHAT_SCREEN)}) !== null
          if (drawn) break
          await new Promise(resolve => setTimeout(resolve, 50))
        }
      }
      if (drawn !== true) return { drawn: false }
      ${SURFACE}
      const send = document.querySelector('button[aria-label="Send"]')
      const select = document.querySelector(${JSON.stringify(CHAT_SCREEN)} + ' select')
      const picker = select === null ? null : {
        background: window.getComputedStyle(select).backgroundColor,
        surface: surfaceBehind(select),
      }
      return {
        drawn: true,
        sendFound: send !== null,
        sendDisabled: send === null ? null : send.disabled,
        sendCursor: send === null ? null : window.getComputedStyle(send).cursor,
        picker,
      }
    })()`, null)

    /*
     * The composer's send button is disabled while the box is empty, which is the
     * control the cursor defect was measured on: disabled, half opacity, and a
     * pointer cursor over it - the half of the signal that says "click me"
     * contradicting the half that says "not yet".
     */
    check(report, 'controlsDisabledControlSaysSo',
      conversation !== null && conversation.sendFound === true &&
        conversation.sendDisabled === true && conversation.sendCursor === 'not-allowed',
      conversation)

    /*
     * The three pickers sat on the card surface filled with the card surface: white
     * on white, reading as plain text with a chevron. Same colour means invisible,
     * so the check is that the two differ.
     */
    check(report, 'controlsConversationPickersAreFindable',
      conversation !== null && conversation.picker !== null &&
        findable(conversation.picker.background, conversation.picker.surface),
      conversation === null ? null : conversation.picker)

    /* ---------------------------------------------------------------- *
     * The Models screen: pills and findable fields
     * ---------------------------------------------------------------- */

    const models = await readFrom(win, `(async () => {
      const open = () => {
        const row = document.querySelector('[data-shell="copilot-models"]')
        if (row === null) return false
        row.click()
        return true
      }
      let drawn = document.querySelector(${JSON.stringify(MODELS_SCREEN)}) !== null
      for (let attempt = 0; attempt < 10 && drawn !== true; attempt += 1) {
        open()
        const deadline = Date.now() + 1200
        while (Date.now() < deadline) {
          drawn = document.querySelector(${JSON.stringify(MODELS_SCREEN)}) !== null
          if (drawn) break
          await new Promise(resolve => setTimeout(resolve, 50))
        }
      }
      if (drawn !== true) return { drawn: false }

      ${AUDIT}
      const radiusOf = selector => {
        const node = document.querySelector(selector)
        return node === null ? null : window.getComputedStyle(node).borderTopLeftRadius
      }

      /*
       * Choose a provider, because the form shows one provider at a time: the
       * address and starting-model fields exist only once one is selected. Choosing
       * it is also the control a person uses, so this exercises the screen rather
       * than reaching past it. Native setter plus a change event, because React
       * tracks the value on the node and a plain assignment is invisible to it.
       */
      const preset = document.querySelector('select[data-shell="models-preset"]')
      let chose = false
      if (preset !== null) {
        const option = Array.from(preset.options).find(node => node.value !== '')
        if (option !== undefined) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
          setter.call(preset, option.value)
          preset.dispatchEvent(new Event('change', { bubbles: true }))
          chose = true
        }
      }
      const fieldDeadline = Date.now() + 2500
      while (Date.now() < fieldDeadline &&
             document.querySelector('input[data-shell="models-base-url"]') === null) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }

      const field = document.querySelector('input[data-shell="models-base-url"]')
      const panel = document.querySelector(${JSON.stringify(MODELS_SCREEN)})
      return {
        drawn: true,
        chose,
        buttonRadius: radiusOf('[data-shell="models-test"]'),
        saveRadius: radiusOf('[data-shell="models-discover"]'),
        fieldBackground: field === null ? null : window.getComputedStyle(field).backgroundColor,
        fieldSurface: field === null ? null : surfaceBehind(field),
        presetBackground: preset === null ? null : window.getComputedStyle(preset).backgroundColor,
        presetSurface: preset === null ? null : surfaceBehind(preset),
        panelBackground: panel === null ? null : window.getComputedStyle(panel).backgroundColor,
        problems: audit(${JSON.stringify(MODELS_CONTROLS)}),
      }
    })()`, null)

    /*
     * The Models screen used to force every control square while its neighbours in
     * the window were pills. A shape check is what notices that returning.
     */
    const modelsShaped = models !== null && models.drawn === true &&
      models.buttonRadius !== null && /^([1-9]\d{2,}|999)px$/.test(models.buttonRadius) &&
      models.saveRadius !== null && /^([1-9]\d{2,}|999)px$/.test(models.saveRadius)
    check(report, 'controlsModelsButtonsArePills', modelsShaped,
      models === null ? null : { test: models.buttonRadius, discover: models.saveRadius })

    check(report, 'controlsModelsFieldsAreFindable',
      models !== null && models.chose === true &&
        findable(models.fieldBackground, models.fieldSurface) &&
        findable(models.presetBackground, models.presetSurface),
      models === null
        ? null
        : {
            field: models.fieldBackground,
            fieldSurface: models.fieldSurface,
            preset: models.presetBackground,
            presetSurface: models.presetSurface,
            chose: models.chose,
          })

    check(report, 'controlsModelsControlsAreUsable',
      models !== null && Array.isArray(models.problems) && models.problems.length === 0,
      models === null ? null : models.problems)

    /* ---------------------------------------------------------------- *
     * Dark theme, through the main process's own route
     * ---------------------------------------------------------------- */

    const pale = models === null ? null : models.fieldBackground
    await readFrom(win, 'window.__smoke.setTheme(\'dark\')', null)
    const dark = await waitFor(win, 'document.documentElement.classList.contains(\'dark\')')

    const darkState = await readFrom(win, `(() => {
      ${LABELS}
      ${AUDIT}
      const root = document.querySelector(${JSON.stringify(COPILOT_ROOT)})
      const field = document.querySelector('input[data-shell="models-base-url"]')
      const rect = root === null ? null : root.getBoundingClientRect()
      return {
        fills: rect !== null && rect.height >= window.innerHeight - 2,
        label: railLabels(${JSON.stringify(COPILOT_NAV)}),
        fieldBackground: field === null ? null : window.getComputedStyle(field).backgroundColor,
        fieldSurface: field === null ? null : surfaceBehind(field),
        problems: audit(${JSON.stringify(MODELS_CONTROLS)}),
      }
    })()`, null)

    /*
     * The palette has to actually reach these controls: a theme that changes the
     * document element but not the field fill would leave a dark window with a white
     * box, which is the same invisible-field defect wearing the other theme.
     */
    check(report, 'controlsDarkThemeKeepsControlsReadable',
      dark === true && darkState !== null && darkState.fills === true &&
        darkState.fieldBackground !== null && darkState.fieldSurface !== null &&
        findable(darkState.fieldBackground, darkState.fieldSurface) &&
        darkState.fieldBackground !== pale &&
        Array.isArray(darkState.problems) && darkState.problems.length === 0 &&
        Array.isArray(darkState.label) &&
        darkState.label.every(entry => entry.lines === 1 && entry.clips === false),
      {
        dark,
        field: darkState === null ? null : darkState.fieldBackground,
        fieldSurface: darkState === null ? null : darkState.fieldSurface,
        pale,
        problems: darkState === null ? null : darkState.problems,
      })

    /* ---------------------------------------------------------------- *
     * The same controls, reachable by keyboard, on this page
     * ---------------------------------------------------------------- */

    let navReached = false
    await readFrom(win, 'document.body.focus()', null)
    for (let step = 0; step < 40 && navReached !== true; step += 1) {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
      await wait(25)
      navReached = await readFrom(win,
        `document.activeElement !== null && document.activeElement.dataset !== undefined &&
         document.activeElement.dataset.shell === 'copilot-conversations'`, false)
    }

    let keyboardOpened = null
    if (navReached === true) {
      pressEnter(win)
      keyboardOpened = await waitFor(win,
        `document.querySelector(${JSON.stringify(CHAT_SCREEN)}) !== null`, 4000)
    }

    check(report, 'controlsAssistantNavWorksByKeyboard',
      navReached === true && keyboardOpened === true, { navReached, keyboardOpened })
  } finally {
    win.destroy()
  }
}

/**
 * The dock: the same controls in a 360px column.
 *
 * A separate window rather than a resize, because the surface follows the shell's
 * mode and dock state rather than the window's width - a narrowed full window would
 * prove nothing about the shape that ships.
 */
async function checkDockControls (report) {
  const win = windowFor(360, 720)

  try {
    await win.loadFile(PAGE, { hash: 'copilot' })
    const ready = await waitFor(win, `document.querySelector(${JSON.stringify(COPILOT_ROOT)}) !== null`, 12000)
    if (ready !== true) {
      check(report, 'controlsDockDraws', false, ready)
      return
    }

    await readFrom(win, 'window.__smoke.setMode(\'workspace\', true)', null)
    const docked = await waitFor(win,
      `document.querySelector(${JSON.stringify(COPILOT_ROOT)}) !== null &&
       document.querySelector(${JSON.stringify(COPILOT_ROOT)}).dataset.surface === 'dock'`, 6000)

    if (docked !== true) {
      check(report, 'controlsDockDraws', false, docked)
      return
    }

    await wait(400)

    const state = await readFrom(win, `(() => {
      ${AUDIT}
      const root = document.querySelector(${JSON.stringify(COPILOT_ROOT)})
      const rect = root === null ? null : root.getBoundingClientRect()
      const controls = document.querySelectorAll('[data-shell="dock-close"], [data-shell="dock-open-full"]')
      return {
        fills: rect !== null && rect.height >= window.innerHeight - 2,
        noSideScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
        controls: controls.length,
        problems: audit(['[data-shell="dock-close"]', '[data-shell="dock-open-full"]']),
      }
    })()`, null)

    /*
     * 360px is one column, so the failures here are different from the full window:
     * a control pushed off the right edge, or a row that widens the document until it
     * scrolls sideways. Both are measured:
     */
    check(report, 'controlsFitTheDock',
      state !== null && state.fills === true && state.noSideScroll === true &&
        state.controls >= 2 && Array.isArray(state.problems) && state.problems.length === 0,
      state)
  } finally {
    win.destroy()
  }
}

/** Every control check, in the order the screens are reached. */
async function runControlChecks (report) {
  await checkChromeRail(report)
  await checkAssistantControls(report)
  await checkDockControls(report)
}

module.exports = { runControlChecks }

/**
 * Record one check, in the same shape the other check files use.
 *
 * Duplicated rather than imported: `shell-smoke.js` requires this file, so requiring
 * it back would be a cycle. The two fields that matter are the name a failure is
 * reported under and whether it passed.
 */
function check (report, name, passed, detail) {
  report.checks[name] = { passed: Boolean(passed), detail: detail === undefined ? null : detail }
  if (!passed) report.failed.push(name)
}
