import { create } from 'zustand'
import type {
  ChangedFile,
  Commit,
  CommitDetails,
  FileSelection,
  OpResult,
  RepoSnapshot,
  RepoState,
  SyncOperation
} from '../../shared/model'
import type { RequestInput, RequestName, RequestOutput } from '../../shared/protocol'
import { operation, request } from '../lib/bridge'
import { loadPrefs, type Prefs, savePrefs } from '../lib/prefs'

/** Which part of a changed file goes into the next commit. */
export type Inclusion =
  | { kind: 'all' }
  | { kind: 'none' }
  | { kind: 'lines'; hash: string; lines: number[]; total: number }

export type Tab = 'changes' | 'history'

/** What the detail pane shows in the Changes tab. */
export type ChangesFocus = { kind: 'file'; path: string } | { kind: 'stash'; index: number } | null

export type FailedResult = Extract<OpResult, { ok: false }>

export type Dialog =
  | {
      kind: 'confirm'
      title: string
      body: string
      confirmLabel: string
      destructive?: boolean
      onConfirm: () => void | Promise<void>
    }
  | {
      kind: 'prompt'
      title: string
      label: string
      initial: string
      placeholder?: string
      hint?: string
      /** Live note under the field, such as the name git will really use. */
      preview?: (value: string) => string | null
      confirmLabel: string
      validate?: (value: string) => string | null
      onSubmit: (value: string) => Promise<boolean>
    }
  | { kind: 'failure'; title: string; failure: FailedResult }

export type Toast = {
  id: number
  text: string
  tone: 'info' | 'success' | 'error'
  action?: { label: string; run: () => void }
}

type SyncState = { op: SyncOperation | 'publish'; text: string; percent: number | null } | null

type HistoryState = {
  commits: Commit[]
  hasMore: boolean
  loading: boolean
  query: string
  selectedSha: string | null
  details: CommitDetails | null
  detailsLoading: boolean
}

export type State = {
  repoState: RepoState | null
  repoError: string | null
  /** Rises on every change the worker reports, so open diffs reload. */
  revision: number
  tab: Tab
  changesFocus: ChangesFocus
  inclusions: Record<string, Inclusion>
  draft: { summary: string; description: string; amend: boolean }
  committing: boolean
  /** The commit made from this panel, which the commit box offers to undo while it is unpushed. */
  recentCommit: string | null
  /** An agent is drafting the commit message. */
  drafting: boolean
  sync: SyncState
  history: HistoryState
  prefs: Prefs
  dialog: Dialog | null
  toasts: Toast[]
  /** Narrow layout only: whether the detail pane covers the list. */
  showDetail: boolean
}

const PAGE = 100

const initialHistory: HistoryState = {
  commits: [],
  hasMore: true,
  loading: false,
  query: '',
  selectedSha: null,
  details: null,
  detailsLoading: false
}

export const useStore = create<State>(() => ({
  repoState: null,
  repoError: null,
  revision: 0,
  tab: 'changes',
  changesFocus: null,
  inclusions: {},
  draft: { summary: '', description: '', amend: false },
  committing: false,
  recentCommit: null,
  drafting: false,
  sync: null,
  history: initialHistory,
  prefs: loadPrefs(),
  dialog: null,
  toasts: [],
  showDetail: false
}))

const set = useStore.setState
const get = useStore.getState

export function readyRepo(state: State = get()): RepoSnapshot | null {
  return state.repoState?.kind === 'ready' ? state.repoState.repo : null
}

// ---------- repository ----------

let refreshing: Promise<void> | null = null
let refreshAgain = false

/** Reads `repo.state`; calls that arrive while one runs fold into a single follow-up read. */
export function refresh(): Promise<void> {
  if (refreshing) {
    refreshAgain = true
    return refreshing
  }
  refreshing = (async () => {
    do {
      refreshAgain = false
      try {
        const next = await request('repo.state', {})
        applyRepoState(next)
      } catch (error) {
        set({ repoError: error instanceof Error ? error.message : String(error) })
      }
    } while (refreshAgain)
  })().finally(() => {
    refreshing = null
  })
  return refreshing
}

function applyRepoState(next: RepoState): void {
  const previous = readyRepo()
  const repo = next.kind === 'ready' ? next.repo : null
  const sameRepo = previous && repo && previous.root === repo.root

  const inclusions: Record<string, Inclusion> = {}
  for (const file of repo?.files ?? []) {
    inclusions[file.path] = (sameRepo && get().inclusions[file.path]) || { kind: 'all' }
  }

  const focus = get().changesFocus
  const focusGone =
    (focus?.kind === 'file' && !repo?.files.some((file) => file.path === focus.path)) ||
    (focus?.kind === 'stash' && (repo?.stashCount ?? 0) <= focus.index)

  set((state) => ({
    repoState: next,
    repoError: null,
    revision: state.revision + 1,
    inclusions,
    changesFocus: focusGone ? null : sameRepo ? focus : null,
    ...(sameRepo
      ? {}
      : { history: initialHistory, draft: { summary: '', description: '', amend: false } })
  }))

  if (!get().changesFocus && repo?.files[0] && get().tab === 'changes' && !get().showDetail) {
    set({ changesFocus: { kind: 'file', path: repo.files[0].path } })
  }
  const headMoved = previous?.lastCommit?.sha !== repo?.lastCommit?.sha
  // A push moves the upstream, not HEAD: the "not pushed" marks change with the count ahead.
  const upstreamMoved = upstreamKey(previous) !== upstreamKey(repo)
  if (repo && (headMoved || upstreamMoved || !sameRepo) && get().history.commits.length > 0) {
    void loadHistory(true)
  }
}

function upstreamKey(repo: RepoSnapshot | null): string {
  const upstream = repo?.head.kind === 'branch' ? repo.head.upstream : null
  return upstream ? `${upstream.name}\0${upstream.ahead}` : ''
}

// ---------- preferences and navigation ----------

export function updatePrefs(patch: Partial<Prefs>): void {
  const prefs = { ...get().prefs, ...patch }
  savePrefs(prefs)
  set({ prefs })
}

export function setTab(tab: Tab): void {
  set({ tab, showDetail: false })
  if (tab === 'history' && get().history.commits.length === 0) void loadHistory(true)
}

export function focusChanges(focus: ChangesFocus): void {
  set({ changesFocus: focus, showDetail: focus !== null })
}

export function closeDetail(): void {
  set({ showDetail: false })
}

// ---------- toasts and dialogs ----------

let toastId = 0

export function toast(text: string, tone: Toast['tone'] = 'info', action?: Toast['action']): void {
  const id = ++toastId
  set((state) => ({
    toasts: [...state.toasts.slice(-2), { id, text, tone, ...(action ? { action } : {}) }]
  }))
  setTimeout(() => dismissToast(id), action ? 9000 : 4000)
}

export function dismissToast(id: number): void {
  set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }))
}

export function openDialog(dialog: Dialog): void {
  set({ dialog })
}

export function closeDialog(): void {
  set({ dialog: null })
}

export function showFailure(title: string, failure: FailedResult): void {
  set({ dialog: { kind: 'failure', title, failure } })
}

type OpRequest = {
  [K in RequestName]: RequestOutput<K> extends OpResult<infer _T> ? K : never
}[RequestName]

/**
 * Runs a mutating request: on failure it opens the failure dialog, on success it shows
 * `success` as a toast. The worker reports the change itself, so the repo refreshes anyway.
 */
export async function run<K extends OpRequest>(
  name: K,
  input: RequestInput<K>,
  { title, success }: { title: string; success?: string }
): Promise<boolean> {
  const result = (await operation(name, input)) as OpResult<unknown>
  if (!result.ok) {
    showFailure(title, result)
    void refresh()
    return false
  }
  if (result.message ?? success) toast(result.message ?? success ?? '', 'success')
  void refresh()
  return true
}

// ---------- changes and commits ----------

export function setInclusion(path: string, inclusion: Inclusion): void {
  set((state) => ({ inclusions: { ...state.inclusions, [path]: inclusion } }))
}

export function setAllIncluded(included: boolean): void {
  set((state) => ({
    inclusions: Object.fromEntries(
      Object.keys(state.inclusions).map((path) => [
        path,
        included ? { kind: 'all' } : { kind: 'none' }
      ])
    )
  }))
}

export function includedFiles(state: State = get()): FileSelection[] {
  const repo = readyRepo(state)
  if (!repo) return []
  const selections: FileSelection[] = []
  for (const file of repo.files) {
    const inclusion = state.inclusions[file.path] ?? { kind: 'all' }
    if (inclusion.kind === 'none') continue
    if (inclusion.kind === 'lines' && inclusion.lines.length === 0) continue
    selections.push({
      path: file.path,
      ...(file.oldPath ? { oldPath: file.oldPath } : {}),
      kind: file.kind,
      selection:
        inclusion.kind === 'lines'
          ? { kind: 'lines', hash: inclusion.hash, lines: inclusion.lines }
          : { kind: 'all' }
    })
  }
  return selections
}

export function setDraft(patch: Partial<State['draft']>): void {
  set((state) => ({ draft: { ...state.draft, ...patch } }))
}

export async function toggleAmend(amend: boolean): Promise<void> {
  const { draft } = get()
  setDraft({ amend })
  if (amend && !draft.summary.trim() && !draft.description.trim()) {
    const message = await request('commit.lastMessage', {})
    setDraft(message)
  }
}

export async function commit(): Promise<void> {
  const state = get()
  const repo = readyRepo(state)
  const files = includedFiles(state)
  const { summary, description, amend } = state.draft
  if (!repo || state.committing || !summary.trim() || (files.length === 0 && !amend)) return

  set({ committing: true })
  const result = await operation('commit.create', {
    summary: summary.trim(),
    description: description.trim(),
    amend,
    files
  })
  set({ committing: false })
  if (!result.ok) {
    showFailure(amend ? 'Could not amend the commit' : 'Could not commit', result)
    return
  }
  // What remains of a partly committed file is a new change: offer all of it next time.
  set((current) => ({
    draft: { summary: '', description: '', amend: false },
    recentCommit: result.value.sha,
    inclusions: Object.fromEntries(
      Object.keys(current.inclusions).map((path): [string, Inclusion] => [path, { kind: 'all' }])
    )
  }))
  toast(`${amend ? 'Amended' : 'Committed'} “${summary.trim()}”`, 'success')
  await refresh()
}

export async function undoCommit(): Promise<void> {
  const result = await operation('commit.undo', {})
  if (!result.ok) {
    showFailure('Could not undo the commit', result)
    return
  }
  set({ draft: { ...result.value, amend: false }, tab: 'changes', recentCommit: null })
  toast('Commit undone: its changes are back in Changes', 'info')
  await refresh()
}

export async function draftMessage(): Promise<void> {
  const state = get()
  const files = includedFiles(state)
  if (state.drafting) return
  if (files.length === 0) {
    toast('Include at least one file to describe', 'error')
    return
  }
  const previous = state.draft
  set({ drafting: true })
  const result = await operation('ai.commitMessage', { files })
  set({ drafting: false })
  if (!result.ok) {
    if (result.message !== 'Stopped.') showFailure('Could not draft the commit message', result)
    return
  }
  const { summary, description, agent } = result.value
  setDraft({ summary, description })
  const hadDraft = previous.summary.trim() || previous.description.trim()
  toast(
    `Drafted with ${agent}`,
    'success',
    hadDraft ? { label: 'Restore mine', run: () => setDraft(previous) } : undefined
  )
}

export function stopDrafting(): void {
  void request('ai.cancel', {}).catch(() => {})
}

export function changedFile(path: string): ChangedFile | undefined {
  return readyRepo()?.files.find((file) => file.path === path)
}

// ---------- sync ----------

export async function sync(op: SyncOperation, force = false): Promise<void> {
  if (get().sync) return
  set({ sync: { op, text: '', percent: null } })
  const result = await operation('sync.run', { op, force })
  set({ sync: null })
  if (!result.ok) {
    showFailure(SYNC_FAILURE[op], result)
  } else if (op !== 'fetch' || result.message) {
    toast(result.message ?? SYNC_DONE[op], 'success')
  }
  await refresh()
}

export async function publish(): Promise<void> {
  if (get().sync) return
  set({ sync: { op: 'publish', text: '', percent: null } })
  const result = await operation('sync.publish', {})
  set({ sync: null })
  if (!result.ok) showFailure('Could not publish the branch', result)
  else toast(result.message ?? 'Branch published', 'success')
  await refresh()
}

export function setSyncProgress(text: string, percent: number | null): void {
  set((state) => (state.sync ? { sync: { op: state.sync.op, text, percent } } : {}))
}

const SYNC_FAILURE: Record<SyncOperation, string> = {
  fetch: 'Could not fetch',
  pull: 'Could not pull',
  push: 'Could not push'
}

const SYNC_DONE: Record<SyncOperation, string> = {
  fetch: 'Fetched',
  pull: 'Pulled the latest changes',
  push: 'Pushed'
}

// ---------- history ----------

let historyRequest = 0

export async function loadHistory(reset: boolean): Promise<void> {
  const current = get().history
  if (!reset && (current.loading || !current.hasMore)) return
  const ticket = ++historyRequest
  const skip = reset ? 0 : current.commits.length
  set((state) => ({ history: { ...state.history, loading: true } }))
  try {
    const query = get().history.query.trim()
    const page = await request('history.log', { skip, limit: PAGE, ...(query ? { query } : {}) })
    if (ticket !== historyRequest) return
    set((state) => {
      const commits = reset ? page.commits : [...state.history.commits, ...page.commits]
      const fresh = commits.find((item) => item.sha === state.history.selectedSha)
      const details = state.history.details
      const sameDetails = details && fresh && details.commit.sha === fresh.sha ? details : null
      return {
        history: {
          ...state.history,
          commits,
          hasMore: page.hasMore,
          loading: false,
          ...(fresh
            ? // The open commit keeps its files; only its push state can have changed.
              {
                details: sameDetails
                  ? { ...sameDetails, commit: { ...sameDetails.commit, unpushed: fresh.unpushed } }
                  : details
              }
            : { selectedSha: null, details: null })
        }
      }
    })
    const { selectedSha, commits } = get().history
    if (!selectedSha && commits[0] && !get().showDetail) void selectCommit(commits[0].sha, false)
  } catch (error) {
    if (ticket !== historyRequest) return
    set((state) => ({ history: { ...state.history, loading: false, hasMore: false } }))
    toast(error instanceof Error ? error.message : String(error), 'error')
  }
}

export function setHistoryQuery(query: string): void {
  set((state) => ({ history: { ...state.history, query } }))
}

let detailsRequest = 0

export async function selectCommit(sha: string, showDetail = true): Promise<void> {
  const ticket = ++detailsRequest
  set((state) => ({
    showDetail,
    history: { ...state.history, selectedSha: sha, detailsLoading: true }
  }))
  try {
    const details = await request('history.details', { sha })
    if (ticket !== detailsRequest) return
    set((state) => ({ history: { ...state.history, details, detailsLoading: false } }))
  } catch (error) {
    if (ticket !== detailsRequest) return
    set((state) => ({ history: { ...state.history, detailsLoading: false, details: null } }))
    toast(error instanceof Error ? error.message : String(error), 'error')
  }
}
