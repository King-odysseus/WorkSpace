/*
 * Which model servers are already running on this machine (section 9.2).
 *
 * Nothing here installs anything, starts anything or downloads a model. It asks
 * two addresses that a person who runs local models usually has listening, and
 * reports what each one says it has. A machine with neither is the ordinary case
 * and must read as an ordinary answer rather than as an error.
 *
 * Four decisions carry the rest.
 *
 * 1. Both probes go through the same guarded transport as a real call. A
 *    detection request is a network request, and section 7.3 makes no exception
 *    for a convenient one: the guard decides it may leave, records it, and
 *    enforces the timeout. A second, unguarded path for "just a probe" is how a
 *    guard ends up with a hole shaped like a health check.
 *
 * 2. A failure is a value, not a throw. Two servers are probed together and
 *    either may be absent; an exception from one would abandon the other and
 *    turn "no local models" into a broken screen. Each candidate therefore
 *    answers its own result.
 *
 * 3. Absent, stopped and malformed are three different answers on purpose. A
 *    refused connection means nothing is listening, a refusal from the server
 *    means something is there but unhappy, and an unreadable body means something
 *    else entirely is on that port. Collapsing them would tell a person their
 *    server is off when it is running something completely different.
 *
 * 4. The reported address is the one that answered, and the model entries carry
 *    the classification the adapter derived from it. Detection never relabels a
 *    model local because the preset is: a preset pointed at a public host is a
 *    cloud endpoint whatever it is called.
 */

import type { ProviderFailure } from '../../shared/providers/errors.js'
import { ProviderError, toProviderFailure } from '../../shared/providers/errors.js'
import type { CallContext, ModelInfo } from '../../shared/providers/types.js'
import { isAborted } from './transport.js'
import type { ProviderTransport } from './transport.js'
import { createProvider } from './registry.js'

export interface LocalCandidate {
  /** The catalogue entry this address belongs to. */
  readonly presetId: string
  readonly baseUrl: string
  readonly label: string
}

/**
 * The two addresses worth asking.
 *
 * These are the ports the two servers use by default. They are a starting point,
 * not a policy: a person may point either entry anywhere, and the Models screen
 * does not depend on this list to find a server on a custom port.
 */
export const LOCAL_CANDIDATES: readonly LocalCandidate[] = Object.freeze([
  Object.freeze({ presetId: 'ollama', baseUrl: 'http://127.0.0.1:11434', label: 'Ollama' }),
  Object.freeze({ presetId: 'lmstudio', baseUrl: 'http://127.0.0.1:1234', label: 'LM Studio' }),
])

export interface LocalDetection {
  readonly presetId: string
  readonly baseUrl: string
  readonly label: string
  /** True only when the server answered with a model list it could read. */
  readonly reachable: boolean
  readonly models: readonly ModelInfo[]
  /** The fixed token behind an unreachable answer. Null when it answered. */
  readonly failure: ProviderFailure | null
}

export interface LocalDetectionDeps {
  readonly transport: ProviderTransport
  readonly ctx: CallContext
  /** Injected by a test so it does not depend on a real port being free. */
  readonly candidates?: readonly LocalCandidate[]
}

/** One candidate, answered as a value whatever happens. */
async function detectOne(candidate: LocalCandidate, deps: LocalDetectionDeps): Promise<LocalDetection> {
  const unreachable = (failure: ProviderFailure): LocalDetection => ({
    presetId: candidate.presetId,
    baseUrl: candidate.baseUrl,
    label: candidate.label,
    reachable: false,
    models: [],
    failure,
  })

  try {
    if (isAborted(deps.ctx)) return unreachable('aborted')

    // No credential: a local server on a default port does not want one. A
    // server that does will answer with a refusal, which is reported as one.
    const provider = createProvider(
      {
        presetId: candidate.presetId,
        credential: null,
        baseUrl: candidate.baseUrl,
        // Detection asks for the list, so no model has to be named.
        defaultModel: '',
      },
      { transport: deps.transport },
    )

    const models = await provider.listModels(deps.ctx)
    return {
      presetId: candidate.presetId,
      baseUrl: candidate.baseUrl,
      label: candidate.label,
      reachable: true,
      models,
      failure: null,
    }
  } catch (error) {
    // Anything at all, including a bug in a preset, is one candidate's answer
    // rather than the end of the whole detection.
    const failure = error instanceof ProviderError ? error.failure : toProviderFailure(error)
    return unreachable(failure)
  }
}

/**
 * Ask every candidate at once and answer in the catalogue's order.
 *
 * Results stay in candidate order rather than completion order so two runs
 * describe the same machine the same way, which is what a screen that lists them
 * needs to stop rows from jumping between refreshes.
 */
export async function detectLocalProviders(deps: LocalDetectionDeps): Promise<readonly LocalDetection[]> {
  const candidates = deps.candidates ?? LOCAL_CANDIDATES
  return await Promise.all(candidates.map((candidate) => detectOne(candidate, deps)))
}
