// The open pull request of the current branch, from the person's own `gh` CLI and account.
// Orca's plugin API has no pull requests, and Wake makes no network requests of its own.
import { execFile } from 'node:child_process'
import type { PullRequest } from '../shared/model'
import type { RepoContext } from './repo'
import { findBinary, loginPath } from './userPath'

const FIELDS = 'number,title,url,state,isDraft,reviewDecision,statusCheckRollup'
// A pull request rarely changes within this time, and every panel view would otherwise ask again.
const FRESH_MS = 60_000

const FAILED = new Set([
  'FAILURE',
  'ERROR',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE'
])
const WAITING = new Set(['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED'])

const cache = new Map<string, { at: number; value: Promise<PullRequest | null> }>()

export async function currentPullRequest(
  ctx: RepoContext,
  refresh: boolean
): Promise<PullRequest | null> {
  const head = await ctx.git.run(['symbolic-ref', '--quiet', '--short', 'HEAD'], { readOnly: true })
  const branch = head.exitCode === 0 ? head.stdout.trim() : ''
  if (!branch) return null
  const key = `${ctx.root}\0${branch}`
  const cached = cache.get(key)
  if (!refresh && cached && Date.now() - cached.at < FRESH_MS) return cached.value
  const value = askGh(ctx.root, branch)
  cache.set(key, { at: Date.now(), value })
  return value
}

async function askGh(root: string, branch: string): Promise<PullRequest | null> {
  const path = await loginPath()
  const gh = await findBinary('gh', path)
  if (!gh) return null
  const { promise, resolve } = Promise.withResolvers<PullRequest | null>()
  execFile(
    gh,
    ['pr', 'view', branch, '--json', FIELDS],
    {
      cwd: root,
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, PATH: path, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }
    },
    // A branch without a pull request, a host that is not GitHub, or no login all exit non-zero.
    (error, stdout) => {
      if (error) return resolve(null)
      try {
        resolve(readPullRequest(JSON.parse(stdout)))
      } catch {
        resolve(null)
      }
    }
  )
  return promise
}

/** The pull request in `gh pr view --json` output, when it is open. */
export function readPullRequest(data: unknown): PullRequest | null {
  if (!data || typeof data !== 'object') return null
  const pr = data as Record<string, unknown>
  if (pr.state !== 'OPEN' || typeof pr.number !== 'number' || typeof pr.url !== 'string')
    return null
  return {
    number: pr.number,
    title: typeof pr.title === 'string' ? pr.title : '',
    url: pr.url,
    draft: pr.isDraft === true,
    checks: summarizeChecks(pr.statusCheckRollup),
    review:
      pr.reviewDecision === 'APPROVED'
        ? 'approved'
        : pr.reviewDecision === 'CHANGES_REQUESTED'
          ? 'changes-requested'
          : pr.reviewDecision === 'REVIEW_REQUIRED'
            ? 'review-required'
            : null
  }
}

function summarizeChecks(rollup: unknown): PullRequest['checks'] {
  if (!Array.isArray(rollup) || rollup.length === 0) return null
  let pending = false
  for (const item of rollup) {
    if (!item || typeof item !== 'object') continue
    const check = item as Record<string, unknown>
    // Check runs report `status` then `conclusion`; commit statuses report one `state`.
    const outcome = check.status === 'COMPLETED' ? check.conclusion : (check.state ?? check.status)
    if (typeof outcome !== 'string') continue
    if (FAILED.has(outcome)) return 'failing'
    if (WAITING.has(outcome)) pending = true
  }
  return pending ? 'pending' : 'passing'
}
