import { describe, expect, it } from 'vitest'
import type { SyncProgress } from '../../src/worker/repo'
import { readSnapshot } from '../../src/worker/status'
import { fetchRemote, parseProgress, publish, runSync } from '../../src/worker/sync'
import { createRepo } from '../fixture'
import { contextOf, tempRepos, withRemote } from './context'

const make = tempRepos()

/** A second clone of the same remote, standing in for someone else's machine. */
function otherClone(remoteRoot: string) {
  const clone = make()
  clone.git('remote', 'add', 'origin', remoteRoot)
  clone.git('fetch', '-q', 'origin')
  clone.git('reset', '-q', '--hard', 'origin/main')
  clone.git('branch', '-q', '--set-upstream-to=origin/main')
  return clone
}

describe('sync', () => {
  it('pushes local commits', async () => {
    const { remote, repo } = withRemote(make)
    repo.write('a.txt', 'a\n')
    const sha = repo.commitAll('local')
    const progress: SyncProgress[] = []
    const ctx = { ...(await contextOf(repo)), onProgress: (p: SyncProgress) => progress.push(p) }

    expect(await runSync(ctx, { op: 'push' })).toEqual({ ok: true, value: null })
    expect(remote.git('rev-parse', 'main').trim()).toBe(sha)
    expect(progress.every((p) => p.op === 'push')).toBe(true)
  })

  it('fetches and pulls commits from the remote', async () => {
    const { remote, repo } = withRemote(make)
    const other = otherClone(remote.root)
    other.write('theirs.txt', 'theirs\n')
    const theirs = other.commitAll('theirs')
    other.git('push', '-q', 'origin', 'main')
    const ctx = await contextOf(repo)

    expect((await fetchRemote(ctx)).ok).toBe(true)
    const fetched = await readSnapshot(ctx, 'ws')
    expect(fetched.head).toMatchObject({ upstream: { behind: 1, ahead: 0 } })
    expect(fetched.lastFetchedAt).not.toBeNull()

    expect((await runSync(ctx, { op: 'pull' })).ok).toBe(true)
    expect(repo.git('rev-parse', 'HEAD').trim()).toBe(theirs)
  })

  it('reports a rejected push and merges a diverged pull', async () => {
    const { remote, repo } = withRemote(make)
    const other = otherClone(remote.root)
    other.write('theirs.txt', 'theirs\n')
    other.commitAll('theirs')
    other.git('push', '-q', 'origin', 'main')
    repo.write('mine.txt', 'mine\n')
    repo.commitAll('mine')
    const ctx = await contextOf(repo)

    expect(await runSync(ctx, { op: 'push' })).toMatchObject({
      ok: false,
      kind: 'rejected',
      command: 'git push'
    })
    expect((await runSync(ctx, { op: 'pull' })).ok).toBe(true)
    expect(repo.git('log', '-1', '--format=%P').trim().split(' ')).toHaveLength(2)
    expect((await runSync(ctx, { op: 'push' })).ok).toBe(true)
  })

  it('publishes a branch with no upstream', async () => {
    const { remote, repo } = withRemote(make)
    repo.git('switch', '-q', '-c', 'feature')
    repo.write('f.txt', 'f\n')
    const sha = repo.commitAll('feature')
    const ctx = await contextOf(repo)

    expect((await runSync(ctx, { op: 'pull' })).ok).toBe(false)
    expect((await runSync(ctx, { op: 'push' })).ok).toBe(true)
    expect(remote.git('rev-parse', 'feature').trim()).toBe(sha)
    expect(repo.git('rev-parse', '--abbrev-ref', '@{upstream}').trim()).toBe('origin/feature')
  })

  it('needs a remote to publish', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    repo.commitAll('init')
    expect(await publish(await contextOf(repo))).toMatchObject({
      ok: false,
      message: 'This repository has no remote.'
    })
  })

  it('classifies a remote that cannot be reached', async () => {
    const repo = createRepo()
    try {
      repo.write('a.txt', 'a\n')
      repo.commitAll('init')
      repo.git('remote', 'add', 'origin', '/nonexistent/remote.git')
      const result = await fetchRemote(await contextOf(repo))
      expect(result).toMatchObject({ ok: false, kind: 'other', command: 'git fetch' })
    } finally {
      repo.dispose()
    }
  })
})

describe('parseProgress', () => {
  it('reads the last line of a chunk', () => {
    expect(parseProgress('Counting objects: 100% (3/3)\rReceiving objects:  45% (9/20)\r')).toEqual(
      {
        text: 'Receiving objects:  45% (9/20)',
        percent: 45
      }
    )
    expect(parseProgress('remote: Enumerating objects: 5, done.\n')).toEqual({
      text: 'Enumerating objects: 5, done.',
      percent: null
    })
    expect(parseProgress('\r\n')).toBeNull()
  })
})
