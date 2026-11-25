// `history.*`: the commit list of HEAD and one commit's files.
import type {
  ChangedFile,
  Commit,
  CommitDetails,
  CommitFile,
  FileChangeKind
} from '../shared/model'
import type { RequestInput, RequestOutput } from '../shared/protocol'
import { firstParent, resolveCommit } from './diff'
import { hostError } from './failure'
import type { RepoContext } from './repo'

const FIELD = '\x1f'
const RECORD = '\x1e'
const LOG_FORMAT = ['%H', '%h', '%P', '%an', '%ae', '%at', '%cn', '%ct', '%s', '%b', '%D']
  .join('%x1f')
  .concat('%x1e')
/** How far back commits are checked for being pushed; older ones count as pushed. */
const UNPUSHED_LIMIT = 10_000

export function parseLog(output: string, unpushed: ReadonlySet<string>): Commit[] {
  const commits: Commit[] = []
  for (const record of output.split(RECORD)) {
    const fields = record.replace(/^\n/, '').split(FIELD)
    if (fields.length < 11) continue
    const [
      sha = '',
      shortSha,
      parents,
      authorName,
      authorEmail,
      authorDate,
      committerName,
      committerDate,
      summary,
      body,
      refs
    ] = fields
    commits.push({
      sha,
      shortSha: shortSha ?? '',
      parents: parents ? parents.split(' ') : [],
      summary: summary ?? '',
      body: (body ?? '').trim(),
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      authorDate: Number(authorDate) * 1000,
      committerName: committerName ?? '',
      committerDate: Number(committerDate) * 1000,
      refs: parseRefs(refs ?? ''),
      unpushed: unpushed.has(sha)
    })
  }
  return commits
}

/** `%D` decorations as names: `HEAD -> main, tag: v1, origin/main` → `main`, `tag:v1`,
 *  `origin/main`. HEAD and remote HEAD pointers are left out. */
export function parseRefs(decorations: string): string[] {
  const refs: string[] = []
  for (const raw of decorations.split(', ')) {
    const ref = raw
      .trim()
      .replace(/^HEAD -> /, '')
      .replace(/^tag: /, 'tag:')
    if (!ref || ref === 'HEAD' || ref.endsWith('/HEAD')) continue
    refs.push(ref)
  }
  return refs
}

async function hasUpstream(ctx: RepoContext): Promise<boolean> {
  const result = await ctx.git.run(['rev-parse', '--verify', '-q', '@{upstream}'], {
    readOnly: true
  })
  return result.exitCode === 0
}

/** Commits of `tip` that its upstream (or, with none, any remote branch) lacks. */
async function unpushedCommits(ctx: RepoContext, tip: string): Promise<Set<string>> {
  const range = (await hasUpstream(ctx))
    ? [tip, '--not', '@{upstream}']
    : [tip, '--not', '--remotes']
  const result = await ctx.git.run(['rev-list', `--max-count=${UNPUSHED_LIMIT}`, ...range], {
    readOnly: true
  })
  return new Set(result.exitCode === 0 ? result.stdout.split('\n').filter(Boolean) : [])
}

export async function readLog(
  ctx: RepoContext,
  input: RequestInput<'history.log'>
): Promise<RequestOutput<'history.log'>> {
  const skip = Number.isInteger(input.skip) && input.skip > 0 ? input.skip : 0
  const limit = Number.isInteger(input.limit) && input.limit > 0 ? Math.min(input.limit, 1000) : 50
  const head = await ctx.git.run(['rev-parse', '--verify', '-q', 'HEAD'], { readOnly: true })
  if (head.exitCode !== 0) return { commits: [], hasMore: false }

  const query = typeof input.query === 'string' ? input.query.trim() : ''
  const search = query ? ['-i', '-F', `--grep=${query}`] : []
  const [output, unpushed, bySha] = await Promise.all([
    ctx.git.read(
      [
        'log',
        `--format=${LOG_FORMAT}`,
        `--skip=${skip}`,
        `-n${limit + 1}`,
        ...search,
        'HEAD',
        '--'
      ],
      { readOnly: true }
    ),
    unpushedCommits(ctx, 'HEAD'),
    skip === 0 && /^[0-9a-f]{4,64}$/i.test(query) ? commitBySha(ctx, query) : Promise.resolve(null)
  ])
  const commits = parseLog(output, unpushed)
  const hasMore = commits.length > limit
  const page = commits.slice(0, limit)
  if (bySha && !page.some((commit) => commit.sha === bySha)) {
    const [match] = parseLog(
      await ctx.git.read(['log', '-1', `--format=${LOG_FORMAT}`, bySha, '--'], { readOnly: true }),
      unpushed
    )
    if (match) page.unshift(match)
  }
  return { commits: page, hasMore }
}

async function commitBySha(ctx: RepoContext, prefix: string): Promise<string | null> {
  const result = await ctx.git.run(['rev-parse', '--verify', '-q', `${prefix}^{commit}`], {
    readOnly: true
  })
  return result.exitCode === 0 ? result.stdout.trim() : null
}

const STATUS_KINDS: Record<string, FileChangeKind> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typechange',
  U: 'conflicted'
}

/** Parses `--name-status -z` output (`diff-tree`, `stash show`). */
export function parseNameStatus(output: string): ChangedFile[] {
  const fields = output.split('\0')
  const files: ChangedFile[] = []
  for (let i = 0; i < fields.length; i++) {
    const status = fields[i] ?? ''
    if (!status) continue
    const kind = STATUS_KINDS[status[0] ?? ''] ?? 'modified'
    if (kind === 'renamed' || kind === 'copied') {
      const oldPath = fields[++i] ?? ''
      files.push({ path: fields[++i] ?? '', oldPath, kind })
    } else {
      files.push({ path: fields[++i] ?? '', kind })
    }
  }
  return files
}

/** Parses `--numstat -z` output into counts by new path; null counts for a binary file. */
export function parseNumstat(
  output: string
): Map<string, { additions: number | null; deletions: number | null }> {
  const fields = output.split('\0')
  const counts = new Map<string, { additions: number | null; deletions: number | null }>()
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i] ?? ''
    if (!entry) continue
    const [added = '-', deleted = '-', path = ''] = entry.split('\t')
    // A rename leaves the path empty and names both sides in the next two fields.
    let newPath = path
    if (!newPath) {
      i += 2
      newPath = fields[i] ?? ''
    }
    counts.set(newPath, {
      additions: added === '-' ? null : Number(added),
      deletions: deleted === '-' ? null : Number(deleted)
    })
  }
  return counts
}

const CO_AUTHOR = /^Co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/gim

export function parseCoAuthors(body: string): CommitDetails['coAuthors'] {
  return Array.from(body.matchAll(CO_AUTHOR), (match) => ({
    name: match[1] ?? '',
    email: match[2] ?? ''
  }))
}

export async function readDetails(
  ctx: RepoContext,
  input: RequestInput<'history.details'>
): Promise<RequestOutput<'history.details'>> {
  const sha = await resolveCommit(ctx, input.sha)
  const parent = await firstParent(ctx, sha)
  const range = ['diff-tree', '-r', '-z', '--no-commit-id', '--find-renames', parent, sha]
  const [log, nameStatus, numstat, unpushed] = await Promise.all([
    ctx.git.read(['log', '-1', `--format=${LOG_FORMAT}`, sha, '--'], { readOnly: true }),
    ctx.git.read([...range, '--name-status'], { readOnly: true }),
    ctx.git.read([...range, '--numstat'], { readOnly: true }),
    unpushedCommits(ctx, sha)
  ])
  const [commit] = parseLog(log, unpushed)
  if (!commit) throw hostError('action_failed', `Could not read commit ${sha}`)
  const counts = parseNumstat(numstat)
  const files: CommitFile[] = parseNameStatus(nameStatus).map((file) => ({
    ...file,
    ...(counts.get(file.path) ?? { additions: null, deletions: null })
  }))
  return { commit, files, coAuthors: parseCoAuthors(commit.body) }
}
