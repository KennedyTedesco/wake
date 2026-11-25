// `repo.state`: the working tree's changes, the branch, and what is in progress.
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ChangedFile,
  FileChangeKind,
  Head,
  InProgressOperation,
  RemoteInfo,
  RepoSnapshot
} from '../shared/model'
import { type RepoContext, repoName } from './repo'

export const UNTRACKED_LIMIT = 5000

export type StatusBranch = {
  oid: string | null
  head: string | null
  upstream: string | null
  ahead: number
  behind: number
  hasAheadBehind: boolean
}

export type Status = {
  branch: StatusBranch
  files: ChangedFile[]
  truncated: boolean
}

/** Parses `git status --porcelain=v2 -z --branch`. */
export function parseStatus(output: string, untrackedLimit = UNTRACKED_LIMIT): Status {
  const branch: StatusBranch = {
    oid: null,
    head: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    hasAheadBehind: false
  }
  const files: ChangedFile[] = []
  let untracked = 0
  let truncated = false
  const fields = output.split('\0')

  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i] ?? ''
    if (entry.startsWith('# ')) {
      parseBranchLine(entry, branch)
      continue
    }
    const type = entry[0]
    if (type === '1') {
      // 1 XY sub mH mI mW hH hI path
      const parts = splitFields(entry, 9)
      files.push({ path: parts[8] ?? '', kind: trackedKind(parts[1] ?? '..') })
    } else if (type === '2') {
      // 2 XY sub mH mI mW hH hI Xscore path, then the original path in the next field
      const parts = splitFields(entry, 10)
      const xy = parts[1] ?? '..'
      const oldPath = fields[++i] ?? ''
      files.push({ path: parts[9] ?? '', oldPath, kind: trackedKind(xy, true) })
    } else if (type === 'u') {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const parts = splitFields(entry, 11)
      files.push({ path: parts[10] ?? '', kind: 'conflicted' })
    } else if (type === '?') {
      if (untracked >= untrackedLimit) {
        truncated = true
        continue
      }
      untracked++
      files.push({ path: entry.slice(2), kind: 'untracked' })
    }
  }
  return { branch, files, truncated }
}

/** Splits the first `count - 1` space-separated fields, leaving the path (which may hold spaces)
 *  whole as the last one. */
function splitFields(entry: string, count: number): string[] {
  const parts: string[] = []
  let start = 0
  for (let n = 0; n < count - 1; n++) {
    const space = entry.indexOf(' ', start)
    if (space < 0) break
    parts.push(entry.slice(start, space))
    start = space + 1
  }
  parts.push(entry.slice(start))
  return parts
}

function parseBranchLine(line: string, branch: StatusBranch) {
  const [, key, ...rest] = line.split(' ')
  const value = rest.join(' ')
  if (key === 'branch.oid') branch.oid = value === '(initial)' ? null : value
  else if (key === 'branch.head') branch.head = value === '(detached)' ? null : value
  else if (key === 'branch.upstream') branch.upstream = value
  else if (key === 'branch.ab') {
    const match = /^\+(\d+) -(\d+)$/.exec(value)
    branch.ahead = Number(match?.[1] ?? 0)
    branch.behind = Number(match?.[2] ?? 0)
    branch.hasAheadBehind = true
  }
}

function trackedKind(xy: string, renamed = false): FileChangeKind {
  const [x = '.', y = '.'] = xy
  if (renamed && (x === 'C' || y === 'C')) return 'copied'
  if (renamed) return 'renamed'
  if (x === 'A') return 'added'
  if (x === 'D' || y === 'D') return 'deleted'
  if (x === 'T' || y === 'T') return 'typechange'
  return 'modified'
}

export async function readStatus(ctx: RepoContext, untrackedLimit = UNTRACKED_LIMIT) {
  const output = await ctx.git.read(
    ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all', '--find-renames'],
    { readOnly: true }
  )
  return parseStatus(output, untrackedLimit)
}

export function readOperation(ctx: RepoContext): InProgressOperation | null {
  const has = (name: string) => existsSync(join(ctx.gitDir, name))
  if (has('rebase-merge') || has('rebase-apply')) return 'rebase'
  if (has('MERGE_HEAD')) return 'merge'
  if (has('CHERRY_PICK_HEAD')) return 'cherry-pick'
  if (has('REVERT_HEAD')) return 'revert'
  return null
}

export type RemoteConfig = {
  /** Remote name → fetch URL, in config order. */
  remotes: Map<string, string>
  /** Local branch name → the remote it tracks. */
  branchRemotes: Map<string, string>
  /** Local branch name → the ref it merges from (`refs/heads/x`). */
  branchMerges: Map<string, string>
}

export async function readRemoteConfig(ctx: RepoContext): Promise<RemoteConfig> {
  const output = await ctx.git.read(
    ['config', '-z', '--get-regexp', '^(remote\\..*\\.url|branch\\..*\\.(remote|merge))$'],
    { readOnly: true, okExitCodes: [1] }
  )
  const config: RemoteConfig = {
    remotes: new Map(),
    branchRemotes: new Map(),
    branchMerges: new Map()
  }
  for (const record of output.split('\0')) {
    const newline = record.indexOf('\n')
    if (newline < 0) continue
    const key = record.slice(0, newline)
    const value = record.slice(newline + 1)
    const remote = /^remote\.(.+)\.url$/.exec(key)
    if (remote?.[1] && !config.remotes.has(remote[1])) config.remotes.set(remote[1], value)
    const branch = /^branch\.(.+)\.(remote|merge)$/.exec(key)
    if (branch?.[1]) {
      const map = branch[2] === 'remote' ? config.branchRemotes : config.branchMerges
      map.set(branch[1], value)
    }
  }
  return config
}

/** The remote a branch syncs with: its upstream's, else `origin`, else the first one. */
export function pickRemote(config: RemoteConfig, branch: string | null): string | null {
  const tracked = branch ? config.branchRemotes.get(branch) : undefined
  if (tracked && config.remotes.has(tracked)) return tracked
  if (config.remotes.has('origin')) return 'origin'
  return config.remotes.keys().next().value ?? null
}

/** The browser address of a remote URL such as `git@github.com:o/r.git`, `https://host/o/r` or
 *  `ssh://git@host:22/o/r`. */
export function remoteInfo(name: string, url: string): RemoteInfo {
  const match = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/i.exec(
    url.trim()
  )
  const host = match?.[1]?.toLowerCase() ?? ''
  const path = match?.[2]?.replace(/^\/+/, '') ?? ''
  const kind: RemoteInfo['host'] = host.includes('github')
    ? 'github'
    : host.includes('gitlab')
      ? 'gitlab'
      : host.includes('bitbucket')
        ? 'bitbucket'
        : 'other'
  const isLocal =
    !match || url.startsWith('/') || url.startsWith('file:') || /^[A-Za-z]:[\\/]/.test(url)
  const webUrl = !isLocal && kind !== 'other' && path ? `https://${host}/${path}` : null
  return { name, url, webUrl, host: kind }
}

/** The remote part of an upstream name like `origin/feature/x`, knowing the remotes. */
export function splitRemoteRef(
  shortName: string,
  remotes: Iterable<string>
): { remote: string; branch: string } | null {
  let best: string | null = null
  for (const remote of remotes) {
    if (shortName.startsWith(`${remote}/`) && (!best || remote.length > best.length)) best = remote
  }
  return best ? { remote: best, branch: shortName.slice(best.length + 1) } : null
}

function toHead(branch: StatusBranch, config: RemoteConfig): Head {
  if (branch.head === null) return { kind: 'detached', sha: branch.oid ?? '' }
  if (branch.oid === null) return { kind: 'unborn', name: branch.head }
  if (!branch.upstream) return { kind: 'branch', name: branch.head, upstream: null }
  const remote =
    config.branchRemotes.get(branch.head) ??
    splitRemoteRef(branch.upstream, config.remotes.keys())?.remote ??
    '.'
  return {
    kind: 'branch',
    name: branch.head,
    upstream: {
      name: branch.upstream,
      remote,
      ahead: branch.ahead,
      behind: branch.behind,
      gone: !branch.hasAheadBehind
    }
  }
}

async function countStashes(ctx: RepoContext): Promise<number> {
  const result = await ctx.git.run(['rev-list', '--walk-reflogs', '--count', 'refs/stash'], {
    readOnly: true
  })
  return result.exitCode === 0 ? Number(result.stdout.trim()) || 0 : 0
}

function lastFetchedAt(ctx: RepoContext): number | null {
  try {
    return statSync(join(ctx.commonDir, 'FETCH_HEAD')).mtimeMs
  } catch {
    return null
  }
}

export async function isAncestor(ctx: RepoContext, commit: string, of: string): Promise<boolean> {
  const result = await ctx.git.run(['merge-base', '--is-ancestor', commit, of], { readOnly: true })
  return result.exitCode === 0
}

async function lastCommit(ctx: RepoContext, head: Head): Promise<RepoSnapshot['lastCommit']> {
  if (head.kind === 'unborn') return null
  const [subject, pushed] = await Promise.all([
    ctx.git.read(['log', '-1', '--format=%H%x1f%s', 'HEAD'], { readOnly: true }),
    head.kind === 'branch' && head.upstream && !head.upstream.gone
      ? isAncestor(ctx, 'HEAD', '@{upstream}')
      : Promise.resolve(false)
  ])
  const [sha = '', summary = ''] = subject.trim().split('\x1f')
  return { sha, summary, pushed }
}

export async function readSnapshot(ctx: RepoContext, workspaceName: string): Promise<RepoSnapshot> {
  const [status, config, stashCount] = await Promise.all([
    readStatus(ctx),
    readRemoteConfig(ctx),
    countStashes(ctx)
  ])
  const head = toHead(status.branch, config)
  const remoteName = pickRemote(config, head.kind === 'branch' ? head.name : null)
  const remoteUrl = remoteName ? config.remotes.get(remoteName) : undefined
  return {
    root: ctx.root,
    repoName: repoName(ctx),
    workspaceName,
    head,
    files: status.files,
    filesTruncated: status.truncated,
    operation: readOperation(ctx),
    remote: remoteName && remoteUrl !== undefined ? remoteInfo(remoteName, remoteUrl) : null,
    stashCount,
    lastFetchedAt: lastFetchedAt(ctx),
    lastCommit: await lastCommit(ctx, head)
  }
}
