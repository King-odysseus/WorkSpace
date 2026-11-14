/*
 * Behaviour of the section 5 proof helpers.
 *
 * These cover the decisions the proof depends on: what counts as a changed
 * asset list, what counts as Copilot content in the output, whether the Vite
 * config still takes the default single entry, and which untracked paths were
 * already recorded at phase start. The script's own git and npm calls are not
 * mocked here; the real proof is the script run recorded in the phase report.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  MOCKUP_MARKER,
  PINNED_UNTRACKED,
  PINNED_UNTRACKED_FINGERPRINT,
  baselineLines,
  compareAssetLists,
  comparePinnedFingerprint,
  extractClassTokens,
  extractSourceTokens,
  failingChecks,
  findCopilotMatches,
  findMockupClassesInCss,
  fingerprintFiles,
  inspectIndexHtmlInputs,
  inspectViteConfigInput,
  isKnownUntracked,
  mayRecordBaseline,
  mockupCssOutcome,
  parseBaselineContext,
  pinnedOutcome,
  serialiseBaseline,
} from './verify-web-unchanged.mjs'

describe('compareAssetLists', () => {
  it('matches when the same names come back in any order', () => {
    const result = compareAssetLists('index-a1.js\nTaskViews-b2.js\n', ['TaskViews-b2.js', 'index-a1.js'])

    assert.equal(result.matches, true)
    assert.deepEqual(result.missing, [])
    assert.deepEqual(result.added, [])
  })

  it('names an asset the build no longer emits', () => {
    const result = compareAssetLists('index-a1.js\nTaskViews-b2.js\n', ['index-a1.js'])

    assert.equal(result.matches, false)
    assert.deepEqual(result.missing, ['TaskViews-b2.js'])
  })

  it('names a new asset, which is what a src change looks like', () => {
    const result = compareAssetLists('index-a1.js\n', ['index-a1.js', 'copilot-c3.js'])

    assert.equal(result.matches, false)
    assert.deepEqual(result.added, ['copilot-c3.js'])
  })

  it('treats a renamed hash as one missing and one added name', () => {
    const result = compareAssetLists('index-a1.js\n', ['index-a2.js'])

    assert.equal(result.matches, false)
    assert.deepEqual(result.missing, ['index-a1.js'])
    assert.deepEqual(result.added, ['index-a2.js'])
  })

  it('ignores blank lines and Windows line endings in the baseline file', () => {
    const result = compareAssetLists('index-a1.js\r\n\r\nTaskViews-b2.js\r\n', ['index-a1.js', 'TaskViews-b2.js'])

    assert.equal(result.matches, true)
    assert.equal(result.expected.length, 2)
  })

  it('fails when the baseline is empty, rather than passing by accident', () => {
    const result = compareAssetLists('', ['index-a1.js'])

    assert.equal(result.matches, false)
    assert.deepEqual(result.added, ['index-a1.js'])
  })
})

describe('findCopilotMatches', () => {
  it('reports a file whose name mentions Copilot', () => {
    const hits = findCopilotMatches([{ file: 'assets/CopilotPanel-a1.js', content: 'export default 1' }])

    assert.deepEqual(hits, [{ file: 'assets/CopilotPanel-a1.js', kind: 'filename' }])
  })

  it('reports a file whose text mentions Copilot under a hashed name', () => {
    const hits = findCopilotMatches([
      { file: 'assets/index-a1.js', content: 'const a=1;\nconst title="ZuriCopilot";\n' },
    ])

    assert.equal(hits.length, 1)
    assert.equal(hits[0].kind, 'content')
    assert.equal(hits[0].line, 'const title="ZuriCopilot";')
  })

  it('checks the name of a binary file it cannot read as text', () => {
    const hits = findCopilotMatches([{ file: 'assets/icon-copilot.png', content: null }])

    assert.equal(hits.length, 1)
    assert.equal(hits[0].kind, 'filename')
  })

  it('finds nothing in ordinary output', () => {
    const hits = findCopilotMatches([
      { file: 'index.html', content: '<script type="module" src="/assets/index-a1.js"></script>' },
      { file: 'assets/index-a1.js', content: 'const tasks=[1,2,3]' },
    ])

    assert.deepEqual(hits, [])
  })

  it('returns an empty list for missing input', () => {
    assert.deepEqual(findCopilotMatches(), [])
    assert.deepEqual(findCopilotMatches([]), [])
  })
})

describe('inspectViteConfigInput', () => {
  it('accepts a config that leaves the build entry alone', () => {
    const result = inspectViteConfigInput(
      'export default defineConfig({\n  plugins: [react()],\n  server: { proxy: {} },\n})\n',
    )

    assert.equal(result.defaultSingleEntry, true)
  })

  it('accepts a `test.include` block without mistaking it for a build input', () => {
    const result = inspectViteConfigInput(
      "export default defineConfig({\n  test: {\n    include: ['src/**/*.test.{js,jsx}'],\n  },\n})\n",
    )

    assert.equal(result.defaultSingleEntry, true)
  })

  it('rejects a rollupOptions input, which is how a mockup page would enter the build', () => {
    const result = inspectViteConfigInput(
      "export default defineConfig({\n  build: {\n    rollupOptions: {\n      input: { main: 'index.html', mockup: 'copilot-mockup.html' },\n    },\n  },\n})\n",
    )

    assert.equal(result.defaultSingleEntry, false)
    assert.equal(result.hasRollupOptions, true)
  })

  it('rejects a bare input override too', () => {
    const result = inspectViteConfigInput("export default defineConfig({ build: { input: 'copilot-mockup.html' } })\n")

    assert.equal(result.defaultSingleEntry, false)
    assert.equal(result.hasInputOverride, true)
  })

  it('treats a missing config as no override, so the caller decides', () => {
    assert.equal(inspectViteConfigInput('').defaultSingleEntry, true)
  })
})

describe('inspectIndexHtmlInputs', () => {
  it('separates the module entry from the inline bootstrap script', () => {
    const result = inspectIndexHtmlInputs(
      '<script>window.theme = "dark"</script>\n<script type="module" src="/src/main.jsx"></script>',
    )

    assert.deepEqual(result.moduleScripts, [{ src: '/src/main.jsx', type: 'module' }])
  })

  it('reports a page that also loads a mockup entry', () => {
    const result = inspectIndexHtmlInputs(
      '<script type="module" src="/src/main.jsx"></script>\n' +
      '<script type="module" src="/src/mockups/copilot/main.jsx"></script>',
    )

    assert.equal(result.moduleScripts.length, 2)
    assert.equal(result.moduleScripts[1].src, '/src/mockups/copilot/main.jsx')
  })

  it('returns no module scripts for a page without one', () => {
    assert.deepEqual(inspectIndexHtmlInputs('<script src="/legacy.js"></script>').moduleScripts, [])
    assert.deepEqual(inspectIndexHtmlInputs('').scripts, [])
  })
})

describe('isKnownUntracked: exact pinned paths', () => {
  it('accepts each file pinned at phase start', () => {
    for (const file of PINNED_UNTRACKED) {
      assert.equal(isKnownUntracked(file), true, `${file} is pinned and must stay accepted`)
    }
  })

  it('accepts Windows separators, which is what git prints here', () => {
    assert.equal(isKnownUntracked('src\\mockups\\copilot\\main.jsx'), true)
  })

  it('rejects a new file dropped into the mockup folder', () => {
    // The regression this pins down: a folder entry would accept this file, and
    // Tailwind would scan it into the production stylesheet.
    assert.equal(isKnownUntracked('src/mockups/copilot/BrandNew.jsx'), false)
  })

  it('rejects the folder itself, which is not a pinned file', () => {
    assert.equal(isKnownUntracked('src/mockups/copilot'), false)
    assert.equal(isKnownUntracked('src/mockups/copilot/'), false)
  })

  it('rejects a new untracked file anywhere else under a protected path', () => {
    assert.equal(isKnownUntracked('src/components/CopilotPanel.jsx'), false)
    assert.equal(isKnownUntracked('tasks/copilot_views.py'), false)
    assert.equal(isKnownUntracked('src/mockups/copilot-extra/main.jsx'), false)
  })
})

describe('PINNED_UNTRACKED', () => {
  it('pins the seven files recorded at phase start, by exact path', () => {
    assert.equal(PINNED_UNTRACKED.length, 7)
    for (const file of PINNED_UNTRACKED) {
      assert.equal(file.startsWith('src/mockups/copilot/'), true)
      assert.equal(file.endsWith('/'), false, 'a trailing slash would make it a folder rule')
      assert.match(file, /\.jsx$/)
    }
    assert.deepEqual([...PINNED_UNTRACKED].sort(), PINNED_UNTRACKED, 'the pin is kept sorted')
    assert.equal(new Set(PINNED_UNTRACKED).size, PINNED_UNTRACKED.length, 'no duplicate entries')
  })

  it('records a 16-character fingerprint of those files', () => {
    assert.match(PINNED_UNTRACKED_FINGERPRINT, /^[0-9a-f]{16}$/)
  })
})

describe('comparePinnedFingerprint', () => {
  const files = [{ name: 'a.jsx', content: 'one' }, { name: 'b.jsx', content: 'two' }]
  const pinned = { fingerprint: fingerprintFiles(files), files: ['a.jsx', 'b.jsx'] }

  it('matches when the files reproduce the recorded fingerprint', () => {
    const result = comparePinnedFingerprint(files, pinned)

    assert.equal(result.matches, true)
    assert.deepEqual(result.missing, [])
  })

  it('reports a pinned file whose content changed', () => {
    const changed = [{ name: 'a.jsx', content: 'one ' }, { name: 'b.jsx', content: 'two' }]

    assert.equal(comparePinnedFingerprint(changed, pinned).matches, false)
  })

  it('names a pinned file that is not on disk', () => {
    const result = comparePinnedFingerprint([{ name: 'a.jsx', content: 'one' }], pinned)

    assert.equal(result.matches, false)
    assert.deepEqual(result.missing, ['b.jsx'])
  })

  it('compares against the recorded pin by default', () => {
    const result = comparePinnedFingerprint(files)

    assert.equal(result.pinned, PINNED_UNTRACKED_FINGERPRINT)
    assert.equal(result.matches, false, 'made-up files must not match the recorded pin')
  })

  it('treats missing input as no files rather than crashing', () => {
    const result = comparePinnedFingerprint(null, { fingerprint: 'x', files: [] })

    assert.equal(result.matches, false)
    assert.deepEqual(result.missing, [])
  })
})

describe('mockupCssOutcome: m5 fails by default', () => {
  it('fails when a mockup-only class reaches the stylesheet', () => {
    assert.equal(mockupCssOutcome(121), 'fail')
    assert.equal(mockupCssOutcome(121, {}), 'fail')
    assert.equal(mockupCssOutcome(121, { strict: true }), 'fail')
  })

  it('only warns when the coupling is allowed on the command line', () => {
    assert.equal(mockupCssOutcome(121, { allowMockupCss: true }), 'warn')
  })

  it('passes when the stylesheet is clean, with or without the flag', () => {
    assert.equal(mockupCssOutcome(0), 'pass')
    assert.equal(mockupCssOutcome(0, { allowMockupCss: true }), 'pass')
  })
})

describe('pinnedOutcome: p6 fails by default', () => {
  it('passes only when the files reproduce the pin', () => {
    assert.equal(pinnedOutcome(true), 'pass')
  })

  it('fails on drift, and no option downgrades it to a warning', () => {
    assert.equal(pinnedOutcome(false), 'fail')
    assert.equal(pinnedOutcome(false, {}), 'fail')
    assert.equal(pinnedOutcome(false, { strict: true }), 'fail')
    assert.equal(pinnedOutcome(false, { allowMockupCss: true }), 'fail')
  })

  it('fails rather than passing when the comparison returned nothing', () => {
    assert.equal(pinnedOutcome(undefined), 'fail')
    assert.equal(pinnedOutcome(null), 'fail')
  })
})

describe('fingerprint drift blocks a passing run and a baseline write', () => {
  const recorded = [{ name: 'a.jsx', content: 'one' }, { name: 'b.jsx', content: 'two' }]
  const pin = { fingerprint: fingerprintFiles(recorded), files: ['a.jsx', 'b.jsx'] }

  /*
   * The same composition main() uses: compare the pin, report p6, collect the
   * failures, then gate the baseline write on that list. Built here so the
   * decision can be proven without running git, npm or a build.
   */
  function runAgainst (files) {
    const pinned = comparePinnedFingerprint(files, pin)
    const checks = [
      { id: 'p4', pass: true, warning: false },
      { id: 'p6', pass: pinnedOutcome(pinned.matches) === 'pass', warning: false },
    ]
    const failures = failingChecks(checks)
    return { failures, mayWrite: mayRecordBaseline(failures) }
  }

  it('fails the run and refuses the baseline after a pinned file is edited', () => {
    const result = runAgainst([{ name: 'a.jsx', content: 'one edited' }, { name: 'b.jsx', content: 'two' }])

    assert.deepEqual(result.failures.map(check => check.id), ['p6'])
    assert.equal(result.mayWrite, false, 'a changed pin must not be blessed into a new baseline')
  })

  it('fails the run and refuses the baseline after a pinned file is deleted', () => {
    const result = runAgainst([{ name: 'a.jsx', content: 'one' }])

    assert.deepEqual(result.failures.map(check => check.id), ['p6'])
    assert.equal(result.mayWrite, false, 'a missing pin file must not be blessed into a new baseline')
  })

  it('still passes and allows the write while the pin holds', () => {
    const result = runAgainst(recorded)

    assert.deepEqual(result.failures, [])
    assert.equal(result.mayWrite, true, 'an unchanged pin must not block a legitimate baseline')
  })
})

describe('failingChecks', () => {
  const checks = [
    { id: 'p1', pass: true, warning: false },
    { id: 'b2', pass: false, warning: false },
    { id: 'm5', pass: false, warning: true },
  ]

  it('counts a hard failure and ignores a warning', () => {
    assert.deepEqual(failingChecks(checks).map(check => check.id), ['b2'])
  })

  it('counts warnings too under --strict', () => {
    assert.deepEqual(failingChecks(checks, { strict: true }).map(check => check.id), ['b2', 'm5'])
  })
})

describe('mayRecordBaseline', () => {
  it('allows a write only when nothing failed', () => {
    assert.equal(mayRecordBaseline([]), true)
    assert.equal(mayRecordBaseline(undefined), true)
  })

  it('refuses a write after a failure, so a rejected tree is never blessed', () => {
    assert.equal(mayRecordBaseline([{ id: 'm5' }]), false)
  })
})

describe('the mockup marker', () => {
  it('is specific enough to identify the mockup and nothing else', () => {
    assert.match(MOCKUP_MARKER, /ZuriCopilot/)
    assert.ok(MOCKUP_MARKER.length > 20, 'a short marker would match unrelated copy')
  })
})

describe('baseline file with a context header', () => {
  const header = [
    '# ZuriCopilot section 5 asset baseline',
    '# recorded: 2026-11-14T19:00:00.000Z',
    '# commit: abc1234def',
    '# mockups: 0123456789abcdef',
  ].join('\n')

  it('keeps the comment lines out of the asset comparison', () => {
    const text = `${header}\nindex-a1.js\nTaskViews-b2.js\n`

    assert.deepEqual(baselineLines(text), ['index-a1.js', 'TaskViews-b2.js'])
    assert.equal(compareAssetLists(text, ['index-a1.js', 'TaskViews-b2.js']).matches, true)
  })

  it('reads the commit and mockup fingerprint back', () => {
    const context = parseBaselineContext(header)

    assert.equal(context.commit, 'abc1234def')
    assert.equal(context.mockups, '0123456789abcdef')
    assert.equal(context.recorded, '2026-11-14T19:00:00.000Z')
  })

  it('returns an empty context for a baseline written without one', () => {
    assert.deepEqual(parseBaselineContext('index-a1.js\n'), {})
  })

  it('writes a file that reads back as the same asset set', () => {
    const text = serialiseBaseline(['TaskViews-b2.js', 'index-a1.js'], {
      recorded: '2026-11-14T19:00:00.000Z',
      commit: 'abc1234def',
      mockups: '0123456789abcdef',
    })

    assert.match(text, /^# ZuriCopilot section 5 asset baseline/)
    assert.match(text, /# commit: abc1234def/)
    assert.deepEqual(baselineLines(text), ['TaskViews-b2.js', 'index-a1.js'])
    assert.equal(compareAssetLists(text, ['index-a1.js', 'TaskViews-b2.js']).matches, true)
  })
})

describe('extractClassTokens', () => {
  it('reads a plain className attribute', () => {
    const tokens = extractClassTokens('<div className="mx-auto w-full max-w-[1240px]">')

    assert.deepEqual([...tokens].sort(), ['max-w-[1240px]', 'mx-auto', 'w-full'])
  })

  it('reads a conditional className with a template literal', () => {
    const tokens = extractClassTokens('<div className={`card ${active ? \'card-active\' : \'card-idle\'}`}>')

    assert.equal(tokens.has('card'), true)
    assert.equal(tokens.has('card-active'), true)
  })

  it('ignores source with no className at all', () => {
    assert.equal(extractClassTokens('export const value = 1\n').size, 0)
    assert.equal(extractClassTokens('').size, 0)
  })
})

describe('extractSourceTokens', () => {
  it('finds a class the app composes through a helper, which a className scan would miss', () => {
    const tokens = extractSourceTokens("cn('bg-bronze px-6', active && 'ring-2')")

    assert.equal(tokens.has('bg-bronze'), true)
    assert.equal(tokens.has('px-6'), true)
    assert.equal(tokens.has('ring-2'), true)
  })

  it('finds a class built from a template literal', () => {
    const tokens = extractSourceTokens('const c = `${base} text-sm`')

    assert.equal(tokens.has('text-sm'), true)
  })

  it('keeps the brackets of an arbitrary-value class', () => {
    const tokens = extractSourceTokens('className="mx-auto max-w-[1240px]"')

    assert.equal(tokens.has('max-w-[1240px]'), true)
  })

  it('counts a class named in a comment, because the class still ships', () => {
    const tokens = extractSourceTokens('// keeps bg-bronze here for the dock')

    assert.equal(tokens.has('bg-bronze'), true)
  })

  it('returns nothing for an empty source', () => {
    assert.equal(extractSourceTokens('').size, 0)
    assert.equal(extractSourceTokens('   ').size, 0)
  })
})

describe('findMockupClassesInCss', () => {
  const appTokens = new Set(['mx-auto', 'grid', 'text-sm'])

  it('finds a mockup-only utility through Tailwind escaping', () => {
    const hits = findMockupClassesInCss(
      '.mx-auto{margin-inline:auto}.max-w-\\[1240px\\]{max-width:1240px}',
      appTokens,
      new Set(['mx-auto', 'max-w-[1240px]']),
    )

    assert.deepEqual(hits, ['max-w-[1240px]'])
  })

  it('ignores a token the app itself uses, because it would ship anyway', () => {
    const hits = findMockupClassesInCss('.mx-auto{margin-inline:auto}', appTokens, new Set(['mx-auto']))

    assert.deepEqual(hits, [])
  })

  it('ignores a short or meaningless token that would match by accident', () => {
    const hits = findMockupClassesInCss('.grid{display:grid}.a{color:red}', appTokens, new Set(['grid', 'a']))

    assert.deepEqual(hits, [])
  })

  it('returns nothing when no mockup class reaches the stylesheet', () => {
    const hits = findMockupClassesInCss('.grid{display:grid}', appTokens, new Set(['max-w-[1240px]']))

    assert.deepEqual(hits, [])
  })
})

describe('fingerprintFiles', () => {
  it('is order independent, so a stable folder gives a stable fingerprint', () => {
    const a = fingerprintFiles([{ name: 'a.jsx', content: 'one' }, { name: 'b.jsx', content: 'two' }])
    const b = fingerprintFiles([{ name: 'b.jsx', content: 'two' }, { name: 'a.jsx', content: 'one' }])

    assert.equal(a, b)
  })

  it('changes when a mockup file changes, which is what a drift hint needs', () => {
    const before = fingerprintFiles([{ name: 'a.jsx', content: 'one' }])
    const after = fingerprintFiles([{ name: 'a.jsx', content: 'one ' }])

    assert.notEqual(before, after)
  })

  it('separates a file rename from a content change', () => {
    const before = fingerprintFiles([{ name: 'a.jsx', content: 'one' }])
    const after = fingerprintFiles([{ name: 'b.jsx', content: 'one' }])

    assert.notEqual(before, after)
  })
})
