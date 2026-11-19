/*
 * The one place the main process asks the operating system what a name resolves
 * to.
 *
 * Kept in its own file, rather than an arrow function beside the guard's
 * construction, because of what it is: the only input to the egress guard that
 * comes from outside the app. The guard's job is to classify addresses, and it is
 * deliberately handed them rather than resolving them itself, so this module is
 * the seam where "the truth about a hostname" enters the app.
 *
 * `verbatim` keeps the order the resolver answered in. Reordering here would
 * change which address is tried first without the guard or the transport knowing,
 * and the pinned transport reports back which address it dialled.
 *
 * A name that does not resolve throws. That is deliberate: the guard records the
 * refusal and sends nothing, which is what "fail closed" means for a request whose
 * destination is unknown.
 */
import { lookup } from 'node:dns/promises'

export async function systemResolve (hostname: string): Promise<string[]> {
  const answers = await lookup(hostname, { all: true, verbatim: true })
  return answers.map(answer => answer.address)
}
