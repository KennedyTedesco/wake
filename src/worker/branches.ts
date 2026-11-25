// `branch.*` and `tag.create`.
import { realpathSync } from 'node:fs'
import type { Branch, OpResult } from '../shared/model'
import type { RequestInput, RequestOutput } from '../shared/protocol'
import { runOp } from './commit'
import { requireRev, resolveCommit } from './diff'
import { failure, hostError } from './failure'
import { HOOK_TIMEOUT_MS, NETWORK_TIMEOUT_MS } from './git'
import type { RepoContext } from './repo'
import { readRemoteConfig, splitRemoteRef } from './status'

const REF_FORMAT = [
  '%(refname)',
  '%(refname:short)',
  '%(upstream:short)',
  '%(upstream:track,nobracket)',
  '%(committerdate:unix)',
  '%(contents:subject)',
  '%(worktreepath)'
].join('%1f')
const RECENT_LIMIT = 5

function samePath(a: string, b: string): boolean {
  const real = (path: string) => {
    try {
      return realpathSync(path)
    } catch {
      return path
    }
  }
  return real(a) === real(b)
}

function parseTrack(track: string): { ahead: number; behind: number } {
  return {
    ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0)
  }
}

async function currentBranch(ctx: RepoContext): Promise<string | null> {
  const result = await ctx.git.run(['symbolic-ref', '--short', '-q', 'HEAD'], { readOnly: true })
  return result.exitCode === 0 ? result.stdout.trim() : null
}

export async function listBranches(ctx: RepoContext): Promise<RequestOutput<'branch.list'>> {
  const [refs, current, config, reflog] = await Promise.all([
    ctx.git.read(['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes'], {
      readOnly: true
    }),
    currentBranch(ctx),
    readRemoteConfig(ctx),
    ctx.git.run(['reflog', 'show', '-n', '200', '--format=%gs', 'HEAD', '--'], { readOnly: true })
  ])
  const remotes = [...config.remotes.keys()]
  const local: Branch[] = []
  const remote: Branch[] = []
  for (const line of refs.split('\n')) {
    const [
      ref = '',
      name = '',
      upstream = '',
      track = '',
      date = '0',
      subject = '',
      worktree = ''
    ] = line.split('\x1f')
    if (!ref || ref.endsWith('/HEAD')) continue
    const isRemote = ref.startsWith('refs/remotes/')
    const branch: Branch = {
      name,
      ref,
      remote: isRemote ? (splitRemoteRef(name, remotes)?.remote ?? null) : null,
      upstream: upstream || null,
      ...parseTrack(track),
      lastCommitDate: Number(date) * 1000,
      lastCommitSummary: subject,
      worktreePath: worktree && !samePath(worktree, ctx.root) ? worktree : null
    }
    ;(isRemote ? remote : local).push(branch)
  }

  const localNames = new Set(local.map((branch) => branch.name))
  return {
    current,
    defaultBranch: await defaultBranch(
      ctx,
      config.branchRemotes.get(current ?? ''),
      remotes,
      localNames
    ),
    local,
    remote,
    recent: recentBranches(reflog.exitCode === 0 ? reflog.stdout : '', localNames, current)
  }
}

async function defaultBranch(
  ctx: RepoContext,
  trackedRemote: string | undefined,
  remotes: string[],
  localNames: ReadonlySet<string>
): Promise<string | null> {
  const remote = trackedRemote ?? (remotes.includes('origin') ? 'origin' : remotes[0])
  if (remote) {
    const result = await ctx.git.run(
      ['symbolic-ref', '--short', '-q', `refs/remotes/${remote}/HEAD`],
      {
        readOnly: true
      }
    )
    const target = result.stdout.trim()
    if (result.exitCode === 0 && target.startsWith(`${remote}/`))
      return target.slice(remote.length + 1)
  }
  if (localNames.has('main')) return 'main'
  if (localNames.has('master')) return 'master'
  return null
}

/** Local branches most recently switched to, newest first, from HEAD's reflog. */
export function recentBranches(
  reflog: string,
  localNames: ReadonlySet<string>,
  current: string | null
): string[] {
  const recent: string[] = []
  for (const line of reflog.split('\n')) {
    const name = /^checkout: moving from .+ to (.+)$/.exec(line)?.[1]
    if (!name || name === current || !localNames.has(name) || recent.includes(name)) continue
    recent.push(name)
    if (recent.length === RECENT_LIMIT) break
  }
  return recent
}

async function invalidName(
  ctx: RepoContext,
  name: string,
  kind: 'branch' | 'tag'
): Promise<OpResult | null> {
  if (typeof name !== 'string' || !name || name.startsWith('-')) {
    throw hostError('invalid_params', `Bad ${kind} name`)
  }
  const args =
    kind === 'branch'
      ? ['check-ref-format', '--branch', name]
      : ['check-ref-format', `refs/tags/${name}`]
  const result = await ctx.git.run(args, { readOnly: true })
  return result.exitCode === 0 ? null : failure('other', `${name} is not a valid ${kind} name.`)
}

async function localBranchExists(ctx: RepoContext, name: string): Promise<boolean> {
  const result = await ctx.git.run(['show-ref', '--verify', '-q', `refs/heads/${name}`], {
    readOnly: true
  })
  return result.exitCode === 0
}

export async function checkoutBranch(
  ctx: RepoContext,
  input: RequestInput<'branch.checkout'>
): Promise<OpResult> {
  requireRev(input.name)
  if (!input.remote) return runOp(ctx, ['switch', input.name])
  const { remotes } = await readRemoteConfig(ctx)
  const split = splitRemoteRef(input.name, remotes.keys())
  if (!split) throw hostError('invalid_params', `${input.name} is not a remote branch`)
  if (await localBranchExists(ctx, split.branch)) return runOp(ctx, ['switch', split.branch])
  return runOp(ctx, ['switch', '--track', input.name])
}

export async function createBranch(
  ctx: RepoContext,
  input: RequestInput<'branch.create'>
): Promise<OpResult> {
  const invalid = await invalidName(ctx, input.name, 'branch')
  if (invalid) return invalid
  const start = input.startPoint ? [await resolveCommit(ctx, input.startPoint)] : []
  return runOp(ctx, ['switch', '-c', input.name, ...start])
}

export async function renameBranch(
  ctx: RepoContext,
  input: RequestInput<'branch.rename'>
): Promise<OpResult> {
  requireRev(input.from)
  const invalid = await invalidName(ctx, input.to, 'branch')
  if (invalid) return invalid
  return runOp(ctx, ['branch', '-m', input.from, input.to])
}

export async function deleteBranch(
  ctx: RepoContext,
  input: RequestInput<'branch.delete'>
): Promise<OpResult> {
  requireRev(input.name)
  // Read the upstream first: deleting the branch deletes its config too.
  const config = await readRemoteConfig(ctx)
  const remote = config.branchRemotes.get(input.name)
  const merge = config.branchMerges.get(input.name)
  const deleted = await runOp(ctx, ['branch', input.force ? '-D' : '-d', input.name])
  if (!deleted.ok || !input.deleteRemote || !remote || remote === '.' || !merge) return deleted
  const remoteBranch = merge.replace(/^refs\/heads\//, '')
  return runOp(ctx, ['push', remote, '--delete', remoteBranch], { timeoutMs: NETWORK_TIMEOUT_MS })
}

export async function mergeBranch(
  ctx: RepoContext,
  input: RequestInput<'branch.merge'>
): Promise<OpResult> {
  requireRev(input.name)
  return runOp(ctx, ['merge', '--no-edit', input.name], { timeoutMs: HOOK_TIMEOUT_MS })
}

export async function createTag(
  ctx: RepoContext,
  input: RequestInput<'tag.create'>
): Promise<OpResult> {
  const invalid = await invalidName(ctx, input.name, 'tag')
  if (invalid) return invalid
  return runOp(ctx, ['tag', input.name, await resolveCommit(ctx, input.sha)])
}
