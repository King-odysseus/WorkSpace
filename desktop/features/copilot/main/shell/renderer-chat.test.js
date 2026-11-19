'use strict'

/*
 * The conversation screen, read as source rather than rendered.
 *
 * `ChatPanel.tsx` is the one screen a person spends their time on, and each rule
 * below is a decision that was expensive to get right the first time. They are also
 * all decisions that a later rewrite can undo without breaking a build:
 *
 * - The screen's root carries `data-shell="chat-screen"`. The stylesheet scopes
 *   every chat rule by that attribute and a window test looks the screen up by it,
 *   so the attribute and the stylesheet are one contract in two files.
 * - Every chat rule in `shell.css` is scoped by that same attribute. The sheet is
 *   shared with the web app's tokens and with the rest of the shell, so an
 *   unscoped selector written here would restyle the rail, the Models screen and
 *   every dialog from the conversation screen's file.
 * - No inline `style=` and no hex colour. The renderer runs under
 *   `style-src 'self'`, so an inline style is a rule the page cannot apply, and a
 *   hex colour is a palette the design system does not own.
 * - No import from the web application's source. The desktop shell reuses the
 *   token sheet read-only, and the first `src/components` import would drag the
 *   whole app into the desktop bundle.
 * - A turn subscription is given back, and an event is filtered by the thread it
 *   belongs to. A reply that outlives a business switch carries the old thread's
 *   id, and appending it would put one business's answer under another's name.
 * - A retry offers the words of the turn that failed, not the emptied composer. The
 *   composer is cleared when the message is sent, so a retry read from it sends
 *   nothing: a control that looks like recovery and quietly does nothing.
 * - A business switch clears before it loads. Loading first leaves a frame where
 *   the previous business's conversation is drawn under the new business's name.
 * - A draft card says what approving does, in the shared module's one sentence.
 *   A second copy of that sentence here would drift the moment the first changed.
 * - An answer is attributed from its stored row, and the chip's words come from
 *   the shared module rather than from a literal in the view.
 * - Every answer states the fallback position, in the shared module's words. Silence
 *   under an answer reads the same whether a fallback ran or not, which is the one
 *   thing that line exists to rule out.
 * - The dock draws the same conversation in its compact shape, from the same file,
 *   so a feature cannot exist in one surface and not the other.
 * - Pill geometry lives in the stylesheet, not in utility classes. The token sheet
 *   pins control shapes with `!important`, so a `rounded-full` here would read as
 *   intent while doing nothing.
 *
 * Nothing here renders React, opens a database or reaches a network. The files are
 * read as text and their structure is asserted, which is what lets these rules fail
 * at test time instead of at the next design review. Comments are stripped before
 * any assertion, so a sentence *about* a rule can never satisfy it, and line numbers
 * are preserved by the stripper so a failure points at the real line.
 *
 *   cd desktop && node --test features/copilot/main/shell/renderer-chat.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const RENDERER = path.join(__dirname, '..', '..', '..', '..', 'renderer')
const SOURCE = path.join(RENDERER, 'src')
const SHARED = path.join(__dirname, '..', '..', 'shared')

const PANEL = path.join(SOURCE, 'ChatPanel.tsx')
const VIEW = path.join(SOURCE, 'CopilotView.tsx')
const STYLESHEET = path.join(SOURCE, 'shell.css')
const SCREEN = path.join(SHARED, 'chat-screen.ts')

/** The attribute that ties the screen, the stylesheet and a window test together. */
const MARKER = 'data-shell="chat-screen"'

/** Read a source file as text. */
function read (file) {
  return fs.readFileSync(file, 'utf8')
}

/*
 * The source with comments removed, and every line where it was.
 *
 * A comment that mentions `eventBelongsTo`, `'Cloud'` or `PROPOSAL_NOTE` is
 * documentation, not behaviour, and a test that read it as behaviour would pass on
 * a file that only talked about the rule. Newlines inside a block comment are kept
 * as newlines so a reported line number is the line a person would open.
 *
 * Quotes are tracked so a `//` inside a string is not mistaken for a comment, which
 * would silently cut the rest of that line out of every later check.
 */
function stripComments (source) {
  let out = ''
  let index = 0
  let quote = null

  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]

    if (quote !== null) {
      out += char
      if (char === '\\') {
        out += next === undefined ? '' : next
        index += 2
        continue
      }
      if (char === quote) quote = null
      index += 1
      continue
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char
      out += char
      index += 1
      continue
    }

    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2)
      const stop = end === -1 ? source.length : end + 2
      const removed = source.slice(index, stop)
      out += ' ' + '\n'.repeat((removed.match(/\n/g) ?? []).length)
      index = stop
      continue
    }

    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index)
      index = end === -1 ? source.length : end
      continue
    }

    out += char
    index += 1
  }

  return out
}

/**
 * Every CSS block in a stylesheet, as a selector and its body.
 *
 * Written as a depth-tracking walk rather than a split on `}`, because a split
 * cannot tell an `@media` wrapper from the rule inside it: the prelude of the
 * inner rule would run from the wrapper's own brace and the selector would be
 * read as `@media (...)`. A stack keeps the two apart, so an at-rule block is
 * still visible (and can be skipped deliberately) while the rule inside it is
 * still checked.
 */
function cssBlocks (text) {
  const blocks = []
  const stack = []
  let prelude = ''

  for (const char of text) {
    if (char === '{') {
      stack.push({ selector: prelude.trim(), body: '' })
      prelude = ''
      continue
    }
    if (char === '}') {
      const block = stack.pop()
      if (block === undefined) continue
      blocks.push({ selector: block.selector.replace(/\s+/g, ' ').trim(), body: block.body.trim() })
      prelude = ''
      continue
    }
    if (stack.length === 0) prelude += char
    else stack[stack.length - 1].body += char
  }

  return blocks
}

/**
 * The arguments of one call, from its opening parenthesis to the matching close.
 *
 * Written as a depth count rather than as a slice to the end of the line, because a
 * call is formatted differently on different days and a line-based read would
 * quietly take in the statement after it. Quoted strings are not skipped: none of
 * the calls this file reads holds a parenthesis inside one, and a scan that only
 * half tracked quotes would be harder to trust than one that says so.
 */
function callText (code, openAt) {
  if (code[openAt] !== '(') return null

  let depth = 0
  for (let index = openAt; index < code.length; index += 1) {
    const char = code[index]
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return code.slice(openAt + 1, index)
    }
  }
  return null
}

/** The panel's source with comments removed: what the screen actually does. */
const PANEL_CODE = stripComments(read(PANEL))

/** The view's source with comments removed. */
const VIEW_CODE = stripComments(read(VIEW))

/** The stylesheet with comments removed, so a rule mentioned in prose is not a rule. */
const CSS_CODE = stripComments(read(STYLESHEET))

/** The shared screen module, comments removed. */
const SCREEN_CODE = stripComments(read(SCREEN))

/* ================================================================== *
 * The screen is findable
 * ================================================================== */

test('the conversation screen is identified by data-shell="chat-screen" on its root', () => {
  /*
   * The stylesheet scopes every chat rule by this attribute and a window test looks
   * the screen up by it, so the attribute is a contract in three places. If it were
   * renamed or dropped, the scoped rules would silently stop matching and the screen
   * would fall back to the token sheet's shapes with no error anywhere - the kind of
   * regression that is only noticed by eye, in the dock, on a small window.
   */
  assert.equal(
    PANEL_CODE.includes(MARKER),
    true,
    `ChatPanel.tsx no longer carries ${MARKER} on its root`,
  )

  // An attribute of an element, followed by another attribute or by the tag's
  // close: the string has to be a JSX attribute and not prose that names one.
  assert.match(
    PANEL_CODE,
    /data-shell="chat-screen"[\s>]/,
    `${MARKER} is quoted somewhere but set on no element`,
  )

  // Both roots carry it: the signed-out frame and the signed-in screen are two
  // returns, and a stylesheet scoped to one of them would restyle half the screen.
  const occurrences = PANEL_CODE.split(MARKER).length - 1
  assert.ok(
    occurrences >= 2,
    `expected both roots of ChatPanel to carry ${MARKER}, found ${occurrences}`,
  )

  // And the stylesheet scopes by exactly the same string, which is what makes the
  // attribute load-bearing rather than decorative.
  assert.equal(CSS_CODE.includes(MARKER), true, 'shell.css does not scope anything by the chat screen')
})

/* ================================================================== *
 * The stylesheet's chat rules are scoped
 * ================================================================== */

test('every chat rule in shell.css is scoped to the chat screen', () => {
  /*
   * One stylesheet is shared by the rail, the Models screen, the chat screen and
   * every dialog, and the application's token sheet pins shapes with `!important`.
   * A selector written for the conversation screen without the scope would restyle
   * the whole shell from the chat screen's file: pills on the Models form, pills on
   * the rail's rows. Nothing in a CSS file reports that; only a rule about scoping
   * does. The region is taken from the first place the sheet names the screen, so
   * the rules that came before it - the rail and the Models screen - are not
   * wrongly held to the chat screen's contract.
   */
  const start = CSS_CODE.indexOf(MARKER)
  assert.notEqual(start, -1, 'shell.css no longer scopes anything by the chat screen')

  const region = CSS_CODE.slice(start)
  const blocks = cssBlocks(region)

  // A mangled parse would find nothing and pass; the sheet has nine rules here.
  assert.ok(
    blocks.length >= 8,
    `expected the chat-screen region to hold several rules, parsed ${blocks.length}`,
  )

  const unscoped = blocks
    // An at-rule wrapper is not a selector: it opens a block of rules and the rules
    // inside it are the ones that must carry the scope.
    .filter(block => block.selector.startsWith('@') === false)
    .filter(block => block.selector.length > 0)
    .filter(block => block.selector.includes(MARKER) === false)
    .map(block => block.selector)

  assert.deepEqual(
    unscoped,
    [],
    `these chat-screen rules are unscoped and would restyle the rest of the shell: ${unscoped.join(' | ')}`,
  )

  // The region really is the chat screen's: the rules in it mention the screen.
  assert.ok(
    blocks.some(block => block.selector.includes(MARKER)),
    'the region taken from the stylesheet contains no scoped chat rule',
  )
})

/* ================================================================== *
 * One stylesheet, and this screen adds nothing to it
 * ================================================================== */

test('the screen carries no inline style and no colour of its own', () => {
  /*
   * The renderer's CSP is `style-src 'self'`, so an inline `style=` prop is a rule
   * the page is not allowed to apply: it looks like styling in review and does
   * nothing at runtime, which is the worst of both. A hex colour is the same mistake
   * in a different place - the shell consumes the application's tokens, so a colour
   * written here would be a second palette that the web app can never see.
   */
  const inlineStyle = PANEL_CODE.match(/\bstyle\s*=/g) ?? []
  assert.deepEqual(inlineStyle, [], 'ChatPanel.tsx sets an inline style')

  const hexColours = PANEL_CODE.match(/#[0-9a-f]{3,8}\b/gi) ?? []
  assert.deepEqual(hexColours, [], 'ChatPanel.tsx states a hex colour instead of a token')

  // The screen still styles itself, through the shared sheet: this is not a screen
  // that gave up on styling, it is one that keeps it in one place.
  assert.match(PANEL_CODE, /className=/, 'ChatPanel.tsx no longer styles anything')
})

test('the screen imports nothing from the web application source', () => {
  /*
   * The desktop shell consumes `src/pencil.css` read-only and shares the contract
   * modules under `desktop/features`. An import from `src/components` or
   * `src/mockups` would drag the web app - and its router, its data layer and its
   * own assumptions about the window - into the desktop bundle, and an import of
   * the stylesheet itself would give the renderer a second copy of the palette that
   * the Vite config already strips the font import out of.
   */
  const paths = [...PANEL_CODE.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map(match => match[1])
  const bare = [...PANEL_CODE.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)].map(match => match[1])
  const all = [...paths, ...bare]

  assert.ok(all.length > 0, 'ChatPanel.tsx no longer imports anything, so this check proves nothing')

  for (const banned of ['src/pencil.css', 'src/components', 'src/mockups']) {
    const offenders = all.filter(specifier => specifier.includes(banned))
    assert.deepEqual(offenders, [], `ChatPanel.tsx imports from the web app source: ${banned}`)
  }

  /*
   * And nothing reaches outside `desktop/`. Every shared module this screen uses is
   * two levels up (`../../features/...`); a third `..` would be the repository root,
   * which is where the web application lives, so counting the segments catches the
   * same mistake under a path this test has not been told about yet. Package imports
   * such as `react` are not paths and are not counted.
   */
  const relatives = all.filter(specifier => specifier.startsWith('.'))
  const steppingOut = relatives.filter(specifier => (specifier.match(/\.\.\//g) ?? []).length > 2)
  assert.deepEqual(
    steppingOut,
    [],
    `ChatPanel.tsx imports from outside the desktop app: ${steppingOut.join(' | ')}`,
  )
})

/* ================================================================== *
 * A turn subscription, and events that belong
 * ================================================================== */

test('the screen subscribes to turn events, gives the subscription back, and filters by thread', () => {
  /*
   * Three things a screen like this loses in a rewrite, each with its own symptom.
   * Without the cleanup, every mount adds a listener and a development double mount
   * applies each delta twice, so the reply reads "The quoteThe quote moves". Without
   * the thread check, a reply that outlives a business switch is appended to the
   * conversation now on screen - the main process refusing to publish it is only
   * half the rule, and the append is the other half.
   */
  const subscribed = /const\s+([A-Za-z_$][\w$]*)\s*=\s*bridge\.onEvent\(/.exec(PANEL_CODE)
  assert.notEqual(subscribed, null, 'ChatPanel.tsx no longer subscribes to turn events')
  const stop = subscribed[1]

  // The value the subscription returned is what the effect hands back to React.
  assert.equal(
    PANEL_CODE.includes(`return ${stop}`),
    true,
    `ChatPanel.tsx does not return ${stop} from the effect that subscribed, so the listener leaks`,
  )

  // And the event is filtered by the thread it belongs to before anything is
  // appended. Compared by position, because a check that runs after the append has
  // already drawn the wrong reply.
  const subscribeAt = PANEL_CODE.indexOf('bridge.onEvent(')
  const filterAt = PANEL_CODE.indexOf('eventBelongsTo(', subscribeAt)
  const appendAt = PANEL_CODE.indexOf('setMessages(', subscribeAt)

  assert.notEqual(filterAt, -1, 'the event handler no longer asks eventBelongsTo')
  assert.ok(filterAt > subscribeAt, 'eventBelongsTo is called outside the event handler')
  assert.notEqual(appendAt, -1, 'the event handler no longer appends the finished reply')
  assert.ok(
    filterAt < appendAt,
    'the reply is appended before the thread is checked, so another thread\'s answer can be drawn',
  )

  // The thread ids it compares are the live turn and the selected thread, which are
  // the two the screen is drawing right now.
  assert.match(
    PANEL_CODE.slice(filterAt, appendAt),
    /eventBelongsTo\([^)]*selectedThreadId[^)]*\)/,
    'eventBelongsTo is not asked about the selected thread',
  )
})

/* ================================================================== *
 * A retry re-sends the turn that failed
 * ================================================================== */

test('the retry button offers the words of the failed turn, not the emptied composer', () => {
  /*
   * The failure branch used to record the retry text from the composer state
   * variable, and the composer is emptied the moment a message is sent, so "Try
   * again" called send('') and did nothing at all. That is the worst shape a control
   * can take: it looks like recovery, so the person presses it instead of retyping,
   * and the question is lost.
   *
   * Two things make the fix real, and both are asserted below. The text has to come
   * from the turn that was running, which means the handler captures the live turn;
   * and the subscription must stop depending on the composer, or the next person to
   * touch this handler is invited to read it again.
   */
  const subscribeAt = PANEL_CODE.indexOf('bridge.onEvent(')
  assert.notEqual(subscribeAt, -1, 'ChatPanel.tsx no longer subscribes to turn events')

  /*
   * The end of the effect's body, so every slice below is the handler and nothing
   * after it. `}, [` is where the body closes and the dependency list opens, and
   * taking the region from there keeps the component's own top out of the account:
   * `turnRef.current = turn` is assigned up there, so a `turnRef` found in this
   * region really is the handler's own capture and not that assignment.
   */
  const bodyEnd = PANEL_CODE.indexOf('}, [', subscribeAt)
  assert.notEqual(bodyEnd, -1, 'the turn subscription no longer has a dependency array')
  const handler = PANEL_CODE.slice(subscribeAt, bodyEnd)

  // The retry text is the failed turn's own words. Read to the call's closing
  // parenthesis, which is what makes this an assertion about the argument rather
  // than about the word appearing somewhere near it.
  const retryAt = handler.indexOf('setRetryText(event.retryable')
  assert.notEqual(retryAt, -1, 'the failure branch no longer offers a retry')

  const retryArgument = callText(handler, handler.indexOf('(', retryAt))
  assert.notEqual(retryArgument, null, 'the retry line could not be read to its closing parenthesis')
  assert.equal(
    retryArgument.includes('current?.text'),
    true,
    `the retry text is set from "${retryArgument.trim()}", which is not the words of the turn that failed`,
  )

  /*
   * And why that expression exists at all: the handler captures the running turn
   * once, before the thread check, so the failure branch still has it after
   * `setTurn(null)`. Reading the ref again inside the branch would find nothing.
   */
  const capturedAt = handler.indexOf('turnRef.current')
  assert.notEqual(capturedAt, -1, 'the handler no longer captures the running turn')
  assert.ok(
    capturedAt < retryAt,
    'the running turn is read after the failure branch, by which point the turn has already been cleared',
  )

  /*
   * The composer is never the source. This is the old line as it was written, so a
   * rewrite that reaches for the state variable again fails here and not in a window
   * where the button silently does nothing.
   */
  assert.equal(
    handler.includes('setRetryText(event.retryable ? text'),
    false,
    'the retry text is read from the composer, which is emptied as soon as the message is sent',
  )

  // Every call, not only the failure branch: a retry set from the composer anywhere
  // on this screen has the same symptom, so it is checked wherever it appears.
  const calls = [...PANEL_CODE.matchAll(/setRetryText\(/g)]
  assert.ok(calls.length > 0, 'the screen no longer records any retry text')

  for (const call of calls) {
    const argument = callText(PANEL_CODE, call.index + 'setRetryText'.length)
    assert.notEqual(argument, null, 'a setRetryText call could not be read to its closing parenthesis')

    // `current?.text` and any other property read are a row's own words. A bare
    // `text` is the composer state variable, and that is empty by the time this runs.
    const withoutPropertyReads = argument.replace(/\??\.\s*text\b/g, '')
    assert.doesNotMatch(
      withoutPropertyReads,
      /\btext\b/,
      `setRetryText is given the emptied composer: ${argument.trim()}`,
    )
  }

  /*
   * And the subscription no longer depends on the composer. A dependency on `text`
   * re-subscribes on every keystroke, and it is also the shape that invites reading
   * the composer inside the handler again. Only a standalone `text` entry is refused:
   * the other entries are this effect's own business and may change.
   */
  const depsOpen = bodyEnd + '}, '.length
  const depsClose = PANEL_CODE.indexOf('])', depsOpen)
  assert.notEqual(depsClose, -1, 'the dependency list of the turn subscription never closes')

  const deps = PANEL_CODE.slice(depsOpen + 1, depsClose)
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)

  // A guard that this really is the subscription's own list and not some other
  // bracketed text that happened to come first.
  assert.ok(
    deps.includes('selectedThreadId'),
    `the dependency list read as ${JSON.stringify(deps)}, which is not the turn subscription's`,
  )
  assert.equal(
    deps.includes('text'),
    false,
    `the turn subscription depends on the composer (${deps.join(', ')}), so it re-subscribes on every keystroke`,
  )
})

/* ================================================================== *
 * A business switch clears before it loads
 * ================================================================== */

test('a business switch clears the screen before it loads the new business', () => {
  /*
   * The order is the whole point. Clearing and then loading means there is no frame
   * where one business's conversation is drawn under another business's name; the
   * reverse order looks identical in a fast local test and shows the previous
   * business's invoices to somebody who just switched away from it on a slow one.
   * The clear is synchronous and sits in the same effect that sees the new workspace
   * id, which is why the assertion is an index comparison inside that one effect.
   */
  /*
   * Split on the call, and drop the first piece: it is everything written before the
   * first effect - the component's own top, where `clearBusiness` is defined and the
   * workspace id is read - so taking it would answer with the wrong text and the
   * checks below would pass or fail for a reason that has nothing to do with order.
   */
  const effects = PANEL_CODE.split('useEffect(').slice(1)
  const switcher = effects.find(chunk => chunk.includes('workspaceId') && chunk.includes('clearBusiness'))

  assert.notEqual(switcher, undefined, 'no effect both depends on the workspace and clears the business')

  // It is the effect that runs on a switch, not one that merely mentions the id.
  assert.match(
    switcher,
    /\[[^\]]*workspaceId[^\]]*\]/,
    'the effect that clears the business does not depend on the selected workspace',
  )

  const clearAt = switcher.indexOf('clearBusiness(')
  assert.notEqual(clearAt, -1, 'the workspace effect no longer clears the business')

  for (const loader of ['loadThreads(', 'loadMemory(', 'loadProposals(']) {
    const loadAt = switcher.indexOf(loader)
    assert.notEqual(loadAt, -1, `the workspace effect no longer calls ${loader.slice(0, -1)}`)
    assert.ok(
      clearAt < loadAt,
      `${loader} is called before clearBusiness, so one business's rows can be drawn under another's name`,
    )
  }
})

/* ================================================================== *
 * A draft is not an action
 * ================================================================== */

test('a draft card states that approving executes nothing, in the shared words', () => {
  /*
   * A card that offers Approve reads like a button that creates a task, and in this
   * phase it records a decision and nothing else. The sentence saying so lives in
   * `chat-screen.ts` because it is the same sentence the tests of that module check;
   * a copy of it here would be a second source of truth that drifts the first time
   * the phase number changes, and the screen would then be the wrong one of the two.
   */
  assert.equal(
    PANEL_CODE.includes('data-executes="false"'),
    true,
    'the draft card no longer states data-executes="false"',
  )

  const declared = /export const PROPOSAL_NOTE\s*=\s*'([^']+)'/.exec(SCREEN_CODE)
  assert.notEqual(declared, null, 'chat-screen.ts no longer declares PROPOSAL_NOTE')
  const sentence = declared[1]
  assert.ok(sentence.length > 20, 'PROPOSAL_NOTE is too short to be the sentence this rule is about')

  // The one copy of the sentence is in the shared module.
  assert.equal(
    PANEL_CODE.includes(sentence),
    false,
    'ChatPanel.tsx repeats the PROPOSAL_NOTE sentence instead of using the shared one',
  )

  /*
   * And the sentence does reach the card, rather than the note being dropped
   * altogether. The card draws `card.note`, which `proposalCard` fills from
   * PROPOSAL_NOTE; if the panel named PROPOSAL_NOTE itself it would have to import
   * it from the shared module, which is the same rule stated the other way round.
   */
  const notesOnCard = /data-executes="false"[^>]*>\s*\{([^}]*)\}/.exec(PANEL_CODE)
  assert.notEqual(notesOnCard, null, 'the element that states data-executes="false" draws no note')
  const expression = notesOnCard[1].trim()
  assert.ok(
    expression === 'card.note' || expression === 'PROPOSAL_NOTE',
    `the draft card's note is "${expression}", which is neither the shared card note nor PROPOSAL_NOTE`,
  )

  if (expression === 'PROPOSAL_NOTE') {
    assert.match(
      PANEL_CODE,
      /import\s*\{[^}]*PROPOSAL_NOTE[^}]*\}\s*from\s*'\.\.\/\.\.\/features\/copilot\/shared\/chat-screen\.js'/,
      'PROPOSAL_NOTE is used but not imported from the shared module',
    )
  } else {
    // The chain is only real if the shared card is the thing that fills it.
    assert.match(
      SCREEN_CODE,
      /note:\s*PROPOSAL_NOTE/,
      'proposalCard no longer fills its note from PROPOSAL_NOTE, so the card draws nothing',
    )
  }

  // The screen offers no way to execute anything, which is the promise the note makes.
  for (const verb of ['createTask', 'sendTask', 'scheduleTask']) {
    assert.equal(
      PANEL_CODE.includes(verb),
      false,
      `ChatPanel.tsx calls ${verb}, and a draft is not an action in this phase`,
    )
  }
})

/* ================================================================== *
 * Every answer is attributed, in the shared words
 * ================================================================== */

test('an answer is attributed from its stored row, and no chip text is hard-coded', () => {
  /*
   * The chip under a reply says which model answered and whether it left the
   * machine. Both come from the stored row: `answerAttribution` reads `provider`,
   * `model` and `cloud` and answers "not recorded" when a row has none of them, so
   * an unrecorded answer is never labelled with the reassuring one. A label spelled
   * out in this file instead would be the screen's own opinion about a row rather
   * than the row's, and it would stop following the shared module the moment the
   * module's wording changed.
   */
  const rowView = /function MessageRowView \(\{[^}]*\}:[^)]*\)\s*\{([\s\S]*?)\n\}/.exec(PANEL_CODE)
  assert.notEqual(rowView, null, 'ChatPanel.tsx no longer draws one stored message in one component')

  const body = rowView[1]
  const answered = body.indexOf('answerAttribution(')
  assert.notEqual(answered, -1, 'a stored message is drawn without answerAttribution')

  // The person's own turn returns before the attribution, so a question is never
  // given a chip that claims a model answered it.
  const mine = body.indexOf("message.role === 'user'")
  assert.notEqual(mine, -1, 'the stored-message component no longer separates the person\'s turn')
  assert.ok(mine < answered, 'the person\'s own turn is attributed as if a model had answered it')

  // It is handed the row itself, not a hand-built object: the chip's facts have to
  // come from what the store recorded.
  assert.match(body, /answerAttribution\(\s*message\s*\)/, 'answerAttribution is not given the stored row')

  // The chip draws what the shared module decided.
  assert.match(
    PANEL_CODE,
    /\{attribution\.label\}/,
    'the chip no longer draws the label answerAttribution produced',
  )
  assert.match(
    PANEL_CODE,
    /\{attribution\.originLabel\}/,
    'the origin chip no longer draws the label the shared module produced',
  )

  /*
   * And the words themselves are not spelled out beside an answer. `'Cloud'` and
   * 'Local' are the two labels the shared module owns, so a literal in the code that
   * draws an answer would be the screen's own opinion about a stored row and would
   * stop following the module the moment its wording changed.
   *
   * The scan covers the piece of this file that draws a message - from
   * `MessageRowView` down to the `Attribution` chip - because that is where chip text
   * is made. Two comparisons higher up (`chosenModel.originLabel === 'Cloud'` in the
   * model picker and in the streaming row) do spell the label out; they decide
   * whether to draw a local-only hint rather than what a chip says, so they are
   * reported to the owner of this file instead of asserted here, and the day they are
   * replaced by the shared field this wider scan can be restored unchanged.
   */
  const chipStart = PANEL_CODE.indexOf('function MessageRowView')
  const chipEnd = PANEL_CODE.indexOf('function WaitingRow', chipStart)
  assert.notEqual(chipStart, -1, 'ChatPanel.tsx no longer draws a stored answer in its own component')
  assert.notEqual(chipEnd, -1, 'the stored-answer component is no longer followed by the waiting row')

  const chipCode = PANEL_CODE.slice(chipStart, chipEnd)
  const hardCoded = []
  for (const word of ['Cloud', 'Local']) {
    const pattern = new RegExp('([\'"`])' + word + '\\1')
    if (pattern.test(chipCode)) hardCoded.push(word)
  }
  assert.deepEqual(
    hardCoded,
    [],
    `ChatPanel.tsx hard-codes a chip label the shared module owns: ${hardCoded.join(' | ')}`,
  )

  /*
   * A label written as JSX text is the same defect in a spelling the literal scan
   * above cannot decide, so it is checked as text: an element whose only child is the
   * word itself was written by hand rather than drawn from the shared field. Text
   * that merely begins with the word ("Local only") is a sentence of its own and is
   * left alone.
   */
  assert.doesNotMatch(
    PANEL_CODE,
    />\s*(?:Cloud|Local)\s*</,
    'ChatPanel.tsx draws a chip label as JSX text instead of from the shared module',
  )
})

/* ================================================================== *
 * The fallback position is stated
 * ================================================================== */

test('the fallback position is stated under every answer, in the shared words', () => {
  /*
   * Automatic fallback is not configured, so every answer came from the model the
   * person chose. That is worth one sentence: a screen that says nothing under a
   * reply reads the same whether a fallback ran or not, and the first person to add
   * one would have no way to tell whether the line was already promised somewhere.
   *
   * The sentence lives in `chat-screen.ts` beside the other true statements the chip
   * makes, so this file asserts that it is imported, drawn, marked, and not copied.
   */
  assert.match(
    PANEL_CODE,
    /import\s*\{[^}]*\bNO_FALLBACK_NOTE\b[^}]*\}\s*from\s*['"][^'"]*chat-screen\.js['"]/,
    'NO_FALLBACK_NOTE is used but not imported from the shared chat-screen module',
  )

  const attributionAt = PANEL_CODE.indexOf('function Attribution')
  assert.notEqual(attributionAt, -1, 'ChatPanel.tsx no longer draws an answer attribution in its own component')
  const attributionEnd = PANEL_CODE.indexOf('function WaitingRow', attributionAt)
  assert.notEqual(attributionEnd, -1, 'the attribution component is no longer followed by the waiting row')

  /*
   * Drawn, not merely imported. An import nobody renders is exactly the state this
   * rule was added to fix, and it type checks, lints and builds without a word.
   */
  assert.match(
    PANEL_CODE.slice(attributionAt, attributionEnd),
    /\{NO_FALLBACK_NOTE\}/,
    'the attribution component no longer draws the shared fallback sentence',
  )

  /*
   * And it is drawn on an element that names itself, so a window test can find the
   * line without matching a sentence, and so the line going missing is a visible
   * absence rather than one row of the chip quietly thinning out.
   */
  const markedAt = PANEL_CODE.indexOf('data-fallback-note="none"')
  assert.notEqual(markedAt, -1, 'the fallback line no longer states data-fallback-note="none"')

  /*
   * The attribute sits in the opening tag and the sentence is that element's child,
   * so the element is read from the attribute to the next `</` - where its children
   * end. Asserting only that both strings appear somewhere in the file would pass on
   * an attribute on one span and the sentence inside a different one, which is the
   * arrangement that makes the marker a lie.
   */
  const markedEnd = PANEL_CODE.indexOf('</', markedAt)
  assert.notEqual(markedEnd, -1, 'the element that states the fallback position never closes')

  const markedElement = PANEL_CODE.slice(markedAt, markedEnd)
  assert.match(
    markedElement,
    /\{NO_FALLBACK_NOTE\}/,
    `the fallback marker is not on the element that draws the sentence: ${markedElement.trim()}`,
  )

  // The sentence says what it is for. A constant named for a fallback that held some
  // other reassurance would satisfy every check above and tell the person nothing.
  const declared = /export const NO_FALLBACK_NOTE\s*=\s*'([^']+)'/.exec(SCREEN_CODE)
  assert.notEqual(declared, null, 'chat-screen.ts no longer declares NO_FALLBACK_NOTE')
  const sentence = declared[1]
  assert.ok(sentence.length > 20, 'NO_FALLBACK_NOTE is too short to be the sentence this rule is about')
  assert.match(
    sentence,
    /no fallback is set up/i,
    `NO_FALLBACK_NOTE reads "${sentence}", which does not tell a person whether a fallback was used`,
  )

  // One copy, in the shared module: a second one here would drift the first time the
  // phase changed, and the screen would be the wrong one of the two.
  assert.equal(
    PANEL_CODE.includes(sentence),
    false,
    'ChatPanel.tsx repeats the NO_FALLBACK_NOTE sentence instead of drawing the shared one',
  )
})

/* ================================================================== *
 * One conversation, two shapes
 * ================================================================== */

test('the view draws the chat panel in both the full surface and the dock, compact in the dock', () => {
  /*
   * The dock is the same conversation in 360px rather than a smaller feature set, and
   * that promise is kept by rendering one component in two shapes. Two files, or a
   * second panel for the dock, is how a feature ends up existing in one surface only:
   * a thread picker, a cancel button or a draft card appears in the full window and
   * is missing from the panel beside the web app. The `compact` flag is what the
   * panel reads to turn its rails into toggles, so both the component and the flag
   * have to be present at both call sites.
   */
  const panelCalls = [...VIEW_CODE.matchAll(/<ChatPanel\b/g)]
  assert.ok(
    panelCalls.length >= 2,
    `CopilotView.tsx draws <ChatPanel> ${panelCalls.length} time(s); the dock and the full surface both need it`,
  )

  const fullAt = VIEW_CODE.indexOf('function FullSurface')
  const dockAt = VIEW_CODE.indexOf('function DockSurface')
  assert.notEqual(fullAt, -1, 'CopilotView.tsx no longer declares the full surface')
  assert.notEqual(dockAt, -1, 'CopilotView.tsx no longer declares the dock surface')
  assert.ok(fullAt < dockAt, 'the two surfaces are no longer declared in the order this test reads them')

  const fullCall = /<ChatPanel\b[^>]*compact=\{false\}[^>]*\/>/.exec(VIEW_CODE)
  assert.notEqual(fullCall, null, 'the full surface draws the chat panel without compact={false}')
  assert.ok(
    fullCall.index > fullAt && fullCall.index < dockAt,
    'compact={false} is not the call site inside the full surface',
  )

  // The dock's shorthand is the same prop set to true; `compact` alone is what makes
  // the rails into toggles at 360px.
  const dockCall = /<ChatPanel\b[^>]*[^=\w]compact\b[^>]*\/>/.exec(VIEW_CODE.slice(dockAt))
  assert.notEqual(dockCall, null, 'the dock no longer draws the chat panel in its compact shape')

  // And the panel is a screen with a compact shape to give, not a prop nobody reads.
  assert.match(PANEL_CODE, /readonly\s+compact:\s*boolean/, 'ChatPanelProps no longer declares compact')
})

/* ================================================================== *
 * Geometry belongs to the stylesheet
 * ================================================================== */

test('pill geometry comes from the stylesheet, not from utilities in the component', () => {
  /*
   * The token sheet pins control shapes with `!important`, so a `rounded-full` in the
   * component would lose to it and read as intent while doing nothing - the same trap
   * the Models screen documented. The shape is therefore stated once, in the one
   * sheet, scoped to this screen; that is also what lets the composer be a 28px box
   * and an icon-only button be a circle without three utility classes arguing.
   */
  const scoped = cssBlocks(CSS_CODE).filter(block => block.selector.includes(MARKER))

  assert.ok(scoped.length > 0, 'shell.css has no chat-screen rule, so nothing shapes this screen')

  const pills = scoped.filter(block => /border-radius:\s*999px/.test(block.body))
  assert.ok(
    pills.length > 0,
    'no chat-screen rule in shell.css draws a 999px pill, so the pill shape has no home',
  )

  // Every pill rule is scoped, in this file as well as in the group above: a shape
  // stated without the scope is the failure this test exists to catch.
  for (const rule of pills) {
    assert.equal(
      rule.selector.includes(MARKER),
      true,
      `a 999px pill is drawn without the chat-screen scope: ${rule.selector}`,
    )
  }

  // And the component does not restate the shape as a utility.
  assert.equal(
    PANEL_CODE.includes('rounded-full'),
    false,
    'ChatPanel.tsx sets rounded-full, so the shape is stated in two places and one of them loses',
  )
})

/* ================================================================== *
 * The preview asks about the request that will be sent
 * ================================================================== */

test('the preview names the model that would answer, and asks about the words that leave', () => {
  /*
   * A preview is a promise about a message the person has not sent yet. The panel is
   * only worth reading if the request behind it is the request that will go, so the
   * two values that change it have to be in the call.
   *
   * The model decides how much context fits: a preview without it is sized for the
   * provider's default window, and then lists a different conversation from the one
   * the send assembles. And the text has to be the trimmed body the send uses, or a
   * trailing newline is previewed as content that never travels.
   *
   * This is asserted from the source rather than from a rendered panel because the
   * screen has no DOM test harness here; the behaviour is proved end to end in
   * service.test.js, where the panel's list is compared with the request the provider
   * actually received.
   */
  const previewAt = PANEL_CODE.indexOf('bridge.payloadPreview(')
  assert.notEqual(previewAt, -1, 'ChatPanel.tsx no longer asks for a payload preview')

  const previewArgument = callText(
    PANEL_CODE,
    PANEL_CODE.indexOf('(', previewAt + 'bridge.payloadPreview'.length),
  )
  assert.notEqual(previewArgument, null, 'the preview call could not be read to its closing parenthesis')

  /*
   * The model travels with the request, and it travels the *same way* the send's does.
   * Comparing the two call bodies rather than a spelling means a change to one that
   * is not made to the other fails here, which is the property that matters: the
   * panel describes the request, so the two must name the model alike.
   */
  assert.match(
    previewArgument,
    /modelId/,
    'the preview does not name a model, so it is budgeted for a different one than the send',
  )

  const sendAt = PANEL_CODE.indexOf('bridge.sendMessage(')
  assert.notEqual(sendAt, -1, 'ChatPanel.tsx no longer sends a message')
  const sendArgument = callText(PANEL_CODE, PANEL_CODE.indexOf('(', sendAt + 'bridge.sendMessage'.length))
  assert.notEqual(sendArgument, null, 'the send call could not be read to its closing parenthesis')

  const modelExpression = (argument) => {
    const at = argument.indexOf('modelId')
    assert.notEqual(at, -1, 'a request names no model')
    // The line the model is named on, from the spread that carries it.
    const from = argument.lastIndexOf('\n', at)
    const to = argument.indexOf('\n', at)
    return argument.slice(from, to).trim()
  }

  assert.equal(
    modelExpression(previewArgument),
    modelExpression(sendArgument),
    'the preview and the send name the model differently, so they can be budgeted differently',
  )

  /*
   * And it is the requested text, not the composer's raw state: `text: body` is the
   * trimmed value the send uses, where a plain `text:` is whatever is in the box,
   * trailing space and all.
   */
  assert.match(previewArgument, /text\s*:\s*body\b/, 'the preview sends the composer rather than the trimmed body')
  assert.match(sendArgument, /text\s*:\s*body\b/, 'the send no longer sends the trimmed body')
  assert.match(
    PANEL_CODE,
    /const\s+body\s*=\s*text\.trim\(\)/,
    'the screen no longer computes the body both requests use',
  )

  /*
   * A dependency list without the model would leave a panel showing one budget's
   * messages after the person picked a model with another. Read from the effect that
   * made the call, so it cannot be satisfied by some other list in the file.
   */
  const bodyEnd = PANEL_CODE.indexOf('}, [', previewAt)
  assert.notEqual(bodyEnd, -1, 'the preview effect no longer has a dependency array')
  const depsClose = PANEL_CODE.indexOf('])', bodyEnd)
  assert.notEqual(depsClose, -1, 'the preview effect dependency list never closes')
  const deps = PANEL_CODE.slice(bodyEnd + '}, ['.length, depsClose)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  assert.ok(deps.includes('modelId'), `the preview effect ignores the selected model (${deps.join(', ')})`)
  assert.ok(deps.includes('text'), `the preview effect ignores the composer (${deps.join(', ')})`)
})
