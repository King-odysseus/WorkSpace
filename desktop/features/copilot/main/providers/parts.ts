/*
 * One neutral-piece helper both adapters need.
 *
 * A streamed reply arrives as many small text pieces, and the result contract
 * caps a reply at 200 parts. Left unmerged, a long answer would fail that cap
 * for no better reason than the provider's chunk size. Merging adjacent text is
 * lossless, so it happens before the final result is built.
 */

import type { AssistantPart } from '../../shared/providers/types.js'

export function mergeTextParts(parts: readonly AssistantPart[]): AssistantPart[] {
  const merged: AssistantPart[] = []

  for (const part of parts) {
    const last = merged[merged.length - 1]
    if (part.type === 'text' && last !== undefined && last.type === 'text') {
      merged[merged.length - 1] = { type: 'text', text: last.text + part.text }
      continue
    }
    merged.push(part)
  }

  return merged
}
