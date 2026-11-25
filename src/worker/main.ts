// The Wake worker: answers the panel's requests on the focused workspace's repository, tells
// the panel when the repository changes, and keeps the status bar item current.
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import type { Disposable, PluginRequestInput, PluginRequestOutput, PluginRequests } from 'orca/host'
import type { OrcaWorkerApi } from 'orca/worker'
import type { OpResult, RepoState, SyncOperation } from '../shared/model'
import type { PanelEvents } from '../shared/protocol'
import { type AiSettings, cancelDraft, chosenAgent, draftCommitMessage } from './ai'
import {
  checkoutBranch,
  createBranch,
  createTag,
  deleteBranch,
  listBranches,
  mergeBranch,
  renameBranch
} from './branches'
import { openPanelWithCli } from './cli'
import {
  checkoutCommit,
  cherryPick,
  createCommit,
  discardChanges,
  discardLines,
  ignorePattern,
  insideRoot,
  lastMessage,
  resetToCommit,
  revertCommit,
  undoCommit
} from './commit'
import { abortOperation, continueOperation, resolveConflict } from './conflicts'
import { commitDiff, stashDiff, workingDiff } from './diff'
import { failure, hostError, ok } from './failure'
import { createFocusTracker, type FocusedWorkspace } from './focus'
import { readDetails, readLog } from './history'
import { currentPullRequest } from './pullRequest'
import { createMutationQueue } from './queue'
import { openRepo, type RepoContext } from './repo'
import { launchWithNotes, listTargets, sendToAgent } from './review'
import { applyStash, dropStash, listStashes, pushStash, stashFiles } from './stash'
import { readRemoteConfig, readSnapshot } from './status'
import { statusBarView } from './statusbar'
import { fetchRemote, publish, runSync } from './sync'
import { prepareTabFile } from './tab'
import { type RepoWatcher, watchRepo } from './watch'

type Handler<K extends keyof PluginRequests> = (
  ctx: RepoContext,
  input: PluginRequestInput<K>
) => Promise<PluginRequestOutput<K>>

type Located =
  | { kind: 'repo'; ctx: RepoContext; workspace: FocusedWorkspace }
  | { kind: 'none'; state: Exclude<RepoState, { kind: 'ready' }> }

const STATUS_BAR_DELAY_MS = 300
const DEFAULT_AUTO_FETCH_MINUTES = 15
const SYNC_DONE: Record<SyncOperation, string> = {
  fetch: 'Fetched.',
  pull: 'Pulled.',
  push: 'Pushed.'
}

let stop: (() => void) | null = null

export default function activate(orca: OrcaWorkerApi) {
  stop = start(orca)
}

export function deactivate() {
  stop?.()
  stop = null
}

function start(orca: OrcaWorkerApi): () => void {
  const queue = createMutationQueue()
  const disposables: Disposable[] = []
  let watched: { root: string; watcher: RepoWatcher } | null = null
  let watchSequence = 0
  let statusBarTimer: NodeJS.Timeout | undefined
  let autoFetchTimer: NodeJS.Timeout | undefined
  let stopped = false

  const changed = (reason: PanelEvents['repo.changed']['reason']) => {
    orca.panels.post('repo.changed', { reason })
    clearTimeout(statusBarTimer)
    statusBarTimer = setTimeout(() => void refreshStatusBar(), STATUS_BAR_DELAY_MS)
  }

  const focus = createFocusTracker(orca, () => {
    changed('workspace')
    void repointWatcher()
  })

  async function locate(signal?: AbortSignal): Promise<Located> {
    const workspace = await focus.current()
    if (!workspace) return { kind: 'none', state: { kind: 'no-workspace' } }
    if (workspace.remoteHostId) {
      return {
        kind: 'none',
        state: {
          kind: 'unsupported-host',
          workspaceName: workspace.name,
          hostId: workspace.remoteHostId
        }
      }
    }
    const ctx = await openRepo(workspace.path, {
      signal,
      onProgress: (progress) => orca.panels.post('sync.progress', progress)
    })
    if (!ctx) {
      return {
        kind: 'none',
        state: { kind: 'not-a-repo', workspaceName: workspace.name, path: workspace.path }
      }
    }
    return { kind: 'repo', ctx, workspace }
  }

  async function readState(located: Located): Promise<RepoState> {
    if (located.kind === 'none') return located.state
    return { kind: 'ready', repo: await readSnapshot(located.ctx, located.workspace.name) }
  }

  async function requireRepo(signal?: AbortSignal) {
    const located = await locate(signal)
    if (located.kind === 'repo') return located
    const { state } = located
    const message =
      state.kind === 'no-workspace'
        ? 'No workspace is focused.'
        : state.kind === 'unsupported-host'
          ? 'Wake works with workspaces on this computer only.'
          : `${state.path} is not a Git repository.`
    throw hostError('unavailable', message)
  }

  /** Runs an operation that changes the repository: one at a time, then tells the panel. */
  function mutate<T>(ctx: RepoContext, operation: () => Promise<T>): Promise<T> {
    return queue.run(ctx.commonDir, operation).finally(() => changed('operation'))
  }

  function wire<K extends keyof PluginRequests>(name: K, handler: Handler<K>, mutates = false) {
    const disposable = orca.panels.handle(name, async (input, { signal }) => {
      if (handler.length > 1 && (typeof input !== 'object' || input === null)) {
        throw hostError('invalid_params', `${name} needs an input object`)
      }
      // A change runs to the end even when the panel stops waiting: half a commit is worse.
      const { ctx } = await requireRepo(mutates ? undefined : signal)
      return mutates ? mutate(ctx, () => handler(ctx, input)) : handler(ctx, input)
    })
    disposables.push(disposable)
  }

  disposables.push(
    orca.panels.handle('repo.state', async (_input, { signal }) => {
      const located = await locate(signal)
      const root = located.kind === 'repo' ? located.ctx.root : null
      if ((watched?.root ?? null) !== root) void repointWatcher()
      return readState(located)
    })
  )

  wire('diff.working', workingDiff)
  wire('diff.commit', commitDiff)
  wire('diff.stash', stashDiff)

  wire('commit.create', createCommit, true)
  wire('commit.undo', undoCommit, true)
  wire('commit.revert', revertCommit, true)
  wire('commit.resetTo', resetToCommit, true)
  wire('commit.checkout', checkoutCommit, true)
  wire('commit.cherryPick', cherryPick, true)
  wire('commit.lastMessage', lastMessage)
  wire('ai.commitMessage', async (ctx, { files }) =>
    draftCommitMessage(ctx, files, await readAiSettings())
  )
  disposables.push(
    orca.panels.handle('ai.cancel', () => {
      cancelDraft()
      return null
    })
  )

  wire('changes.discard', discardChanges, true)
  wire('changes.discardLines', discardLines, true)
  wire('changes.ignore', ignorePattern, true)

  wire('history.log', readLog)
  wire('history.details', readDetails)

  wire('branch.list', listBranches)
  wire('branch.checkout', checkoutBranch, true)
  wire('branch.create', createBranch, true)
  wire('branch.rename', renameBranch, true)
  wire('branch.delete', deleteBranch, true)
  wire('branch.merge', mergeBranch, true)
  wire('tag.create', createTag, true)

  wire('pr.current', (ctx, { refresh }) => currentPullRequest(ctx, refresh))

  wire('sync.run', runSync, true)
  wire('sync.publish', publish, true)

  wire('stash.list', listStashes)
  wire('stash.push', pushStash, true)
  wire('stash.apply', applyStash, true)
  wire('stash.drop', dropStash, true)
  wire('stash.files', stashFiles)

  wire('operation.abort', abortOperation, true)
  wire('operation.continue', continueOperation, true)
  wire('conflict.resolve', resolveConflict, true)

  disposables.push(
    orca.panels.handle('workspace.openFile', async (input) => {
      const { ctx, workspace } = await requireRepo()
      const file = insideRoot(ctx, input?.path)
      if (!orca.host.has('editor.open')) return failure('other', 'This Orca cannot open files.')
      const base = await realpath(workspace.path).catch(() => workspace.path)
      const path = relative(base, file)
      if (path.startsWith(`..${sep}`) || isAbsolute(path)) {
        return failure('other', `${input.path} is outside the workspace folder.`)
      }
      await orca.host.call('editor.open', { workspaceId: workspace.id, path })
      return ok()
    }),
    orca.panels.handle('workspace.runInTerminal', async (input) => {
      const command = typeof input?.command === 'string' ? input.command.trim() : ''
      if (!command.startsWith('git ') || /[\r\n]/.test(command)) {
        throw hostError('invalid_params', 'Only a one-line git command can run in a terminal')
      }
      const { workspace } = await requireRepo()
      if (!orca.host.has('terminal.create'))
        return failure('other', 'This Orca cannot open terminals.')
      await orca.host.call('terminal.create', { workspaceId: workspace.id, title: 'git', command })
      return ok()
    }),
    orca.panels.handle('view.openTab', () => openTab()),
    orca.panels.handle('view.backToTerminal', () => backToTerminal()),
    orca.panels.handle('review.targets', async () => {
      const workspace = await focus.current()
      return workspace ? listTargets(orca, workspace.id) : []
    }),
    orca.panels.handle('review.send', (input) => sendToAgent(orca, input)),
    orca.panels.handle('review.launch', async (input) => {
      const workspace = await focus.current()
      if (!workspace) return failure('other', 'Open a workspace first.')
      // The setting's agent ids are Orca's own agent ids too.
      const agent = await chosenAgent((await readAiSettings()).agent)
      if (!agent)
        return failure(
          'other',
          'No coding agent was found. Install Claude Code, Codex, Gemini CLI or OpenCode, or pick one in Wake’s settings.'
        )
      return launchWithNotes(orca, { workspaceId: workspace.id, agent, text: input.text })
    })
  )

  /** Opens Wake as a tab of Orca's main area, next to the terminals. */
  async function openTab(): Promise<OpResult> {
    const workspace = await focus.current()
    if (!workspace) return failure('other', 'Open a workspace first.')
    if (workspace.remoteHostId)
      return failure('other', 'Wake works with workspaces on this computer only.')
    if (!orca.host.has('editor.open'))
      return failure('other', 'This Orca cannot open tabs for plugins.')
    const ctx = await openRepo(workspace.path)
    const prepared = await prepareTabFile(workspace.path, ctx)
    if (!prepared.ok) return prepared
    await orca.host.call('editor.open', { workspaceId: workspace.id, path: prepared.value })
    return ok()
  }

  async function backToTerminal(): Promise<OpResult> {
    const context = orca.host.has('workspace.readContext')
      ? await orca.host.call('workspace.readContext', {}).catch(() => null)
      : null
    const terminal = context?.terminals[0]
    if (!terminal) return failure('other', 'This workspace has no terminal open.')
    if (!orca.host.has('terminal.focus'))
      return failure('other', 'This Orca cannot focus terminals.')
    await orca.host.call('terminal.focus', { terminalId: terminal.id })
    return ok()
  }

  async function repointWatcher() {
    const sequence = ++watchSequence
    const located = await locate().catch(() => null)
    if (sequence !== watchSequence) return
    const ctx = located?.kind === 'repo' ? located.ctx : null
    if ((watched?.root ?? null) === (ctx?.root ?? null)) return
    watched?.watcher.close()
    watched = ctx
      ? { root: ctx.root, watcher: watchRepo(ctx, () => changed('files'), orca.log) }
      : null
  }

  async function refreshStatusBar() {
    if (!orca.host.has('statusBar.update')) return
    const state = await locate()
      .then(readState)
      .catch((): RepoState => ({ kind: 'no-workspace' }))
    await orca.host
      .call('statusBar.update', { id: 'branch', icon: 'branch', ...statusBarView(state) })
      .catch((error: unknown) => orca.log(`Wake: status bar update failed: ${String(error)}`))
  }

  async function autoFetch() {
    const located = await locate().catch(() => null)
    if (located?.kind !== 'repo' || queue.busy(located.ctx.commonDir)) return
    const { ctx } = located
    if ((await readRemoteConfig(ctx)).remotes.size === 0) return
    const result = await mutate(ctx, () => fetchRemote(ctx, true))
    if (!result.ok) orca.log(`Wake: background fetch failed: ${result.message}`)
  }

  async function scheduleAutoFetch() {
    const value = await orca.settings.get('autoFetchMinutes').catch(() => undefined)
    const minutes =
      typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? value
        : DEFAULT_AUTO_FETCH_MINUTES
    clearInterval(autoFetchTimer)
    if (minutes > 0 && !stopped)
      autoFetchTimer = setInterval(() => void autoFetch(), minutes * 60_000)
  }

  async function readAiSettings(): Promise<AiSettings> {
    const values = await orca.settings.get().catch((): Record<string, unknown> => ({}))
    const agent = values.aiAgent
    const known =
      agent === 'claude' || agent === 'codex' || agent === 'gemini' || agent === 'opencode'
    return {
      agent: known ? agent : 'auto',
      model: typeof values.aiModel === 'string' ? values.aiModel : '',
      instructions: typeof values.aiInstructions === 'string' ? values.aiInstructions : ''
    }
  }

  void scheduleAutoFetch()
  // Not disposed: its typing names the global `Disposable`, not Orca's, and `stopped` silences it.
  orca.settings.onDidChange(({ key }) => {
    if (key === 'autoFetchMinutes') void scheduleAutoFetch()
  })

  disposables.push(
    orca.commands.register('showPanel', async () => {
      try {
        await openPanelWithCli()
      } catch (error) {
        orca.log(`Wake: opening the panel with the Orca CLI failed: ${String(error)}`)
        if (orca.host.has('commands.run')) {
          await orca.host.call('commands.run', { action: 'sidebar.right.toggle' })
        }
      }
    }),
    orca.commands.register('openTab', async () => {
      const result = await openTab()
      if (!result.ok) orca.log(`Wake: opening the tab failed: ${result.message}`)
    })
  )
  for (const op of ['fetch', 'pull', 'push'] as const) {
    disposables.push(
      orca.commands.register(op, async () => {
        const { ctx } = await requireRepo()
        const result: OpResult = await mutate(ctx, () => runSync(ctx, { op }))
        return result.ok ? (result.message ?? SYNC_DONE[op]) : result.message
      })
    )
  }

  return () => {
    stopped = true
    clearTimeout(statusBarTimer)
    clearInterval(autoFetchTimer)
    watched?.watcher.close()
    watched = null
    focus.dispose()
    for (const disposable of disposables.splice(0)) disposable.dispose()
  }
}
