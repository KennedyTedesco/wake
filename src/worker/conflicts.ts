// `operation.*` and `conflict.resolve`: finishing or leaving a merge, rebase, cherry-pick or revert.
import { readFile } from 'node:fs/promises'
import type { OpResult } from '../shared/model'
import type { RequestInput } from '../shared/protocol'
import { insideRoot, runOp } from './commit'
import { failure, gitFailure } from './failure'
import { HOOK_TIMEOUT_MS } from './git'
import type { RepoContext } from './repo'
import { readOperation, readStatus } from './status'

const CONFLICT_MARKERS = /^(?:<{7}|>{7})(?: |$)/m
const NO_EDITOR = { GIT_EDITOR: 'true' }

export async function abortOperation(ctx: RepoContext): Promise<OpResult> {
  const operation = readOperation(ctx)
  if (!operation) return failure('other', 'Nothing is in progress.')
  return runOp(ctx, [operation, '--abort'])
}

export async function continueOperation(ctx: RepoContext): Promise<OpResult> {
  const operation = readOperation(ctx)
  if (!operation) return failure('other', 'Nothing is in progress.')
  const status = await readStatus(ctx)
  const conflicted = status.files.filter((file) => file.kind === 'conflicted')
  if (conflicted.length > 0) {
    const names = conflicted.map((file) => file.path).join(', ')
    return failure('conflicts', `Resolve the conflicts first: ${names}.`)
  }
  const options = { env: NO_EDITOR, timeoutMs: HOOK_TIMEOUT_MS }
  if (operation === 'merge') return runOp(ctx, ['commit', '--no-edit'], options)
  return runOp(ctx, [operation, '--continue'], options)
}

export async function resolveConflict(
  ctx: RepoContext,
  input: RequestInput<'conflict.resolve'>
): Promise<OpResult> {
  const full = insideRoot(ctx, input.path)
  const literal = { literalPaths: true }
  if (input.using === 'working') {
    const content = await readFile(full, 'utf8').catch(() => null)
    if (content !== null && CONFLICT_MARKERS.test(content)) {
      return failure('conflicts', 'Resolve the conflict markers first.')
    }
    return runOp(ctx, ['add', '-A', '--', input.path], literal)
  }
  const side = input.using === 'ours' ? '--ours' : '--theirs'
  const args = ['checkout', side, '--', input.path]
  const checkedOut = await ctx.git.run(args, literal)
  if (checkedOut.exitCode !== 0) {
    // That side deleted the file: taking it means deleting the file.
    if (/does not have (?:our|their) version/.test(checkedOut.stderr)) {
      return runOp(ctx, ['rm', '-q', '-f', '--', input.path], literal)
    }
    return gitFailure(args, checkedOut)
  }
  return runOp(ctx, ['add', '--', input.path], literal)
}
