/*
 * One contract suite, run against every adapter (section 20 of the plan).
 *
 * The plan says every `AIProvider` passes "one shared contract test suite". This
 * is that suite, written as data rather than as tests: `providerContractCases`
 * returns named cases, each of which either resolves or throws with a plain
 * sentence saying what the adapter did wrong. An adapter's own test file
 * registers them, which keeps this module free of any test-runner import - it is
 * bundled into the main process, and a bundle that requires `node:test` at
 * startup would be loading a test framework to run the app.
 *
 * Why the cases are data and not a `describe`: the harness then has a test of
 * its own. A subject that is deliberately broken must make specific cases fail,
 * so the suite cannot quietly stop checking anything - which is the usual way a
 * contract suite rots into a green badge over an adapter that does nothing.
 *
 * What a subject has to provide, and why:
 *
 * - `create(fetchImpl)`. The harness supplies the network, so the adapter is
 *   exercised through its real translation code with no socket in sight. The
 *   `fetchImpl` is shaped like `fetch` because that is what a guarded transport
 *   will hand the adapter later; swapping in the real guard must not change the
 *   adapter.
 * - `fixtures`. Provider-shaped bodies for a successful call of each kind. The
 *   harness cannot invent these, because only the adapter knows its own wire
 *   format, and a neutral fixture would test the fixture instead of the adapter.
 * - `capabilities`. What the adapter claims. The suite checks the claims rather
 *   than assuming them: a model that says it streams must stream, and one that
 *   says it cannot must refuse in a way a caller can act on.
 *
 * The harness owns the failure canary, not the subject. A fixture that carries
 * a secret has to be proven not to leak, and letting the adapter's fixture
 * supply the canary would let a leaked canary be "expected" by accident.
 */

import {
  chatDeltaSchema,
  chatResultSchema,
  createCallContext,
  embedResultSchema,
  modelInfoSchema,
  testResultSchema,
  type AIProvider,
  type CallContext,
  type ChatDelta,
  type ChatRequest,
  type EmbedRequest,
  type ProviderCapabilities,
} from './types.js'

import { ProviderError, type ProviderFailure } from './errors.js'

/**
 * The string that must never appear in a failure the app produces.
 *
 * It is injected into provider bodies and into transport error text, so any
 * place that forwards the original text fails the suite.
 */
export const CONTRACT_CANARY = 'canary-7f31d0'

/**
 * How the app must not describe the canary. Lower case, because a leak is a
 * leak whatever its casing.
 */
const LEAK_MARKERS = ['canary', 'http://', 'https://', 'sk-', 'provider.example'] as const

/** What a response looks like: just enough of `fetch` for an adapter to read it. */
export interface ContractResponse {
  readonly status: number
  readonly ok: boolean
  text(): Promise<string>
  json(): Promise<unknown>
  /** For adapters that read a streamed body rather than a whole string. */
  readonly body: AsyncIterable<Uint8Array> | null
}

/** The network as an adapter sees it inside the suite. */
export type ContractFetch = (
  url: string,
  init?: { signal?: AbortSignal; method?: string; headers?: Record<string, string>; body?: unknown },
) => Promise<ContractResponse>

/** Provider-shaped bodies for a successful call of each kind. */
export interface ProviderContractFixtures {
  /** What a model-list call returns. Required: every adapter can list models. */
  readonly models: unknown
  /** What a chat call returns. Required: chat is the point of an adapter. */
  readonly chat: unknown
  /** What a streamed call returns, when the adapter says it can stream. */
  readonly stream?: unknown
  /** What an embedding call returns, when the adapter says it can embed. */
  readonly embed?: unknown
}

export interface ProviderContractSubject {
  /** Used in case labels, so a failure names the adapter that failed. */
  readonly name: string
  /** What this adapter claims for the model under test. */
  readonly capabilities: ProviderCapabilities
  create(fetchImpl: ContractFetch): AIProvider
  readonly fixtures: ProviderContractFixtures
  /** The request the cases send. Defaults to a single short user turn. */
  readonly chatRequest?: ChatRequest
  /** The embedding request the cases send. Defaults to one short input. */
  readonly embedRequest?: EmbedRequest
}

export interface ContractCase {
  readonly name: string
  run(): Promise<void>
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/** Stop a case with a sentence that says what went wrong. */
function fail(label: string, reason: string): never {
  throw new Error(`${label}: ${reason}`)
}

/** A value described by its type only. A message could carry the very text we are checking for. */
function describeThrown(value: unknown): string {
  if (value instanceof Error) return value.name
  return typeof value
}

/** The first validation issue, for a case's failure message. */
function firstIssue(error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }): string {
  const issue = error.issues[0]
  if (issue === undefined) return 'no issue reported'
  const path = issue.path.length === 0 ? '(root)' : issue.path.map(String).join('.')
  return `${path}: ${issue.message}`
}

/** JSON that cannot throw, for building a response body. */
function safeJson(value: unknown): string {
  try {
    const text = JSON.stringify(value)
    return typeof text === 'string' ? text : ''
  } catch {
    return String(value)
  }
}

async function* bodyStream(text: string): AsyncIterable<Uint8Array> {
  if (text.length > 0) yield new TextEncoder().encode(text)
}

function makeResponse(status: number, body: unknown): ContractResponse {
  // A string body is passed through as written, which is how a streamed
  // fixture keeps its own line endings; anything else is JSON.
  const text = typeof body === 'string' ? body : safeJson(body)
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() {
      return text
    },
    async json() {
      // Deliberately unguarded: a body that is not JSON must fail here, the way
      // a real response would, so the adapter's own handling is what is tested.
      return JSON.parse(text) as unknown
    },
    body: bodyStream(text),
  }
}

/** A network that always answers the same way. */
function respondWith(body: unknown, status = 200): ContractFetch {
  return async () => makeResponse(status, body)
}

/** A network that always fails the same way. */
function failWith(error: unknown): ContractFetch {
  return async () => {
    throw error
  }
}

/** Wrap a network so a case can prove it was never called. */
function counted(network: ContractFetch): { fetch: ContractFetch; calls(): number } {
  let calls = 0
  return {
    fetch: async (url, init) => {
      calls += 1
      return network(url, init)
    },
    calls: () => calls,
  }
}

/**
 * Run something that should fail, and return the failure.
 *
 * Wrapped in an async arrow so an adapter that throws synchronously - instead of
 * rejecting - is caught rather than escaping the case.
 */
function attempt<T>(run: () => Promise<T>): Promise<T> {
  return (async () => run())()
}

async function expectFailure(
  label: string,
  run: () => Promise<unknown>,
  expected: readonly ProviderFailure[],
): Promise<ProviderError> {
  let threw = false
  let caught: unknown
  try {
    await attempt(run)
  } catch (error) {
    threw = true
    caught = error
  }

  const wanted = expected.join(' or ')
  if (!threw) fail(label, `the call resolved, but it should have failed with ${wanted}`)
  if (!(caught instanceof ProviderError)) {
    fail(label, `the call threw ${describeThrown(caught)}, but it should have thrown a ProviderError carrying ${wanted}`)
  }
  if (!expected.includes(caught.failure)) {
    fail(label, `the call failed with '${caught.failure}', but it should have failed with ${wanted}`)
  }
  return caught
}

/** A failure message must not carry anything the provider sent or the app dialled. */
function assertNoLeak(label: string, text: string): void {
  const lower = text.toLowerCase()
  for (const marker of LEAK_MARKERS) {
    if (lower.includes(marker)) {
      fail(label, `the failure text carried '${marker}', so it is forwarding provider or transport text`)
    }
  }
}

async function collectStream(iterable: AsyncIterable<ChatDelta>): Promise<ChatDelta[]> {
  const deltas: ChatDelta[] = []
  for await (const delta of iterable) deltas.push(delta)
  return deltas
}

const DEFAULT_CHAT_REQUEST: ChatRequest = {
  messages: [{ role: 'user', parts: [{ type: 'text', text: 'Say hello.' }] }],
}

const DEFAULT_EMBED_REQUEST: EmbedRequest = { inputs: ['hello'] }

/* ------------------------------------------------------------------ *
 * The cases
 * ------------------------------------------------------------------ */

/**
 * Every case this adapter must pass, named.
 *
 * Order is deliberate but not meaningful to a caller: it runs from "the happy
 * path works" outward to the failures, so the first failure a person reads is
 * the most fundamental one.
 */
export function providerContractCases(subject: ProviderContractSubject): ContractCase[] {
  const cases: ContractCase[] = []
  const chatRequest = subject.chatRequest ?? DEFAULT_CHAT_REQUEST
  const embedRequest = subject.embedRequest ?? DEFAULT_EMBED_REQUEST
  const { capabilities } = subject

  const label = (name: string): string => `${subject.name}: ${name}`

  /**
   * Build the adapter and a context for one case.
   *
   * The context is built from the adapter's own id, so a case that finds a
   * mismatched attribution is finding a real disagreement.
   */
  const build = (network: ContractFetch, signal?: AbortSignal): { provider: AIProvider; ctx: CallContext } => {
    const provider = subject.create(network)
    const ctx = createCallContext(
      { businessId: 1, providerId: provider.id, userId: 1, purpose: 'chat_strategy' },
      signal,
    )
    return { provider, ctx }
  }

  /* ---------------------------------------------------------------- *
   * Supported capabilities
   * ---------------------------------------------------------------- */

  const modelsName = 'lists models that carry their own capabilities'
  cases.push({
    name: modelsName,
    async run() {
      const name = label(modelsName)
      const { provider, ctx } = build(respondWith(subject.fixtures.models))
      const models = await provider.listModels(ctx)

      if (!Array.isArray(models) || models.length === 0) {
        fail(name, 'listModels returned no models')
      }
      for (const model of models) {
        const checked = modelInfoSchema.safeParse(model)
        if (!checked.success) {
          fail(name, `a model does not match the contract (${firstIssue(checked.error)})`)
        }
        if (checked.data.providerId !== provider.id) {
          fail(name, `a model reported providerId '${checked.data.providerId}' instead of '${provider.id}'`)
        }
      }
    },
  })

  const chatName = 'reports attribution and usage with every reply'
  cases.push({
    name: chatName,
    async run() {
      const name = label(chatName)
      const { provider, ctx } = build(respondWith(subject.fixtures.chat))
      const result = await provider.chat(chatRequest, ctx)

      const checked = chatResultSchema.safeParse(result)
      if (!checked.success) {
        fail(name, `the reply does not match the contract (${firstIssue(checked.error)})`)
      }
      if (checked.data.providerId !== provider.id) {
        fail(name, `the reply named providerId '${checked.data.providerId}' instead of '${provider.id}'`)
      }
      if (checked.data.modelId.length === 0) {
        fail(name, 'the reply named no model, so the ledger cannot record cost')
      }
    },
  })

  if (capabilities.streaming) {
    const streamName = 'streams deltas and ends with the final result'
    cases.push({
      name: streamName,
      async run() {
        const name = label(streamName)
        const { provider, ctx } = build(respondWith(subject.fixtures.stream ?? subject.fixtures.chat))
        const deltas = await collectStream(provider.stream(chatRequest, ctx))

        if (deltas.length === 0) fail(name, 'the stream produced no deltas')
        for (const delta of deltas) {
          const checked = chatDeltaSchema.safeParse(delta)
          if (!checked.success) {
            fail(name, `a delta does not match the contract (${firstIssue(checked.error)})`)
          }
        }

        const last: ChatDelta | undefined = deltas[deltas.length - 1]
        if (last === undefined) fail(name, 'the stream produced no deltas')
        if (last.type !== 'done') {
          fail(name, 'the stream ended without a final result, so a caller never learns usage')
        }
      },
    })
  } else {
    const noStreamName = 'refuses to stream when it declares no streaming'
    cases.push({
      name: noStreamName,
      async run() {
        const name = label(noStreamName)
        const { provider, ctx } = build(respondWith(subject.fixtures.chat))
        await expectFailure(name, () => collectStream(provider.stream(chatRequest, ctx)), ['unsupported'])
      },
    })
  }

  if (capabilities.embeddings) {
    const embedName = 'returns one vector per input'
    cases.push({
      name: embedName,
      async run() {
        const name = label(embedName)
        const { provider, ctx } = build(respondWith(subject.fixtures.embed))
        const result = await provider.embed(embedRequest, ctx)

        const checked = embedResultSchema.safeParse(result)
        if (!checked.success) {
          fail(name, `the embedding result does not match the contract (${firstIssue(checked.error)})`)
        }
        if (checked.data.vectors.length !== embedRequest.inputs.length) {
          fail(name, `got ${checked.data.vectors.length} vectors for ${embedRequest.inputs.length} inputs`)
        }
        if (checked.data.providerId !== provider.id) {
          fail(name, `the result named providerId '${checked.data.providerId}' instead of '${provider.id}'`)
        }
      },
    })
  } else {
    const noEmbedName = 'refuses embeddings when it declares none'
    cases.push({
      name: noEmbedName,
      async run() {
        const name = label(noEmbedName)
        const { provider, ctx } = build(respondWith(subject.fixtures.chat))
        await expectFailure(name, () => provider.embed(embedRequest, ctx), ['unsupported'])
      },
    })
  }

  const tokensName = 'counts tokens locally without touching the network'
  cases.push({
    name: tokensName,
    async run() {
      const name = label(tokensName)
      const network = counted(respondWith(subject.fixtures.models))
      const { provider } = build(network.fetch)

      const tokens = await provider.countTokens(chatRequest)
      if (!Number.isInteger(tokens) || tokens <= 0) {
        fail(name, `countTokens returned ${String(tokens)}; it must be a positive whole number`)
      }
      // The estimate exists so a size check can run before a call is made.
      // Reaching the network here would defeat that and cost money per keystroke.
      if (network.calls() !== 0) {
        fail(name, 'countTokens made a network call; it must estimate locally')
      }
    },
  })

  const testName = 'tests a working connection without throwing'
  cases.push({
    name: testName,
    async run() {
      const name = label(testName)
      const { provider, ctx } = build(respondWith(subject.fixtures.models))
      const result = await provider.testConnection(ctx)

      const checked = testResultSchema.safeParse(result)
      if (!checked.success) {
        fail(name, `testConnection did not answer with the contract shape (${firstIssue(checked.error)})`)
      }
      if (!checked.data.ok) {
        fail(name, `testConnection reported '${checked.data.failure}' for a provider that answered`)
      }
    },
  })

  /* ---------------------------------------------------------------- *
   * Safe errors
   * ---------------------------------------------------------------- */

  const refusedKeyName = 'reports a rejected key as a failure, not a throw'
  cases.push({
    name: refusedKeyName,
    async run() {
      const name = label(refusedKeyName)
      const body = { error: { message: CONTRACT_CANARY }, detail: CONTRACT_CANARY }
      const { provider, ctx } = build(respondWith(body, 401))

      const result = await provider.testConnection(ctx)
      const checked = testResultSchema.safeParse(result)
      if (!checked.success) {
        fail(name, `testConnection did not answer with the contract shape (${firstIssue(checked.error)})`)
      }
      if (checked.data.ok) fail(name, 'testConnection reported success for a rejected key')
      if (checked.data.failure !== 'provider_unauthorized') {
        fail(name, `the rejection was reported as '${checked.data.failure}', not 'provider_unauthorized'`)
      }
      assertNoLeak(name, safeJson(checked.data))
    },
  })

  const unauthorizedName = 'turns a rejected key into a safe failure'
  cases.push({
    name: unauthorizedName,
    async run() {
      const name = label(unauthorizedName)
      const body = { error: { message: CONTRACT_CANARY }, detail: CONTRACT_CANARY }
      const { provider, ctx } = build(respondWith(body, 401))

      const error = await expectFailure(name, () => provider.chat(chatRequest, ctx), ['provider_unauthorized'])
      assertNoLeak(name, error.message)
    },
  })

  const malformedName = 'turns an unreadable reply into a safe failure'
  cases.push({
    name: malformedName,
    async run() {
      const name = label(malformedName)
      // A 200 with a body that is not the protocol's shape: the failure mode
      // that used to surface as a TypeError three frames deeper.
      const { provider, ctx } = build(respondWith({ unexpected: CONTRACT_CANARY }))

      const error = await expectFailure(name, () => provider.chat(chatRequest, ctx), ['malformed_response'])
      assertNoLeak(name, error.message)
    },
  })

  const transportName = 'turns a transport error into a safe failure'
  cases.push({
    name: transportName,
    async run() {
      const name = label(transportName)
      // The shape a request library actually produces: the full URL and, all too
      // often, the header it was sending.
      const text = `GET https://api.provider.example/v1/chat failed with key sk-live-${CONTRACT_CANARY}`
      const { provider, ctx } = build(failWith(Object.assign(new Error(text), { code: 'network_error' })))

      const error = await expectFailure(name, () => provider.chat(chatRequest, ctx), ['network'])
      assertNoLeak(name, error.message)
    },
  })

  /* ---------------------------------------------------------------- *
   * Cancellation
   * ---------------------------------------------------------------- */

  const cancelledName = 'refuses a call that was cancelled before it started'
  cases.push({
    name: cancelledName,
    async run() {
      const name = label(cancelledName)
      const network = counted(respondWith(subject.fixtures.chat))
      const controller = new AbortController()
      controller.abort()

      const { provider, ctx } = build(network.fetch, controller.signal)
      await expectFailure(name, () => provider.chat(chatRequest, ctx), ['aborted'])

      // Section 7.3: a request the person already abandoned must not leave the
      // machine, because a cloud call would still be billed and still be sent.
      if (network.calls() !== 0) {
        fail(name, 'an already-cancelled call still reached the network')
      }
    },
  })

  const abortedName = 'turns an aborted transport into a safe failure'
  cases.push({
    name: abortedName,
    async run() {
      const name = label(abortedName)
      const aborted = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
      const { provider, ctx } = build(failWith(aborted))

      const error = await expectFailure(name, () => provider.chat(chatRequest, ctx), ['aborted'])
      assertNoLeak(name, error.message)
    },
  })

  return cases
}

/**
 * Run every case and collect the failures, instead of stopping at the first.
 *
 * A person fixing an adapter wants the whole list, and the harness's own test
 * wants the count: a broken adapter must produce a failure, and a suite that
 * reported none would be the bug.
 */
export async function collectContractFailures(
  cases: readonly ContractCase[],
): Promise<ReadonlyArray<{ name: string; message: string }>> {
  const failures: Array<{ name: string; message: string }> = []
  for (const contractCase of cases) {
    try {
      await contractCase.run()
    } catch (error) {
      failures.push({
        name: contractCase.name,
        message: error instanceof Error ? error.message : 'the case threw a value that is not an error',
      })
    }
  }
  return failures
}
