// Run the browser journeys against a throwaway copy of the app.
//
// The journeys exist because some defects only appear in a browser: the capture
// row that promised an owner a task they would own, and every layout rule a
// component test renders around rather than through. This script owns the
// fixture and the servers, so a journey file only has to describe a person's
// path through the app.
//
// What it does, in order: point Django at its own SQLite file so nothing can
// reach the development database, migrate it, seed a known workspace, start
// Django and the built app, run the journeys with node's test runner, then take
// all of it down again. The fixture password is generated per run and never
// written down.
//
//   npm run test:browser            build first, then run
//   JOURNEY_SKIP_BUILD=1 npm run ...   reuse the existing dist/

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const databaseFile = path.join(root, '.tmp-browser-journey.sqlite3')
const journeyDir = path.join(root, 'scripts', 'journeys')

const apiPort = Number(process.env.JOURNEY_API_PORT || 8021)
const appPort = Number(process.env.JOURNEY_APP_PORT || 5183)
const appUrl = `http://localhost:${appPort}`
const password = randomUUID()
const email = 'browser-owner@example.invalid'

const python = process.platform === 'win32' ? 'python' : 'python3'
const children = []

const env = {
  ...process.env,
  WORKSPACE_DB_ENGINE: 'django.db.backends.sqlite3',
  WORKSPACE_DB_NAME: databaseFile,
  // The app's writes are refused unless its origin is trusted, and the journeys
  // create tasks. Set here rather than relying on whatever .env happens to hold.
  WORKSPACE_CSRF_TRUSTED_ORIGINS: `${appUrl},http://127.0.0.1:${appPort}`,
  WORKSPACE_API_TARGET: `http://127.0.0.1:${apiPort}`,
}

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', ...options })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))))
  })

// Started without a shell, so the pid is the server itself rather than the
// wrapper around it. A shell in between means kill() reaches the shell and
// leaves Django holding the database file.
const start = (command, args) => {
  const child = spawn(command, args, { cwd: root, env, stdio: 'ignore' })
  children.push(child)
  return child
}

// Servers come up out of band, so wait for the thing being served rather than
// for the process.
const waitFor = async (url, { timeoutMs = 60000, label = url } = {}) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const response = await fetch(url)
      if (response.status < 500) return
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) throw new Error(`${label} did not answer within ${timeoutMs}ms`)
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
}

// Windows needs the tree killed; a plain kill leaves the servers holding their
// ports. The cost is real and worth knowing about: force-killing a tree leaves
// job-object state that makes the *next* process spawn fail outright with
// "AssignProcessToJobObject: (87) The parameter is incorrect". A run
// immediately after one of these teardowns can therefore die before the tests
// start, and leaves its own servers behind; running it again works. This is a
// Windows and Node interaction rather than anything about the app, and it is
// recorded here because the symptom - an unrelated-sounding spawn error - gives
// no hint of it.
const stopAll = () => {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        child.kill()
      }
    } catch {
      // Already gone.
    }
  }
}

const removeDatabase = () => {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const file = `${databaseFile}${suffix}`
    if (!existsSync(file)) continue
    try {
      rmSync(file, { force: true })
    } catch {
      // Django can hold the file for a moment after being signalled, and on
      // Windows that is enough to refuse the delete. The caller retries.
    }
  }
}

const isAnswering = async (url) => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) })
    return true
  } catch {
    return false
  }
}

// Nothing may be listening before a run starts. Without this check a leftover
// server from a crashed run answers on the port the new one could not bind, and
// the journeys quietly pass against the old one and its old database - which is
// worse than failing.
const refuseOccupiedPorts = async () => {
  const occupied = []
  if (await isAnswering(`http://127.0.0.1:${apiPort}/api/auth/me/`)) occupied.push(apiPort)
  if (await isAnswering(appUrl)) occupied.push(appPort)
  if (occupied.length) {
    throw new Error(
      `port(s) ${occupied.join(' and ')} are already answering. A previous run left a server ` +
        'behind; stop it before running the journeys, or the results will describe it rather than this run.',
    )
  }
}

const cleanup = async () => {
  stopAll()
  // Wait for the servers to actually stop, checking the thing that matters -
  // that they no longer answer - rather than trusting a signal to have landed.
  // Only then can the database file be deleted.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    removeDatabase()
    const apiGone = !(await isAnswering(`http://127.0.0.1:${apiPort}/api/auth/me/`))
    const appGone = !(await isAnswering(appUrl))
    if (apiGone && appGone && !existsSync(databaseFile)) return
  }
  // Still there, and still gitignored. Not worth failing a run over.
}

const main = async () => {
  await refuseOccupiedPorts()
  // A crashed run can leave the file behind; this one wants its own.
  removeDatabase()

  console.log('browser journeys: preparing a throwaway database')
  await run(python, ['manage.py', 'migrate', '--no-input', '--verbosity', '0'])
  await run(python, ['manage.py', 'seed_browser_fixtures', '--password', password])

  console.log(`browser journeys: starting Django on ${apiPort}`)
  start(python, ['manage.py', 'runserver', String(apiPort), '--noreload'])
  await waitFor(`http://127.0.0.1:${apiPort}/api/auth/me/`, { label: 'the API' })

  if (process.env.JOURNEY_SKIP_BUILD !== '1') {
    console.log('browser journeys: building the app')
    await run('npm', ['run', 'build'], { stdio: 'ignore', shell: process.platform === 'win32' })
  }

  console.log(`browser journeys: serving the built app on ${appUrl}`)
  start(process.execPath, [
    path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
    'preview',
    '--port',
    String(appPort),
    '--strictPort',
  ])
  await waitFor(appUrl, { label: 'the app' })

  const journeyFiles = readdirSync(journeyDir)
    .filter((name) => name.endsWith('.test.mjs'))
    .map((name) => path.join(journeyDir, name))

  if (!journeyFiles.length) throw new Error(`No journeys found in ${journeyDir}`)

  console.log(`browser journeys: running ${journeyFiles.length} file(s)`)
  await run(process.execPath, ['--test', ...journeyFiles], {
    env: { ...env, JOURNEY_APP_URL: appUrl, JOURNEY_EMAIL: email, JOURNEY_PASSWORD: password },
  })
}

// Node can die outright on Windows while spawning - "AssignProcessToJobObject:
// (87) The parameter is incorrect" - which is rare, seems to follow another
// process tree being force-killed, and takes the teardown with it. This is the
// belt for that: whatever ends the process, the servers are asked to stop.
// It cannot delete the database on that path, so a crashed run may leave the
// file behind for the next one to clear.
process.on('exit', stopAll)
process.on('SIGINT', () => {
  stopAll()
  process.exit(130)
})

main()
  .then(async () => {
    await cleanup()
    console.log('browser journeys: done')
  })
  .catch(async (error) => {
    await cleanup()
    console.error(`browser journeys failed: ${error.message}`)
    process.exitCode = 1
  })
