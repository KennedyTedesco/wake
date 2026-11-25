// Which Orca workspace has focus. Panels never learn the workspace id, so the worker follows
// `workspace.changed` and finds the workspace's folder with `workspace.list`.
import type { HostResult, PluginEvents } from 'orca/host'
import type { OrcaWorkerApi } from 'orca/worker'

export type FocusedWorkspace = {
  id: string
  name: string
  path: string
  /** Null for this machine; otherwise an Orca host id such as `ssh:…`. */
  remoteHostId: string | null
}

type WorkspaceContext = PluginEvents['workspace.changed']['context']
type WorkspaceRow = HostResult<'workspace.list'>['workspaces'][number]

const LIST_TTL_MS = 10_000
const FIRST_EVENT_WAIT_MS = 2_000

export type FocusTracker = {
  /** The focused workspace, or null when none is focused (or Orca does not list it). */
  current(): Promise<FocusedWorkspace | null>
  dispose(): void
}

export function createFocusTracker(orca: OrcaWorkerApi, onChange: () => void): FocusTracker {
  // `undefined` until the first event: the context is not known yet.
  let context: WorkspaceContext | undefined
  let focusKey: string | null = null
  let list: { at: number; rows: WorkspaceRow[] } | null = null
  let firstEventArrived = () => {}
  const firstEvent = new Promise<void>((resolve) => {
    firstEventArrived = resolve
  })

  const subscription = orca.events.on('workspace.changed', ({ context: next }) => {
    context = next
    firstEventArrived()
    const key = next ? (next.workspaceId ?? `${next.displayName}\0${next.branch}`) : ''
    if (key === focusKey) return
    focusKey = key
    onChange()
  })

  async function readContext(): Promise<WorkspaceContext> {
    if (context === undefined) {
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, FIRST_EVENT_WAIT_MS))
      await Promise.race([firstEvent, timeout])
    }
    if (context !== undefined) return context
    if (!orca.host.has('workspace.readContext')) return null
    return orca.host.call('workspace.readContext', {}).catch(() => null)
  }

  async function rows(fresh: boolean): Promise<WorkspaceRow[]> {
    if (!fresh && list && Date.now() - list.at < LIST_TTL_MS) return list.rows
    if (!orca.host.has('workspace.list')) return []
    const answer = await orca.host.call('workspace.list', {}).catch(() => null)
    if (!answer) return list?.rows ?? []
    list = { at: Date.now(), rows: answer.workspaces }
    return answer.workspaces
  }

  function match(rows: WorkspaceRow[], focused: NonNullable<WorkspaceContext>) {
    if (focused.workspaceId) return rows.find((row) => row.id === focused.workspaceId) ?? null
    // Older Orca gives no id: match by name and branch, only when that is unambiguous.
    const hits = rows.filter(
      (row) => row.name === focused.displayName && row.branch === focused.branch
    )
    return hits.length === 1 ? (hits[0] ?? null) : null
  }

  return {
    async current() {
      const focused = await readContext()
      if (!focused) return null
      const row = match(await rows(false), focused) ?? match(await rows(true), focused)
      if (!row) return null
      const local = row.hostId === null || row.hostId === 'local'
      return { id: row.id, name: row.name, path: row.path, remoteHostId: local ? null : row.hostId }
    },
    dispose: () => subscription.dispose()
  }
}
