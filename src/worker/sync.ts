// `sync.*`: fetch, pull, push and publish, reporting git's progress as it goes.
import type { OpResult, SyncOperation } from '../shared/model'
import type { RequestInput } from '../shared/protocol'
import { runOp } from './commit'
import { failure } from './failure'
import { NETWORK_TIMEOUT_MS } from './git'
import type { RepoContext, SyncProgress } from './repo'
import { pickRemote, readRemoteConfig } from './status'

const PROGRESS_INTERVAL_MS = 100
const NO_REMOTE = 'This repository has no remote.'

/** The last progress line of a stderr chunk, such as `Receiving objects:  45% (9/20)`. */
export function parseProgress(chunk: string): { text: string; percent: number | null } | null {
  const lines = chunk
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter(Boolean)
  const text = lines.at(-1)?.replace(/^remote:\s*/, '')
  if (!text) return null
  const percent = /:\s+(\d{1,3})%/.exec(text)?.[1]
  return { text, percent: percent === undefined ? null : Number(percent) }
}

/** Sends progress at most every 100 ms, always ending with the latest line. */
function progressReporter(op: SyncOperation, send: ((progress: SyncProgress) => void) | undefined) {
  let lastSent = 0
  let pending: SyncProgress | null = null
  let timer: NodeJS.Timeout | undefined
  const flush = () => {
    timer = undefined
    if (!pending || !send) return
    send(pending)
    pending = null
    lastSent = Date.now()
  }
  return {
    onStderr(chunk: string) {
      const parsed = parseProgress(chunk)
      if (!parsed || !send) return
      pending = { op, ...parsed }
      const wait = PROGRESS_INTERVAL_MS - (Date.now() - lastSent)
      if (wait <= 0) flush()
      else timer ??= setTimeout(flush, wait)
    },
    done() {
      clearTimeout(timer)
      flush()
    }
  }
}

async function runNetwork(
  ctx: RepoContext,
  op: SyncOperation,
  args: string[],
  command: string
): Promise<OpResult> {
  const progress = progressReporter(op, ctx.onProgress)
  try {
    return await runOp(ctx, args, {
      timeoutMs: NETWORK_TIMEOUT_MS,
      onStderr: progress.onStderr,
      command
    })
  } finally {
    progress.done()
  }
}

type Tracking = {
  branch: string | null
  remote: string | null
  merge: string | null
  anyRemote: string | null
}

async function readTracking(ctx: RepoContext): Promise<Tracking> {
  const [head, config] = await Promise.all([
    ctx.git.run(['symbolic-ref', '--short', '-q', 'HEAD'], { readOnly: true }),
    readRemoteConfig(ctx)
  ])
  const branch = head.exitCode === 0 ? head.stdout.trim() : null
  const remote = branch ? (config.branchRemotes.get(branch) ?? null) : null
  const merge = branch ? (config.branchMerges.get(branch) ?? null) : null
  return { branch, remote, merge, anyRemote: pickRemote(config, branch) }
}

async function hasConfig(ctx: RepoContext, key: string): Promise<boolean> {
  const result = await ctx.git.run(['config', '--get', key], { readOnly: true })
  return result.exitCode === 0
}

export async function fetchRemote(ctx: RepoContext, quiet = false): Promise<OpResult> {
  const tracking = await readTracking(ctx)
  if (!tracking.anyRemote) return failure('other', NO_REMOTE)
  const target = tracking.remote && tracking.remote !== '.' ? [tracking.remote] : ['--all']
  const args = ['fetch', '--prune', ...(quiet ? ['--quiet'] : ['--progress']), ...target]
  if (quiet) return runOp(ctx, args, { timeoutMs: NETWORK_TIMEOUT_MS, command: 'git fetch' })
  return runNetwork(ctx, 'fetch', args, 'git fetch')
}

export async function pull(ctx: RepoContext): Promise<OpResult> {
  const tracking = await readTracking(ctx)
  if (!tracking.branch) return failure('other', 'Switch to a branch to pull.')
  if (!tracking.remote || !tracking.merge) {
    return failure(
      'other',
      `${tracking.branch} has no upstream branch to pull from. Publish it first.`
    )
  }
  const [rebase, ff] = await Promise.all([hasConfig(ctx, 'pull.rebase'), hasConfig(ctx, 'pull.ff')])
  // Recent git refuses to pull a diverged branch until told how; Desktop merges.
  const strategy = rebase || ff ? [] : ['--no-rebase']
  return runNetwork(ctx, 'pull', ['pull', '--progress', ...strategy], 'git pull')
}

export async function push(ctx: RepoContext, force = false): Promise<OpResult> {
  const tracking = await readTracking(ctx)
  if (!tracking.branch) return failure('other', 'Switch to a branch to push.')
  if (!tracking.remote || !tracking.merge || tracking.remote === '.') return publish(ctx)
  const lease = force ? ['--force-with-lease'] : []
  const args = [
    'push',
    '--progress',
    ...lease,
    tracking.remote,
    `refs/heads/${tracking.branch}:${tracking.merge}`
  ]
  return runNetwork(ctx, 'push', args, force ? 'git push --force-with-lease' : 'git push')
}

export async function publish(ctx: RepoContext): Promise<OpResult> {
  const tracking = await readTracking(ctx)
  if (!tracking.branch) return failure('other', 'Switch to a branch to publish.')
  if (!tracking.anyRemote) return failure('other', NO_REMOTE)
  const args = [
    'push',
    '--progress',
    '--set-upstream',
    tracking.anyRemote,
    `refs/heads/${tracking.branch}:refs/heads/${tracking.branch}`
  ]
  return runNetwork(
    ctx,
    'push',
    args,
    `git push --set-upstream ${tracking.anyRemote} ${tracking.branch}`
  )
}

export async function runSync(
  ctx: RepoContext,
  input: RequestInput<'sync.run'>
): Promise<OpResult> {
  if (input.op === 'fetch') return fetchRemote(ctx)
  if (input.op === 'pull') return pull(ctx)
  if (input.op === 'push') return push(ctx, input.force === true)
  return failure('other', 'Unknown sync operation.')
}
