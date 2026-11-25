// The panel ↔ worker contract, declared once. The worker registers a handler for every request
// below (`orca.panels.handle`), and the panel calls them with `orca.plugin.request`.
import type {
  AgentTarget,
  BranchList,
  ChangedFile,
  Commit,
  CommitDetails,
  FileDiff,
  FileSelection,
  OpResult,
  PullRequest,
  RepoState,
  Stash,
  SyncOperation
} from './model'

/** A file to diff in the working tree, against HEAD. */
export type WorkingFileRef = Pick<ChangedFile, 'path' | 'oldPath' | 'kind'>

export type DiffOptions = { ignoreWhitespace?: boolean }

export type Requests = {
  'repo.state': { input: Record<string, never>; output: RepoState }

  'diff.working': { input: { file: WorkingFileRef } & DiffOptions; output: FileDiff }
  'diff.commit': {
    input: { sha: string; file: Pick<ChangedFile, 'path' | 'oldPath'> } & DiffOptions
    output: FileDiff
  }
  'diff.stash': { input: { index: number; path: string }; output: FileDiff }

  'commit.create': {
    input: { summary: string; description: string; amend: boolean; files: FileSelection[] }
    output: OpResult<{ sha: string }>
  }
  /** Moves the last commit back into the working tree; answers its message for the commit box. */
  'commit.undo': {
    input: Record<string, never>
    output: OpResult<{ summary: string; description: string }>
  }
  'commit.revert': { input: { sha: string }; output: OpResult }
  'commit.resetTo': { input: { sha: string }; output: OpResult }
  'commit.checkout': { input: { sha: string }; output: OpResult }
  'commit.cherryPick': { input: { sha: string }; output: OpResult }
  'commit.lastMessage': {
    input: Record<string, never>
    output: { summary: string; description: string }
  }
  /** Drafts a summary and description for the included changes with the person's agent CLI. */
  'ai.commitMessage': {
    input: { files: FileSelection[] }
    output: OpResult<{ summary: string; description: string; agent: string }>
  }
  'ai.cancel': { input: Record<string, never>; output: null }

  'changes.discard': { input: { files: WorkingFileRef[] }; output: OpResult }
  'changes.discardLines': {
    input: { file: WorkingFileRef; hash: string; lines: number[] }
    output: OpResult
  }
  'changes.ignore': { input: { pattern: string }; output: OpResult }

  'history.log': {
    input: { skip: number; limit: number; query?: string }
    output: { commits: Commit[]; hasMore: boolean }
  }
  'history.details': { input: { sha: string }; output: CommitDetails }

  'branch.list': { input: Record<string, never>; output: BranchList }
  /** `name` is a local branch, or a remote one (`origin/x`) to check out as a tracking branch. */
  'branch.checkout': { input: { name: string; remote: boolean }; output: OpResult }
  'branch.create': { input: { name: string; startPoint?: string }; output: OpResult }
  'branch.rename': { input: { from: string; to: string }; output: OpResult }
  'branch.delete': {
    input: { name: string; force: boolean; deleteRemote: boolean }
    output: OpResult
  }
  'branch.merge': { input: { name: string }; output: OpResult }
  'tag.create': { input: { name: string; sha: string }; output: OpResult }

  'sync.run': { input: { op: SyncOperation; force?: boolean }; output: OpResult }
  'sync.publish': { input: Record<string, never>; output: OpResult }

  'stash.list': { input: Record<string, never>; output: Stash[] }
  'stash.push': { input: { message?: string }; output: OpResult }
  'stash.apply': { input: { index: number; drop: boolean }; output: OpResult }
  'stash.drop': { input: { index: number }; output: OpResult }
  'stash.files': { input: { index: number }; output: ChangedFile[] }

  'operation.abort': { input: Record<string, never>; output: OpResult }
  'operation.continue': { input: Record<string, never>; output: OpResult }
  'conflict.resolve': {
    input: { path: string; using: 'ours' | 'theirs' | 'working' }
    output: OpResult
  }

  'workspace.openFile': { input: { path: string }; output: OpResult }
  /** Runs a git command in a new terminal of the workspace, for steps that need a prompt. */
  'workspace.runInTerminal': { input: { command: string }; output: OpResult }

  /** Opens Wake in a full-size tab of Orca's main area. */
  'view.openTab': { input: Record<string, never>; output: OpResult }
  /** Leaves the Wake tab for the workspace's terminal. */
  'view.backToTerminal': { input: Record<string, never>; output: OpResult }

  /** The agents running in the workspace, for sending review notes. */
  'review.targets': { input: Record<string, never>; output: AgentTarget[] }
  /** Pastes the notes into an agent's terminal, and presses Enter when `submit`. */
  'review.send': { input: { terminalId: string; text: string; submit: boolean }; output: OpResult }
  /** Starts a new agent (the `aiAgent` setting) with the notes as its first prompt. */
  'review.launch': { input: { text: string }; output: OpResult }

  /** The open pull request of the current branch, or null (no PR, no `gh`, or not GitHub). */
  'pr.current': { input: { refresh: boolean }; output: PullRequest | null }
}

export type PanelEvents = {
  /** Something under the repository or its git directory changed: read `repo.state` again. */
  'repo.changed': { reason: 'files' | 'workspace' | 'operation' }
  /** Progress of a running fetch, pull or push. */
  'sync.progress': { op: SyncOperation; text: string; percent: number | null }
}

export type RequestName = keyof Requests
export type RequestInput<K extends RequestName> = Requests[K]['input']
export type RequestOutput<K extends RequestName> = Requests[K]['output']

declare module 'orca' {
  interface PluginRequests extends Requests {}
  interface PluginPanelEvents extends PanelEvents {}
}
