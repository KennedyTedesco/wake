// The panel's only way to reach its worker and Orca. Typed by `src/shared/protocol.ts`.
import type { OpResult } from '../../shared/model'
import type { PanelEvents, RequestInput, RequestName, RequestOutput } from '../../shared/protocol'

// Git operations such as a push or a commit with slow hooks can run long; Orca caps a request
// at 120 s.
const LONG_REQUESTS: Partial<Record<RequestName, true>> = {
  'sync.run': true,
  'sync.publish': true,
  'commit.create': true,
  'branch.merge': true,
  'branch.checkout': true,
  'branch.delete': true,
  'operation.continue': true,
  'commit.revert': true,
  'commit.cherryPick': true,
  'stash.apply': true,
  'stash.push': true,
  'ai.commitMessage': true
}
export class BridgeError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

function hasOrca(): boolean {
  return typeof globalThis.orca === 'object' && globalThis.orca !== null
}

export async function request<K extends RequestName>(
  name: K,
  input: RequestInput<K>
): Promise<RequestOutput<K>> {
  if (!hasOrca()) throw new BridgeError('unavailable', 'Wake runs inside Orca.')
  const timeoutMs = LONG_REQUESTS[name] ? 120_000 : 30_000
  try {
    // The bridge's overloads are keyed by the declared names; this call is typed by K.
    const answer: unknown = await orca.plugin.request(name, input as never, { timeoutMs })
    return answer as RequestOutput<K>
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'action_failed'
    const message = error instanceof Error ? error.message : String(error)
    throw new BridgeError(code, message)
  }
}

/** A request whose failure is an expected outcome: thrown bridge errors become a failed result. */
export async function operation<K extends RequestName>(
  name: K,
  input: RequestInput<K>
): Promise<RequestOutput<K> | OpResult<never>> {
  try {
    return await request(name, input)
  } catch (error) {
    return {
      ok: false,
      kind: 'other',
      message: error instanceof Error ? error.message : String(error),
      detail: '',
      command: null
    }
  }
}

export function onWorkerEvent<E extends keyof PanelEvents>(
  event: E,
  handler: (payload: PanelEvents[E]) => void
): () => void {
  if (!hasOrca()) return () => {}
  const subscription = orca.plugin.on(event, handler)
  return () => subscription.dispose()
}

export function onThemeChange(handler: () => void): () => void {
  if (!hasOrca()) return () => {}
  const subscription = orca.on('theme', handler)
  return () => subscription.dispose()
}

export async function openExternal(url: string): Promise<void> {
  await orca.shell?.openExternal(url)
}
