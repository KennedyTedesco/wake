// `commit.*` and `changes.*`: the GitHub Desktop model. The index is an implementation detail: a
// commit holds exactly the files and lines the person ticked, whatever was staged before.
import { access, appendFile, readFile, rm } from 'node:fs/promises'
import { isAbsolute, join, normalize, relative, sep } from 'node:path'
import { parsePatch } from '../shared/diff/parse'
import { buildPartialPatch } from '../shared/diff/patch'
import type { OpResult } from '../shared/model'
import type { RequestInput, RequestOutput, WorkingFileRef } from '../shared/protocol'
import { patchHash, requirePath, resolveCommit, workingPatch } from './diff'
import { type Failure, failure, gitFailure, hostError, ok } from './failure'
import { type GitOptions, HOOK_TIMEOUT_MS } from './git'
import type { RepoContext } from './repo'
import { isAncestor, readStatus } from './status'

/** Runs a mutating git command and answers its `OpResult`. */
export async function runOp(
  ctx: RepoContext,
  args: readonly string[],
  options: GitOptions & { hookRan?: boolean; command?: string } = {}
): Promise<OpResult> {
  const result = await ctx.git.run(args, options)
  return result.exitCode === 0 ? ok() : gitFailure(args, result, options)
}

/** Runs a command that takes a list of paths on stdin, so any number of them fits. */
function pathsOnStdin(args: readonly string[], paths: readonly string[]) {
  return {
    args: [...args, '--pathspec-from-file=-', '--pathspec-file-nul'],
    stdin: paths.map((path) => `${path}\0`).join('')
  }
}

async function runWithPaths(ctx: RepoContext, args: readonly string[], paths: readonly string[]) {
  if (paths.length === 0) return ok()
  const command = pathsOnStdin(args, paths)
  return runOp(ctx, command.args, { stdin: command.stdin, literalPaths: true })
}

async function hasHead(ctx: RepoContext): Promise<boolean> {
  const result = await ctx.git.run(['rev-parse', '--verify', '-q', 'HEAD'], { readOnly: true })
  return result.exitCode === 0
}

export function splitMessage(message: string): { summary: string; description: string } {
  const lines = message.replace(/\r\n/g, '\n').trim().split('\n')
  return { summary: lines[0]?.trim() ?? '', description: lines.slice(1).join('\n').trim() }
}

const STALE_MESSAGE = (path: string) => `${path} changed since you selected lines. Review it again.`

/** The partial patch for a line selection, or a stale failure when the file changed since the
 *  panel read its diff. Null when the selection holds no change. */
async function selectionPatch(
  ctx: RepoContext,
  file: WorkingFileRef,
  hash: string,
  lines: readonly number[],
  mode: 'stage' | 'discard'
): Promise<{ patch: string | null } | Failure> {
  const { patch } = await workingPatch(ctx, file)
  if (patchHash(patch) !== hash) return failure('stale', STALE_MESSAGE(file.path))
  try {
    return { patch: buildPartialPatch(parsePatch(patch), new Set(lines), mode) }
  } catch (error) {
    throw hostError('invalid_params', error instanceof Error ? error.message : String(error))
  }
}

async function hookInstalled(ctx: RepoContext): Promise<boolean> {
  const configured = (
    await ctx.git.run(['config', '--path', 'core.hooksPath'], { readOnly: true })
  ).stdout.trim()
  const dir = configured
    ? isAbsolute(configured)
      ? configured
      : join(ctx.root, configured)
    : join(ctx.commonDir, 'hooks')
  for (const hook of ['pre-commit', 'prepare-commit-msg', 'commit-msg']) {
    if (
      await access(join(dir, hook)).then(
        () => true,
        () => false
      )
    )
      return true
  }
  return false
}

export async function createCommit(
  ctx: RepoContext,
  input: RequestInput<'commit.create'>
): Promise<RequestOutput<'commit.create'>> {
  const summary = input.summary.trim()
  if (!summary && !input.amend) throw hostError('invalid_params', 'Write a summary first')
  if (!Array.isArray(input.files)) throw hostError('invalid_params', 'Bad file list')

  // Check every line selection before touching the index, so a stale one changes nothing.
  const partials: string[] = []
  const whole: string[] = []
  for (const file of input.files) {
    requirePath(file.path)
    if (file.selection.kind === 'all') {
      whole.push(file.path)
      if (file.oldPath) whole.push(file.oldPath)
      continue
    }
    const built = await selectionPatch(
      ctx,
      file,
      file.selection.hash,
      file.selection.lines,
      'stage'
    )
    if ('ok' in built) return built
    if (built.patch) partials.push(built.patch)
  }

  const reset = await resetIndex(ctx)
  if (!reset.ok) return reset
  const added = await runWithPaths(ctx, ['add', '-A'], whole)
  if (!added.ok) return added
  for (const patch of partials) {
    const applied = await runOp(ctx, ['apply', '--cached', '--whitespace=nowarn', '-'], {
      stdin: patch
    })
    if (!applied.ok) return applied
  }

  const message = input.description.trim() ? `${summary}\n\n${input.description.trim()}` : summary
  const args = [
    'commit',
    ...(input.amend ? ['--amend'] : []),
    ...(message ? ['-F', '-'] : ['--no-edit'])
  ]
  const result = await ctx.git.run(args, { stdin: message, timeoutMs: HOOK_TIMEOUT_MS })
  if (result.exitCode !== 0) {
    return gitFailure(args, result, { hookRan: await hookInstalled(ctx), command: 'git commit' })
  }
  const sha = (await ctx.git.read(['rev-parse', 'HEAD'], { readOnly: true })).trim()
  return ok({ sha })
}

/** Puts every changed path of the index back to HEAD, so it holds only what the commit adds. */
async function resetIndex(ctx: RepoContext): Promise<OpResult> {
  const status = await readStatus(ctx, Number.POSITIVE_INFINITY)
  const paths = status.files
    .filter((file) => file.kind !== 'untracked')
    .flatMap((file) => (file.oldPath ? [file.path, file.oldPath] : [file.path]))
  if (await hasHead(ctx)) return runWithPaths(ctx, ['reset', '-q'], paths)
  return runWithPaths(ctx, ['rm', '--cached', '-r', '-q', '--ignore-unmatch'], paths)
}

export async function undoCommit(ctx: RepoContext): Promise<RequestOutput<'commit.undo'>> {
  if (!(await hasHead(ctx))) return failure('other', 'There is no commit to undo.')
  const upstream = await ctx.git.run(['rev-parse', '--verify', '-q', '@{upstream}'], {
    readOnly: true
  })
  if (upstream.exitCode === 0 && (await isAncestor(ctx, 'HEAD', '@{upstream}'))) {
    return failure(
      'other',
      'This commit is already pushed, so it cannot be undone. Revert it instead.'
    )
  }
  const message = splitMessage(
    await ctx.git.read(['log', '-1', '--format=%B', 'HEAD'], { readOnly: true })
  )
  const hasParent =
    (await ctx.git.run(['rev-parse', '--verify', '-q', 'HEAD^1'], { readOnly: true })).exitCode ===
    0
  const undone = hasParent
    ? await runOp(ctx, ['reset', '--soft', 'HEAD~1'])
    : await runOp(ctx, ['update-ref', '-d', 'HEAD'])
  return undone.ok ? ok(message) : undone
}

export async function lastMessage(ctx: RepoContext): Promise<RequestOutput<'commit.lastMessage'>> {
  if (!(await hasHead(ctx))) return { summary: '', description: '' }
  return splitMessage(await ctx.git.read(['log', '-1', '--format=%B', 'HEAD'], { readOnly: true }))
}

export async function revertCommit(ctx: RepoContext, input: { sha: string }): Promise<OpResult> {
  const sha = await resolveCommit(ctx, input.sha)
  const parents = (
    await ctx.git.read(['rev-list', '--parents', '-n', '1', sha], { readOnly: true })
  )
    .trim()
    .split(' ')
  const mainline = parents.length > 2 ? ['-m', '1'] : []
  return runOp(ctx, ['revert', '--no-edit', ...mainline, sha], { timeoutMs: HOOK_TIMEOUT_MS })
}

export async function resetToCommit(ctx: RepoContext, input: { sha: string }): Promise<OpResult> {
  return runOp(ctx, ['reset', '-q', '--mixed', await resolveCommit(ctx, input.sha)])
}

export async function checkoutCommit(ctx: RepoContext, input: { sha: string }): Promise<OpResult> {
  return runOp(ctx, ['checkout', '-q', '--detach', await resolveCommit(ctx, input.sha)])
}

export async function cherryPick(ctx: RepoContext, input: { sha: string }): Promise<OpResult> {
  return runOp(ctx, ['cherry-pick', await resolveCommit(ctx, input.sha)], {
    timeoutMs: HOOK_TIMEOUT_MS
  })
}

/** The absolute path of a repository file, refusing any path that leaves the repository. */
export function insideRoot(ctx: RepoContext, path: string): string {
  requirePath(path)
  const full = join(ctx.root, normalize(path))
  const rel = relative(ctx.root, full)
  if (isAbsolute(path) || !rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw hostError('invalid_params', `${path} is outside the repository`)
  }
  return full
}

export async function discardChanges(
  ctx: RepoContext,
  input: RequestInput<'changes.discard'>
): Promise<OpResult> {
  if (!Array.isArray(input.files)) throw hostError('invalid_params', 'Bad file list')
  const headExists = await hasHead(ctx)
  const restore: string[] = []
  const unstage: string[] = []
  const remove: string[] = []
  for (const file of input.files) {
    insideRoot(ctx, file.path)
    if (file.oldPath) insideRoot(ctx, file.oldPath)
    if (file.kind === 'untracked') {
      remove.push(file.path)
    } else if (!headExists || file.kind === 'added') {
      unstage.push(file.path)
      remove.push(file.path)
    } else if (file.kind === 'renamed' || file.kind === 'copied') {
      if (file.oldPath) restore.push(file.oldPath)
      unstage.push(file.path)
      remove.push(file.path)
    } else {
      restore.push(file.path)
    }
  }

  const restored = await runWithPaths(
    ctx,
    ['restore', '--source=HEAD', '--staged', '--worktree'],
    restore
  )
  if (!restored.ok) return restored
  const unstaged = await runWithPaths(
    ctx,
    ['rm', '--cached', '-r', '-q', '-f', '--ignore-unmatch'],
    unstage
  )
  if (!unstaged.ok) return unstaged
  for (const path of remove) await rm(insideRoot(ctx, path), { force: true, recursive: true })
  return ok()
}

export async function discardLines(
  ctx: RepoContext,
  input: RequestInput<'changes.discardLines'>
): Promise<OpResult> {
  const { file } = input
  requirePath(file.path)
  if (file.kind === 'deleted') throw hostError('invalid_params', 'Restore the whole file instead')
  if (!Array.isArray(input.lines)) throw hostError('invalid_params', 'Bad line list')
  const built = await selectionPatch(ctx, file, input.hash, input.lines, 'discard')
  if ('ok' in built) return built
  if (!built.patch) return ok()
  return runOp(ctx, ['apply', '--reverse', '--whitespace=nowarn', '-'], { stdin: built.patch })
}

export async function ignorePattern(
  ctx: RepoContext,
  input: RequestInput<'changes.ignore'>
): Promise<OpResult> {
  const pattern = typeof input.pattern === 'string' ? input.pattern.trim() : ''
  if (!pattern || /[\r\n\0]/.test(pattern)) throw hostError('invalid_params', 'Bad ignore pattern')
  const file = join(ctx.root, '.gitignore')
  const current = await readFile(file, 'utf8').catch(() => '')
  const lines = current.split(/\r?\n/)
  if (lines.includes(pattern)) return ok()
  const separator = current && !current.endsWith('\n') ? '\n' : ''
  await appendFile(file, `${separator}${pattern}\n`)
  return ok()
}
