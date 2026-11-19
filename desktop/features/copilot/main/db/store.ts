/*
 * The lifecycle of the local database, as one object.
 *
 * Three things have to be true at once, and they pull against each other, so they
 * are stated together here rather than left to whoever calls the repositories.
 *
 * One database per person per server. `scopeKey()` names it, and both the file and
 * the keychain entry are derived from a hash of that name, so a second account
 * signing in on the same machine opens a different file with a different key. It
 * cannot read the first account's rows even by accident, because it is not looking
 * at the same file.
 *
 * Sign-out closes, it does not delete. The plan is explicit that signing out
 * releases the key, and the credential store already behaves that way: the durable
 * key stays in the keychain so signing back in finds the conversations again. What
 * `close()` removes is the in-memory copy of the key and the open handle.
 *
 * Pending work cannot land after the account changed. Every async operation
 * captures a generation number when it starts and re-checks it when it finishes.
 * Without that, a slow provider call started by one person could finish after
 * somebody else signed in and write into their conversation - the same class of
 * bug the provider settings service was sent back for in Phase 2, so the guard
 * here is deliberate and not incidental.
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { openDatabase, type OpenDatabase, type StorageLogger } from './connection.js'
import { databaseKeyFromSecret, createKeyMaterial } from './cipher.js'
import type { SqlDriver } from './driver.js'
import type { Migration } from './migrations/index.js'
import { createRepositoryContext } from './repositories/context.js'
import { createBusinessRepository, type BusinessRepository } from './repositories/businesses.js'
import { createThreadRepository, type ThreadRepository } from './repositories/threads.js'
import { createMessageRepository, type MessageRepository } from './repositories/messages.js'
import { createSummaryRepository, type SummaryRepository } from './repositories/summaries.js'
import { createMemoryRepository, type MemoryRepository } from './repositories/memory.js'
import { createProposalRepository, type ProposalRepository } from './repositories/proposals.js'
import { createAuditRepository, type AuditRepository } from './repositories/audit.js'
import { createDocumentRepository, type DocumentRepository } from './repositories/documents.js'
import { createChunkRepository, type ChunkRepository } from './repositories/chunks.js'
import { createDocumentJobRepository, type DocumentJobRepository } from './repositories/document-jobs.js'
import { createDnaRepository, type DnaRepository } from './repositories/dna.js'
import { createDnaProposalRepository, type DnaProposalRepository } from './repositories/dna-proposals.js'
import {
  scopeKey,
  StorageError,
  storageScopeSchema,
  type BusinessRow,
  type StorageScope,
} from '../../shared/storage-contract.js'

/**
 * The slice of the keychain this module needs.
 *
 * Declared narrowly rather than importing the concrete `Keychain` so a test can
 * supply two entries and a fake, and so this module cannot reach for a key it was
 * not given.
 */
export interface DatabaseKeyStore {
  store (name: string, secret: string): { ok: boolean } | { ok: false; reason: string }
  read (name: string): { ok: true; secret: string } | { ok: false; reason: string }
  remove (name: string): { ok: boolean }
}

export interface StorageRepositories {
  businesses: BusinessRepository
  threads: ThreadRepository
  messages: MessageRepository
  summaries: SummaryRepository
  memory: MemoryRepository
  proposals: ProposalRepository
  audit: AuditRepository
  documents: DocumentRepository
  chunks: ChunkRepository
  jobs: DocumentJobRepository
  dna: DnaRepository
  dnaProposals: DnaProposalRepository
}

export interface BusinessStoreOptions {
  /** The folder the database files live in. One file per scope. */
  directory: string
  keychain: DatabaseKeyStore
  driver?: SqlDriver
  migrations?: readonly Migration[]
  /** `undefined` asks the installed package; `null` disables vectors (tests). */
  vectorExtensionPath?: string | null
  now?: () => string
  logger?: StorageLogger
  /**
   * Whether this scope may still work on a remote workspace.
   *
   * Supplied by the caller from the access store so a workspace whose grant was
   * withdrawn stops being reachable at the data layer too, not only in the screen
   * that happened to draw the row last.
   */
  isEligible?: (scope: StorageScope, remoteWorkspaceId: number) => boolean
}

export interface BusinessStore {
  /** Open (or reopen) the database for one signed-in person. */
  open: (scope: StorageScope) => void
  /** Close the handle and forget the key held in memory. */
  close: () => void
  isOpen: () => boolean
  /** The scope currently open, for diagnostics and for tests. */
  currentScope: () => StorageScope | null
  /** The repositories, or `closed` when nothing is open or the scope differs. */
  repositories: (scope: StorageScope) => StorageRepositories
  /**
   * Run one operation and refuse its result if the account changed underneath it.
   *
   * The generation check happens after the work, which is the only place it can
   * happen: the whole point is a call that was already in flight.
   *
   * `businessId` is the second half of the same guard, for the change a generation
   * cannot see: withdrawing one workspace's grant leaves the account signed in and
   * the generation untouched, so a reply for that workspace is re-checked here
   * before it is handed back.
   */
  runScoped: <T>(
    scope: StorageScope,
    work: (repos: StorageRepositories) => Promise<T> | T,
    options?: { businessId?: string },
  ) => Promise<T>
  /** A business row this scope may use, or `not_found`. */
  requireBusiness: (scope: StorageScope, businessId: string) => BusinessRow
  /** Diagnostics for the phase report: which file, and whether vectors loaded. */
  describe: () => { filePath: string | null; vector: { loaded: boolean; version: string | null } | null } | null
}

const KEY_NAME_PREFIX = 'dbkey.'

/** A short, filesystem-safe and keychain-safe name for one scope. */
function scopeDigest (scope: StorageScope): string {
  return createHash('sha256').update(scopeKey(scope)).digest('hex').slice(0, 32)
}

/** The keychain entry name for a scope. Hex only, so it passes the name rules. */
export function databaseKeyName (scope: StorageScope): string {
  const parsed = storageScopeSchema.safeParse(scope)
  if (!parsed.success) throw new StorageError('invalid_request')
  return KEY_NAME_PREFIX + scopeDigest(parsed.data)
}

/** The database file for a scope. */
export function databaseFilePath (directory: string, scope: StorageScope): string {
  const parsed = storageScopeSchema.safeParse(scope)
  if (!parsed.success) throw new StorageError('invalid_request')
  return path.join(directory, `business-${scopeDigest(parsed.data)}.db`)
}

export function createBusinessStore (options: BusinessStoreOptions): BusinessStore {
  const directory = options?.directory
  if (typeof directory !== 'string' || directory === '') throw new StorageError('invalid_request')
  const keychain = options.keychain
  if (keychain === undefined || typeof keychain?.read !== 'function') {
    throw new StorageError('invalid_request')
  }

  const now = options.now
  let open: OpenDatabase | null = null
  let openScope: StorageScope | null = null
  let repositories: StorageRepositories | null = null
  /**
   * Bumped on every open and every close. An async operation compares the value
   * it captured with this one before handing anything back.
   */
  let generation = 0

  /**
   * The key for one scope, created only when there is provably nothing to lose.
   *
   * `not_found` is the one reason that means "this account has never stored a key".
   * Every other reason - a keychain that is locked or unavailable, or a ciphertext
   * this machine can no longer decrypt - means a key exists and could not be read,
   * and minting a replacement there would overwrite the only key that opens
   * conversations already on this disk. The person would come back to an empty
   * assistant and no way to say what went wrong.
   *
   * The file check is the second half of the same rule. A database file with no key
   * behind it is data this build cannot read, and a fresh key would turn "I cannot
   * open this" into "there is nothing here", which is the worse of the two answers.
   */
  function resolveKey (scope: StorageScope): string {
    const name = databaseKeyName(scope)
    const existing = keychain.read(name)
    if (existing.ok) return existing.secret
    if (existing.reason !== 'not_found') throw new StorageError('bad_key')
    if (existsSync(databaseFilePath(directory, scope))) throw new StorageError('bad_key')
    // A first run for this account: make the key, and refuse to go on if the
    // keychain would not keep it. Continuing without a durable key would produce a
    // database nobody can reopen, which reads as data loss at the next launch.
    const created = createKeyMaterial()
    const stored = keychain.store(name, created)
    if (!('ok' in stored) || stored.ok !== true) throw new StorageError('bad_key')
    return created
  }

  function openFor (scope: StorageScope): void {
    const parsed = storageScopeSchema.safeParse(scope)
    if (!parsed.success) throw new StorageError('invalid_request')
    const next = parsed.data

    // Re-opening the same scope is a no-op, which keeps a token refresh or a
    // window redraw from churning the handle and the WAL.
    if (open !== null && openScope !== null && scopeKey(openScope) === scopeKey(next)) return

    close()

    const key = databaseKeyFromSecret(resolveKey(next))
    const opened = openDatabase({
      filePath: databaseFilePath(directory, next),
      key,
      ...(options.driver === undefined ? {} : { driver: options.driver }),
      ...(options.migrations === undefined ? {} : { migrations: options.migrations }),
      ...(options.vectorExtensionPath === undefined ? {} : { vectorExtensionPath: options.vectorExtensionPath }),
      ...(now === undefined ? {} : { now }),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    })

    const ctx = createRepositoryContext(opened.db, opened.cipher, now === undefined ? {} : { now })
    open = opened
    openScope = next
    repositories = {
      businesses: createBusinessRepository(ctx),
      threads: guardBusinessCalls(createThreadRepository(ctx)),
      messages: guardBusinessCalls(createMessageRepository(ctx)),
      summaries: guardBusinessCalls(createSummaryRepository(ctx)),
      memory: guardBusinessCalls(createMemoryRepository(ctx)),
      proposals: guardBusinessCalls(createProposalRepository(ctx)),
      audit: createAuditRepository(ctx),
      /*
       * The knowledge repositories take the same eligibility guard as the
       * conversation ones. A document library and a business's DNA are exactly as
       * private as its chats, and the withdrawn-workspace rule has to reach them by
       * the same route rather than by each caller remembering to ask.
       */
      documents: guardBusinessCalls(createDocumentRepository(ctx)),
      chunks: guardBusinessCalls(createChunkRepository(ctx)),
      jobs: guardBusinessCalls(createDocumentJobRepository(ctx)),
      dna: guardBusinessCalls(createDnaRepository(ctx)),
      dnaProposals: guardBusinessCalls(createDnaProposalRepository(ctx)),
    }
    generation += 1
  }

  function close (): void {
    // Bump first: anything in flight must already see the new generation when it
    // checks, and a close that ran after the check would be too late.
    generation += 1
    if (open !== null) {
      open.close()
      open = null
    }
    openScope = null
    repositories = null
  }

  /** The business id a call was made for, when its first argument names one. */
  function businessIdIn (scope: unknown): string | null {
    const candidate = scope as { businessId?: unknown } | null | undefined
    const id = candidate?.businessId
    return typeof id === 'string' && id !== '' ? id : null
  }

  /**
   * Refuse a call for a business this person may no longer work in.
   *
   * The answer is `not_found` rather than a new token, on purpose: from inside this
   * database a workspace whose grant was withdrawn has stopped existing, and that is
   * the same answer this layer already gives for any row the caller cannot see. A
   * distinct token would tell the caller the row is there but forbidden.
   *
   * An unknown business id is left alone. The repository answers `not_found` for it
   * anyway, and inventing an eligibility verdict for a row that is not here would
   * make this check the authority on something it cannot see.
   */
  function assertEligible (businessId: string): void {
    if (options.isEligible === undefined) return
    if (open === null || openScope === null) throw new StorageError('closed')
    const row = open.db
      .prepare('SELECT remote_workspace_id FROM business WHERE id = ? AND scope_id = ?')
      .get(businessId, scopeKey(openScope))
    if (row === undefined) return
    if (!options.isEligible(openScope, Number(row.remote_workspace_id))) {
      throw new StorageError('not_found')
    }
  }

  /**
   * Wrap one repository so every method that names a business is checked first.
   *
   * Done here, once, rather than in each repository file. The store is what knows
   * who is signed in and what they may reach; a repository is handed a scope and is
   * not trusted to remember a rule that lives outside it. A check each file must
   * call is a check that one file eventually will not, and the file it forgets is
   * the one that leaks.
   *
   * `audit` is deliberately not wrapped. It is the record of what happened, written
   * by the main process rather than chosen by the person, and a withdrawn grant must
   * not be able to stop the trail being written about it.
   */
  function guardBusinessCalls<T extends object> (repo: T): T {
    const guarded: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(repo)) {
      if (typeof value !== 'function') {
        guarded[name] = value
        continue
      }
      guarded[name] = (...args: unknown[]): unknown => {
        const businessId = businessIdIn(args[0])
        if (businessId !== null) assertEligible(businessId)
        return (value as (...inner: unknown[]) => unknown).apply(repo, args)
      }
    }
    return Object.freeze(guarded) as unknown as T
  }

  function repositoriesFor (scope: StorageScope): StorageRepositories {
    const parsed = storageScopeSchema.safeParse(scope)
    if (!parsed.success) throw new StorageError('invalid_request')
    if (repositories === null || openScope === null) throw new StorageError('closed')
    if (scopeKey(openScope) !== scopeKey(parsed.data)) {
      // Not "return an empty list": asking one account's handle for another
      // account's rows is a programming error, and answering it quietly is how a
      // leak becomes invisible.
      throw new StorageError('closed')
    }
    return repositories
  }

  async function runScoped<T> (
    scope: StorageScope,
    work: (repos: StorageRepositories) => Promise<T> | T,
    runOptions: { businessId?: string } = {},
  ): Promise<T> {
    const startedAt = generation
    const repos = repositoriesFor(scope)
    let value: T
    try {
      value = await work(repos)
    } catch (error) {
      /*
       * If the account changed while this was running, the reason it failed is
       * almost certainly that the handle it was using has gone. Reporting the
       * underlying error here would say "something went wrong reading the local
       * database", which sends a person looking for a corrupt file, when the truth
       * is that they signed out. The changed generation is the better answer, and
       * it is the one the caller can act on.
       */
      if (generation !== startedAt) throw new StorageError('closed')
      throw error
    }
    if (generation !== startedAt) throw new StorageError('closed')
    /*
     * The account can be the same and the answer still stale: a grant withdrawn
     * while this call was in flight leaves the generation untouched, so the check
     * above would let a reply for a workspace the person may no longer use through.
     * Asked again here, at the only moment that matters - after the work finished
     * and before it is handed back.
     */
    if (runOptions.businessId !== undefined) assertEligible(runOptions.businessId)
    return value
  }

  function requireBusiness (scope: StorageScope, businessId: string): BusinessRow {
    const repos = repositoriesFor(scope)
    const row = repos.businesses.get(scope, businessId)
    if (row.archivedAt !== null) throw new StorageError('not_found')
    if (options.isEligible !== undefined && !options.isEligible(scope, row.remoteWorkspaceId)) {
      // The grant was withdrawn while the app was open. The row still exists, but
      // it is not somewhere this person may start a conversation now.
      throw new StorageError('not_found')
    }
    return row
  }

  return {
    open: openFor,
    close,
    isOpen: () => open !== null,
    currentScope: () => (openScope === null ? null : { ...openScope }),
    repositories: repositoriesFor,
    runScoped,
    requireBusiness,
    describe: () => {
      if (open === null || openScope === null) return null
      return {
        filePath: databaseFilePath(directory, openScope),
        vector: { ...open.vector },
      }
    },
  }
}
