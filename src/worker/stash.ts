// `stash.*`.
import type { OpResult, Stash } from '../shared/model'
import type { RequestInput, RequestOutput } from '../shared/protocol'
import { runOp } from './commit'
import { stashRef } from './diff'
import { gitFailure, hostError, ok } from './failure'
import { parseNameStatus } from './history'
import type { RepoContext } from './repo'

/** Parses `git stash list --format=%gd%x1f%gs%x1f%ct`. */
export function parseStashList(output: string): Stash[] {
  const stashes: Stash[] = []
  for (const line of output.split('\n')) {
    const [ref = '', subject = '', date = '0'] = line.split('\x1f')
    const index = /^stash@\{(\d+)\}$/.exec(ref)?.[1]
    if (index === undefined) continue
    // `On main: message` for a named stash, `WIP on main: 1a2b3c4 last commit` otherwise.
    const match = /^(?:WIP on|On) ([^:]+): (.*)$/s.exec(subject)
    const branch = match?.[1] && match[1] !== '(no branch)' ? match[1] : null
    stashes.push({
      index: Number(index),
      ref,
      message: match?.[2] ?? subject,
      branch,
      date: Number(date) * 1000
    })
  }
  return stashes
}

export async function listStashes(ctx: RepoContext): Promise<Stash[]> {
  const result = await ctx.git.run(['stash', 'list', '--format=%gd%x1f%gs%x1f%ct'], {
    readOnly: true
  })
  return result.exitCode === 0 ? parseStashList(result.stdout) : []
}

export async function pushStash(
  ctx: RepoContext,
  input: RequestInput<'stash.push'>
): Promise<OpResult> {
  const message = typeof input.message === 'string' ? input.message.trim() : ''
  if (message.includes('\0')) throw hostError('invalid_params', 'Bad stash message')
  const args = ['stash', 'push', '--include-untracked', ...(message ? ['-m', message] : [])]
  const result = await ctx.git.run(args)
  if (result.exitCode !== 0) return gitFailure(args, result)
  return /No local changes to save/.test(result.stdout)
    ? ok(null, 'There are no changes to stash.')
    : ok()
}

export async function applyStash(
  ctx: RepoContext,
  input: RequestInput<'stash.apply'>
): Promise<OpResult> {
  const ref = await stashRef(ctx, input.index)
  return runOp(ctx, ['stash', input.drop ? 'pop' : 'apply', ref])
}

export async function dropStash(
  ctx: RepoContext,
  input: RequestInput<'stash.drop'>
): Promise<OpResult> {
  return runOp(ctx, ['stash', 'drop', await stashRef(ctx, input.index)])
}

export async function stashFiles(
  ctx: RepoContext,
  input: RequestInput<'stash.files'>
): Promise<RequestOutput<'stash.files'>> {
  const ref = await stashRef(ctx, input.index)
  const output = await ctx.git.read(
    ['stash', 'show', '--name-status', '-z', '--include-untracked', ref],
    {
      readOnly: true
    }
  )
  return parseNameStatus(output)
}
