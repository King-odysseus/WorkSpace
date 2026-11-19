'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const { PROBE_CHANNEL } = require('../../shared/probe-contract.js')

const PRELOAD = path.join(__dirname, '..', '..', '..', '..', 'electron', 'preload', 'copilot.js')

/**
 * Load the real preload file with a stand-in for Electron.
 *
 * This is the closest a plain Node test can get to the sandboxed preload: the
 * file is executed exactly as written, `require` is the only thing replaced, and
 * it throws for anything except 'electron'. That is also how the test proves the
 * preload has no other dependency, which a sandboxed preload could not load.
 */
function loadPreload () {
  const source = fs.readFileSync(PRELOAD, 'utf8')
  const exposed = {}
  const invocations = []
  const required = []

  const fakeElectron = {
    contextBridge: {
      exposeInMainWorld: (key, api) => { exposed[key] = api },
    },
    ipcRenderer: {
      invoke: (channel, request) => {
        invocations.push({ channel, request })
        return Promise.resolve({ contractVersion: 1, action: request.action, status: 'ok' })
      },
      send: () => { throw new Error('the preload must not use send') },
      on: () => { throw new Error('the preload must not subscribe to channels') },
    },
  }

  const module = { exports: {} }
  const wrapper = vm.runInThisContext(
    `(function (require, module, exports) {\n${source}\n})`,
    { filename: PRELOAD },
  )
  wrapper(name => {
    required.push(name)
    if (name === 'electron') return fakeElectron
    throw new Error(`the preload must not require ${name}`)
  }, module, module.exports)

  return { exposed, invocations, required, module }
}

function bridge () {
  const { exposed, invocations } = loadPreload()
  return { api: exposed.copilot, invocations }
}

test('the preload exposes one bridge with three methods and no generic invoke', () => {
  const { exposed } = loadPreload()

  assert.deepEqual(Object.keys(exposed), ['copilot'])
  assert.deepEqual(Object.keys(exposed.copilot), ['probe', 'contractInfo'])
  assert.deepEqual(Object.keys(exposed.copilot.probe).sort(), ['read', 'write'])

  // The whole point of the bridge: no channel parameter, no event listener and
  // no ipcRenderer anywhere a page can reach.
  for (const forbidden of ['invoke', 'send', 'on', 'once', 'ipcRenderer', 'channel']) {
    assert.equal(exposed.copilot[forbidden], undefined, `copilot.${forbidden}`)
    assert.equal(exposed.copilot.probe[forbidden], undefined, `copilot.probe.${forbidden}`)
  }
})

test('the preload loads nothing except Electron', () => {
  const { required } = loadPreload()

  // A sandboxed preload cannot load a project file, so this is also a rule the
  // runtime would enforce; failing here catches it before the window is opened.
  assert.deepEqual(required, ['electron'])
})

test('read sends the contract channel and a read request', async () => {
  const { api, invocations } = bridge()

  await api.probe.read()

  assert.equal(invocations.length, 1)
  assert.equal(invocations[0].channel, PROBE_CHANNEL)
  assert.deepEqual(invocations[0].request, { action: 'read', confirmWrite: false })
})

test('write sends the confirmation the contract requires', async () => {
  const { api, invocations } = bridge()

  await api.probe.write()

  assert.equal(invocations[0].channel, PROBE_CHANNEL)
  assert.deepEqual(invocations[0].request, { action: 'write', confirmWrite: true })
})

test('arguments handed to the bridge cannot change what is sent', async () => {
  const { api, invocations } = bridge()

  // A page that tries to turn read into something else gets a read.
  await api.probe.read({ action: 'write', confirmWrite: true, url: 'https://evil.example' })
  await api.probe.write({ action: 'read', confirmWrite: false })

  assert.deepEqual(invocations[0].request, { action: 'read', confirmWrite: false })
  assert.deepEqual(invocations[1].request, { action: 'write', confirmWrite: true })
  assert.equal(api.probe.read.length, 0)
  assert.equal(api.probe.write.length, 0)
})

test('the channel literal in the preload is the one in the contract', () => {
  const source = fs.readFileSync(PRELOAD, 'utf8')

  // The literal has to be repeated because a sandboxed preload cannot import the
  // contract. This is the check that stops the two drifting apart.
  assert.ok(source.includes(`'${PROBE_CHANNEL}'`), 'the preload does not name the contract channel')
  assert.equal(source.includes('ipcRenderer.invoke('), true)
  // One call site, fed by the two fixed methods, and nothing else.
  assert.equal((source.match(/ipcRenderer\.invoke\(/g) || []).length, 1)
})
