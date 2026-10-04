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

const stopAll = () => {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    try {
      if (process.platform === 'win32') {
        // A dev server can fork or hold a worker; /T takes the tree.
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

const cleanup = async () => {
  stopAll()
  // Give the signed-off children a moment to let go of the database. Without
  // this the delete is refused and a 1.3 MB file is left in the repository.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    removeDatabase()
    if (!existsSync(databaseFile)) return
  }
  // Still there, and still gitignored. Not worth failing a run over.
}

const main = async () => {
  cleanup()

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
