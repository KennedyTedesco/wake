// Notices changes under the focused repository: its working tree, and its git directories when
// they live elsewhere (linked worktrees). Falls back to polling when the system runs out of watches.
import { createHash } from 'node:crypto'
import { type FSWatcher, watch } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'
import type { RepoContext } from './repo'

const DEBOUNCE_MS = 250
/** A steady stream of events (a build) still reports at least this often. */
const MAX_WAIT_MS = 2_000
const POLL_MS = 3_000

/** Changes inside a git directory that say nothing new about the repository. */
const GIT_NOISE = /^(?:objects|logs)(?:[\\/]|$)|\.lock$/

export type RepoWatcher = { close(): void }

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/** Whether an event at `name` (relative to a watched folder) is worth reporting. */
export function isRelevant(name: string, inGitDir: boolean): boolean {
  const gitPath = inGitDir
    ? name
    : /^\.git(?:[\\/]|$)/.test(name)
      ? name.slice('.git/'.length)
      : null
  return gitPath === null || !GIT_NOISE.test(gitPath)
}

export function watchRepo(
  ctx: RepoContext,
  onChange: () => void,
  log: (message: string) => void
): RepoWatcher {
  let timer: NodeJS.Timeout | undefined
  let firstEventAt = 0
  let closed = false
  let poller: NodeJS.Timeout | undefined
  const watchers: FSWatcher[] = []

  const fire = () => {
    timer = undefined
    firstEventAt = 0
    if (!closed) onChange()
  }
  const schedule = () => {
    const now = Date.now()
    if (!firstEventAt) firstEventAt = now
    clearTimeout(timer)
    timer = setTimeout(fire, Math.max(0, Math.min(DEBOUNCE_MS, firstEventAt + MAX_WAIT_MS - now)))
  }

  const closeWatchers = () => {
    for (const watcher of watchers.splice(0)) watcher.close()
  }

  const startPolling = (error: Error) => {
    if (poller || closed) return
    log(`Wake: watching ${ctx.root} failed (${error.message}); polling instead`)
    closeWatchers()
    let last: string | null = null
    const poll = async () => {
      const result = await ctx.git
        .exec(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'], {
          readOnly: true
        })
        .catch(() => null)
      if (!result || closed) return
      const hash = createHash('sha1').update(result.stdout).digest('hex')
      if (last !== null && hash !== last) onChange()
      last = hash
    }
    void poll()
    poller = setInterval(() => void poll(), POLL_MS)
  }

  const folders = [{ path: ctx.root, gitDir: false }]
  for (const dir of new Set([ctx.gitDir, ctx.commonDir])) {
    if (!isInside(dir, ctx.root)) folders.push({ path: dir, gitDir: true })
  }
  for (const folder of folders) {
    try {
      const watcher = watch(folder.path, { recursive: true }, (_event, name) => {
        if (name === null || isRelevant(name.toString(), folder.gitDir)) schedule()
      })
      watcher.on('error', startPolling)
      watchers.push(watcher)
    } catch (error) {
      startPolling(error instanceof Error ? error : new Error(String(error)))
      break
    }
  }

  return {
    close() {
      closed = true
      clearTimeout(timer)
      clearInterval(poller)
      closeWatchers()
    }
  }
}
