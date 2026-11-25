// `diff.*`: one file's diff, with both full sides for syntax highlighting, or the image or binary
// stand-in when a text diff makes no sense.
import { createHash } from 'node:crypto'
import { lstat, readFile, readlink } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { ChangedFile, FileDiff } from '../shared/model'
import type { DiffOptions, RequestInput, WorkingFileRef } from '../shared/protocol'
import { hostError } from './failure'
import { EMPTY_TREE, type RepoContext } from './repo'
import { readOperation } from './status'

/** Answers stay under the 1 MiB request limit with room for JSON escaping. */
const MAX_DIFF_BYTES = 700 * 1024
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif'
}

// Histogram anchors hunks on lines that occur rarely, so a change to one function no longer
// borrows braces and blank lines from its neighbours as Myers does. Selections and their hashes
// are always made against this same diff.
const DIFF_ARGS = [
  'diff',
  '--no-ext-diff',
  '--no-color',
  '--find-renames',
  '--diff-algorithm=histogram',
  '--indent-heuristic'
]

/** One side of a diff: a blob in git, a file on disk, or nothing. */
type Side = { read(): Promise<Buffer | null>; size(): Promise<number | null> }

const NO_SIDE: Side = { read: async () => null, size: async () => null }

function blobSide(ctx: RepoContext, rev: string, path: string): Side {
  const spec = `${rev}:${path}`
  return {
    async read() {
      const output = await ctx.git.exec(['cat-file', 'blob', spec], { readOnly: true })
      return output.exitCode === 0 ? output.stdout : null
    },
    async size() {
      const result = await ctx.git.run(['cat-file', '-s', spec], { readOnly: true })
      return result.exitCode === 0 ? Number(result.stdout.trim()) : null
    }
  }
}

function fileSide(ctx: RepoContext, path: string): Side {
  const full = join(ctx.root, path)
  return {
    async read() {
      const stats = await lstat(full).catch(() => null)
      if (!stats) return null
      if (stats.isSymbolicLink()) return Buffer.from(await readlink(full))
      if (!stats.isFile()) return null
      return readFile(full)
    },
    async size() {
      const stats = await lstat(full).catch(() => null)
      return stats?.size ?? null
    }
  }
}

export function patchHash(patch: string): string {
  return createHash('sha1').update(patch).digest('hex')
}

function isBinaryPatch(patch: string): boolean {
  return /^(?:Binary files .* differ|GIT binary patch)$/m.test(patch)
}

const asText = (buffer: Buffer | null) =>
  buffer === null || buffer.includes(0) ? null : buffer.toString('utf8')

async function toFileDiff(
  path: string,
  patch: string,
  oldSide: Side,
  newSide: Side
): Promise<FileDiff> {
  if (isBinaryPatch(patch)) {
    const mime = IMAGE_TYPES[extname(path).toLowerCase()]
    const [oldSize, newSize] = await Promise.all([oldSide.size(), newSide.size()])
    if (!mime) return { kind: 'binary', oldSize, newSize }
    const dataUrl = async (side: Side, size: number | null) => {
      if (size === null || size > MAX_IMAGE_BYTES) return null
      const buffer = await side.read()
      return buffer ? `data:${mime};base64,${buffer.toString('base64')}` : null
    }
    const [oldImage, newImage] = await Promise.all([
      dataUrl(oldSide, oldSize),
      dataUrl(newSide, newSize)
    ])
    return { kind: 'image', oldImage, newImage, oldSize, newSize }
  }

  const patchBytes = Buffer.byteLength(patch)
  if (patchBytes > MAX_DIFF_BYTES) return { kind: 'too-large', size: patchBytes }
  const [oldSize, newSize] = await Promise.all([oldSide.size(), newSide.size()])
  const room = MAX_DIFF_BYTES - patchBytes
  const fits = (oldSize ?? 0) + (newSize ?? 0) <= room
  const [oldText, newText] = fits
    ? await Promise.all([oldSide.read().then(asText), newSide.read().then(asText)])
    : [null, null]
  return { kind: 'text', hash: patchHash(patch), patch, oldText, newText }
}

async function headExists(ctx: RepoContext): Promise<boolean> {
  const result = await ctx.git.run(['rev-parse', '--verify', '-q', 'HEAD'], { readOnly: true })
  return result.exitCode === 0
}

/** The patch of one changed file, HEAD against the working tree. Untracked files (and files of
 *  an unborn branch that only the working tree has) diff against /dev/null. */
export async function workingPatch(
  ctx: RepoContext,
  file: WorkingFileRef,
  ignoreWhitespace = false
): Promise<{ patch: string; base: string | null }> {
  const whitespace = ignoreWhitespace ? ['-w'] : []
  if (file.kind === 'untracked') {
    const patch = await ctx.git.read(
      [...DIFF_ARGS, '--no-index', ...whitespace, '--', '/dev/null', file.path],
      { readOnly: true, okExitCodes: [1] }
    )
    return { patch, base: null }
  }
  const base = (await headExists(ctx)) ? 'HEAD' : null
  const paths = file.oldPath ? [file.oldPath, file.path] : [file.path]
  const patch = await ctx.git.read(
    [...DIFF_ARGS, ...whitespace, base ?? EMPTY_TREE, '--', ...paths],
    {
      readOnly: true,
      literalPaths: true
    }
  )
  return { patch, base }
}

export async function workingDiff(
  ctx: RepoContext,
  input: RequestInput<'diff.working'>
): Promise<FileDiff> {
  const { file } = input
  requirePath(file.path)
  if (file.kind === 'conflicted') return conflictedDiff(ctx, file.path)
  const { patch, base } = await workingPatch(ctx, file, input.ignoreWhitespace)
  const oldPath = file.oldPath ?? file.path
  const hasOld = base !== null && file.kind !== 'added' && file.kind !== 'untracked'
  const oldSide = hasOld ? blobSide(ctx, base, oldPath) : NO_SIDE
  const newSide = file.kind === 'deleted' ? NO_SIDE : fileSide(ctx, file.path)
  return toFileDiff(file.path, patch, oldSide, newSide)
}

const CONFLICT_HEADS: [string, string][] = [
  ['MERGE_HEAD', 'merge'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
  ['REBASE_HEAD', 'rebase']
]

async function conflictedDiff(ctx: RepoContext, path: string): Promise<FileDiff> {
  const [content, ours, theirs] = await Promise.all([
    fileSide(ctx, path).read(),
    ctx.git
      .run(['symbolic-ref', '--short', '-q', 'HEAD'], { readOnly: true })
      .then((result) => result.stdout.trim() || 'HEAD'),
    theirsName(ctx)
  ])
  const text = content && content.length <= MAX_DIFF_BYTES ? asText(content) : null
  return { kind: 'conflicted', text, ours, theirs }
}

/** The branch name (or short sha) of the commit being merged, picked or reverted in. */
async function theirsName(ctx: RepoContext): Promise<string> {
  if (readOperation(ctx) === null) return 'stash'
  for (const [head] of CONFLICT_HEADS) {
    const sha = await ctx.git.run(['rev-parse', '--verify', '-q', head], { readOnly: true })
    if (sha.exitCode !== 0) continue
    const name = await ctx.git.run(
      ['name-rev', '--name-only', '--no-undefined', '--refs=refs/heads/*', sha.stdout.trim()],
      { readOnly: true }
    )
    if (name.exitCode === 0 && !/[~^]/.test(name.stdout)) return name.stdout.trim()
    return sha.stdout.trim().slice(0, 7)
  }
  return 'theirs'
}

/** Diffs one file between two commits or trees. */
async function treeDiff(
  ctx: RepoContext,
  from: string,
  to: string,
  file: Pick<ChangedFile, 'path' | 'oldPath'>,
  options: DiffOptions
): Promise<FileDiff> {
  const paths = file.oldPath ? [file.oldPath, file.path] : [file.path]
  const patch = await ctx.git.read(
    [...DIFF_ARGS, ...(options.ignoreWhitespace ? ['-w'] : []), from, to, '--', ...paths],
    { readOnly: true, literalPaths: true }
  )
  const isNew = /^new file mode /m.test(patch)
  const isDeleted = /^deleted file mode /m.test(patch)
  const oldSide = isNew ? NO_SIDE : blobSide(ctx, from, file.oldPath ?? file.path)
  const newSide = isDeleted ? NO_SIDE : blobSide(ctx, to, file.path)
  return toFileDiff(file.path, patch, oldSide, newSide)
}

/** A commit's first parent, or the empty tree for a root commit. */
export async function firstParent(ctx: RepoContext, sha: string): Promise<string> {
  const result = await ctx.git.run(['rev-parse', '--verify', '-q', `${sha}^1`], { readOnly: true })
  return result.exitCode === 0 ? result.stdout.trim() : EMPTY_TREE
}

export async function resolveCommit(ctx: RepoContext, rev: string): Promise<string> {
  requireRev(rev)
  const result = await ctx.git.run(['rev-parse', '--verify', '-q', `${rev}^{commit}`], {
    readOnly: true
  })
  if (result.exitCode !== 0) throw hostError('invalid_params', `${rev} is not a commit`)
  return result.stdout.trim()
}

export async function commitDiff(
  ctx: RepoContext,
  input: RequestInput<'diff.commit'>
): Promise<FileDiff> {
  requirePath(input.file.path)
  const sha = await resolveCommit(ctx, input.sha)
  return treeDiff(ctx, await firstParent(ctx, sha), sha, input.file, input)
}

export async function stashDiff(
  ctx: RepoContext,
  input: RequestInput<'diff.stash'>
): Promise<FileDiff> {
  requirePath(input.path)
  const ref = await stashRef(ctx, input.index)
  const tracked = await treeDiff(ctx, `${ref}^1`, ref, { path: input.path }, {})
  if (tracked.kind !== 'text' || tracked.patch !== '') return tracked
  // Untracked files of a stash live in its third parent, a commit with no parent of its own.
  const untracked = await ctx.git.run(['rev-parse', '--verify', '-q', `${ref}^3`], {
    readOnly: true
  })
  if (untracked.exitCode !== 0) return tracked
  return treeDiff(ctx, EMPTY_TREE, `${ref}^3`, { path: input.path }, {})
}

export async function stashRef(ctx: RepoContext, index: number): Promise<string> {
  if (!Number.isInteger(index) || index < 0) throw hostError('invalid_params', 'Bad stash index')
  const ref = `stash@{${index}}`
  const result = await ctx.git.run(['rev-parse', '--verify', '-q', ref], { readOnly: true })
  if (result.exitCode !== 0) throw hostError('invalid_params', `There is no ${ref}`)
  return ref
}

/** A revision from the panel: never an option, which git would read as one. */
export function requireRev(rev: unknown): asserts rev is string {
  if (typeof rev !== 'string' || !rev || rev.startsWith('-') || /[\s\0]/.test(rev)) {
    throw hostError('invalid_params', 'Bad revision')
  }
}

/** A repository-relative path from the panel. */
export function requirePath(path: unknown): asserts path is string {
  if (typeof path !== 'string' || !path || path.includes('\0')) {
    throw hostError('invalid_params', 'Bad path')
  }
}
