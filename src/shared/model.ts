// The domain shapes the worker answers and the panel draws. Everything here crosses the
// panel ↔ worker bridge, so it stays plain JSON: no classes, no Dates, no undefined in arrays.

export type FileChangeKind =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'
  | 'typechange'

export type ChangedFile = {
  path: string
  /** The path before a rename or copy. */
  oldPath?: string
  kind: FileChangeKind
}

export type Upstream = {
  /** Short name, such as `origin/main`. */
  name: string
  remote: string
  ahead: number
  behind: number
  /** The upstream branch was deleted on the remote. */
  gone: boolean
}

export type Head =
  | { kind: 'branch'; name: string; upstream: Upstream | null }
  | { kind: 'detached'; sha: string }
  | { kind: 'unborn'; name: string }

export type InProgressOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert'

export type RemoteInfo = {
  name: string
  url: string
  /** Browser address of the repository, when the host is known (GitHub, GitLab, Bitbucket). */
  webUrl: string | null
  host: 'github' | 'gitlab' | 'bitbucket' | 'other'
}

export type RepoSnapshot = {
  root: string
  repoName: string
  workspaceName: string
  head: Head
  files: ChangedFile[]
  /** True when the untracked list was cut at its limit. */
  filesTruncated: boolean
  operation: InProgressOperation | null
  remote: RemoteInfo | null
  stashCount: number
  /** Epoch ms of the last fetch (FETCH_HEAD), null when never fetched. */
  lastFetchedAt: number | null
  /** The last commit on HEAD, used by Undo and Amend. */
  lastCommit: { sha: string; summary: string; pushed: boolean } | null
}

export type RepoState =
  | { kind: 'no-workspace' }
  | { kind: 'unsupported-host'; workspaceName: string; hostId: string }
  | { kind: 'not-a-repo'; workspaceName: string; path: string }
  | { kind: 'ready'; repo: RepoSnapshot }

export type FileDiff =
  | {
      kind: 'text'
      /** Fingerprint of `patch`: line selections are only valid against the same diff. */
      hash: string
      /** The raw `git diff` output for this one file. */
      patch: string
      /** Full file before and after, for syntax highlighting and expanding context. Null when the
       *  side does not exist or the file is too large to send. */
      oldText: string | null
      newText: string | null
    }
  | { kind: 'binary'; oldSize: number | null; newSize: number | null }
  | {
      kind: 'image'
      /** data: URLs. */
      oldImage: string | null
      newImage: string | null
      oldSize: number | null
      newSize: number | null
    }
  | { kind: 'too-large'; size: number }
  | { kind: 'conflicted'; text: string | null; ours: string; theirs: string }

export type Commit = {
  sha: string
  shortSha: string
  parents: string[]
  summary: string
  body: string
  authorName: string
  authorEmail: string
  /** Epoch ms. */
  authorDate: number
  committerName: string
  /** Epoch ms. */
  committerDate: number
  /** Tag and branch names that point at this commit, without HEAD. */
  refs: string[]
  /** True when the commit is not on the upstream yet. */
  unpushed: boolean
}

export type CommitFile = ChangedFile & { additions: number | null; deletions: number | null }

export type CommitDetails = {
  commit: Commit
  files: CommitFile[]
  coAuthors: { name: string; email: string }[]
}

export type Branch = {
  name: string
  /** `refs/heads/...` or `refs/remotes/...`. */
  ref: string
  remote: string | null
  upstream: string | null
  ahead: number
  behind: number
  lastCommitDate: number
  lastCommitSummary: string
  /** Another worktree that has this branch checked out; git refuses to check it out here. */
  worktreePath: string | null
}

export type BranchList = {
  current: string | null
  defaultBranch: string | null
  local: Branch[]
  remote: Branch[]
  /** Local branch names most recently checked out, newest first. */
  recent: string[]
}

export type Stash = {
  index: number
  /** `stash@{n}`. */
  ref: string
  message: string
  branch: string | null
  date: number
}

/** Which changed lines of a file go into a commit or get discarded. `lines` are ordinals of the
 *  changed (+ or -) lines in the file's patch, counted from 0, see `changedLineOrdinals`. */
export type LineSelection = { kind: 'all' } | { kind: 'lines'; hash: string; lines: number[] }

export type FileSelection = {
  path: string
  oldPath?: string
  kind: FileChangeKind
  selection: LineSelection
}

export type SyncOperation = 'fetch' | 'pull' | 'push'

/** Why a git operation failed, for messages and the actions offered next to them. */
export type FailureKind =
  /** Credentials or an SSH key are missing: the operation needs a terminal. */
  | 'auth'
  /** The remote has commits this branch lacks. */
  | 'rejected'
  /** The operation stopped on conflicts that need resolving. */
  | 'conflicts'
  /** Local changes would be overwritten. */
  | 'dirty'
  /** The line selection no longer matches the file on disk. */
  | 'stale'
  | 'hook'
  | 'other'

export type OpResult<T = null> =
  | { ok: true; value: T; message?: string }
  | {
      ok: false
      kind: FailureKind
      message: string
      /** Git's own output, shown under a disclosure. */
      detail: string
      /** The git command line that failed, for running it in a terminal. */
      command: string | null
    }

/** A running agent in the workspace that review notes can go to. */
export type AgentTarget = {
  terminalId: string
  title: string
  /** The agent kind Orca detected, such as `claude` or `codex`. */
  agent: string | null
  state: 'working' | 'blocked' | 'waiting' | 'done'
  /** When the agent entered `state`, in epoch milliseconds. */
  since: number
}

/** The open pull request of the current branch, as the person's `gh` CLI reports it. */
export type PullRequest = {
  number: number
  title: string
  url: string
  draft: boolean
  /** All checks together: any failure wins, then anything still running. Null without checks. */
  checks: 'passing' | 'failing' | 'pending' | null
  review: 'approved' | 'changes-requested' | 'review-required' | null
}
