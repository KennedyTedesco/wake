import { describe, expect, it } from 'vitest'
import type { RepoSnapshot } from '../../src/shared/model'
import { findPluginKey } from '../../src/worker/cli'
import { createMutationQueue } from '../../src/worker/queue'
import { statusBarView } from '../../src/worker/statusbar'
import { isRelevant } from '../../src/worker/watch'

const snapshot = (overrides: Partial<RepoSnapshot>): RepoSnapshot => ({
  root: '/repo',
  repoName: 'repo',
  workspaceName: 'repo',
  head: { kind: 'branch', name: 'main', upstream: null },
  files: [],
  filesTruncated: false,
  operation: null,
  remote: null,
  stashCount: 0,
  lastFetchedAt: null,
  lastCommit: null,
  ...overrides
})

describe('statusBarView', () => {
  it('shows the branch, sync counts and changed files', () => {
    const view = statusBarView({
      kind: 'ready',
      repo: snapshot({
        head: {
          kind: 'branch',
          name: 'main',
          upstream: { name: 'origin/main', remote: 'origin', ahead: 2, behind: 1, gone: false }
        },
        files: [
          { path: 'a', kind: 'modified' },
          { path: 'b', kind: 'untracked' },
          { path: 'c', kind: 'added' }
        ]
      })
    })
    expect(view).toEqual({
      text: 'main ↑2 ↓1 •3',
      tooltip: 'main · 2 to push · 1 to pull · 3 changed files — Open Wake',
      tone: 'accent',
      visible: true
    })
  })

  it('warns during a merge with conflicts', () => {
    const view = statusBarView({
      kind: 'ready',
      repo: snapshot({ operation: 'merge', files: [{ path: 'a', kind: 'conflicted' }] })
    })
    expect(view.tone).toBe('warning')
    expect(view.tooltip).toBe('main · merge in progress · 1 conflict · 1 changed file — Open Wake')
  })

  it('hides without a repository', () => {
    expect(statusBarView({ kind: 'no-workspace' }).visible).toBe(false)
  })
})

describe('findPluginKey', () => {
  it('finds the installed plugin by its manifest id', () => {
    const list = JSON.stringify({
      ok: true,
      result: {
        plugins: [{ pluginKey: 'stablyai.theme' }, { pluginKey: 'kennedytedesco.wake' }]
      }
    })
    expect(findPluginKey(list)).toBe('kennedytedesco.wake')
    expect(findPluginKey('not json')).toBeNull()
  })
})

describe('isRelevant', () => {
  it('ignores git bookkeeping but not the files of the working tree', () => {
    expect(isRelevant('.git/objects/ab/cdef', false)).toBe(false)
    expect(isRelevant('.git/index.lock', false)).toBe(false)
    expect(isRelevant('.git/logs/HEAD', false)).toBe(false)
    expect(isRelevant('.git/HEAD', false)).toBe(true)
    expect(isRelevant('objects/ab', true)).toBe(false)
    expect(isRelevant('Cargo.lock', false)).toBe(true)
    expect(isRelevant('src/logs/today.txt', false)).toBe(true)
  })
})

describe('createMutationQueue', () => {
  it('runs operations on one key in order, even after a failure', async () => {
    const queue = createMutationQueue()
    const order: string[] = []
    let releaseFirst = () => {}
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const first = queue.run('repo', async () => {
      order.push('start a')
      await firstGate
      order.push('end a')
      throw new Error('a')
    })
    const second = queue.run('repo', async () => {
      order.push('b')
      return 'b'
    })
    await Promise.resolve()
    expect(order).toEqual(['start a'])
    expect(queue.busy('repo')).toBe(true)
    expect(queue.busy('other')).toBe(false)

    releaseFirst()
    await expect(first).rejects.toThrow('a')
    await expect(second).resolves.toBe('b')
    expect(order).toEqual(['start a', 'end a', 'b'])
    expect(queue.busy('repo')).toBe(false)
  })
})
