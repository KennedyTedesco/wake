import { describe, expect, it } from 'vitest'
import {
  checkoutBranch,
  createBranch,
  createTag,
  deleteBranch,
  listBranches,
  mergeBranch,
  recentBranches,
  renameBranch
} from '../../src/worker/branches'
import { contextOf, tempRepos, withRemote } from './context'

const make = tempRepos()

describe('branches', () => {
  it('lists local and remote branches with tracking and recent ones', async () => {
    const { repo } = withRemote(make)
    repo.git('remote', 'set-head', 'origin', 'main')
    repo.write('a.txt', 'a\n')
    repo.commitAll('ahead')
    repo.git('branch', 'feature')
    repo.git('switch', '-q', 'feature')
    repo.git('switch', '-q', 'main')
    const ctx = await contextOf(repo)

    const list = await listBranches(ctx)
    expect(list.current).toBe('main')
    expect(list.defaultBranch).toBe('main')
    expect(list.local.map((branch) => branch.name)).toEqual(['feature', 'main'])
    expect(list.local.find((branch) => branch.name === 'main')).toMatchObject({
      ref: 'refs/heads/main',
      upstream: 'origin/main',
      ahead: 1,
      behind: 0,
      lastCommitSummary: 'ahead',
      worktreePath: null
    })
    expect(list.remote.map((branch) => [branch.name, branch.remote])).toEqual([
      ['origin/main', 'origin']
    ])
    expect(list.recent).toEqual(['feature'])
  })

  it('creates, renames, merges and deletes branches', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    repo.commitAll('init')
    const ctx = await contextOf(repo)

    expect(await createBranch(ctx, { name: 'bad..name' })).toMatchObject({
      ok: false,
      kind: 'other'
    })
    expect((await createBranch(ctx, { name: 'topic' })).ok).toBe(true)
    expect(repo.git('symbolic-ref', '--short', 'HEAD').trim()).toBe('topic')
    repo.write('b.txt', 'b\n')
    repo.commitAll('topic work')
    expect((await renameBranch(ctx, { from: 'topic', to: 'topic-2' })).ok).toBe(true)
    expect((await checkoutBranch(ctx, { name: 'main', remote: false })).ok).toBe(true)
    expect((await mergeBranch(ctx, { name: 'topic-2' })).ok).toBe(true)
    expect(repo.read('b.txt')).toBe('b\n')
    expect(
      (await deleteBranch(ctx, { name: 'topic-2', force: false, deleteRemote: false })).ok
    ).toBe(true)
    expect(repo.git('branch', '--format=%(refname:short)').trim()).toBe('main')
    expect((await createTag(ctx, { name: 'v1', sha: 'HEAD' })).ok).toBe(true)
    expect(repo.git('tag').trim()).toBe('v1')
  })

  it('checks out a remote branch as a tracking branch', async () => {
    const { remote, repo } = withRemote(make)
    repo.git('switch', '-q', '-c', 'shared')
    repo.write('s.txt', 's\n')
    repo.commitAll('shared work')
    repo.git('push', '-q', 'origin', 'shared')
    repo.git('switch', '-q', 'main')
    repo.git('branch', '-q', '-D', 'shared')
    const ctx = await contextOf(repo)

    expect((await checkoutBranch(ctx, { name: 'origin/shared', remote: true })).ok).toBe(true)
    expect(repo.git('rev-parse', '--abbrev-ref', 'shared@{upstream}').trim()).toBe('origin/shared')

    // Deleting it with its remote branch removes both.
    repo.git('switch', '-q', 'main')
    const deleted = await deleteBranch(ctx, { name: 'shared', force: true, deleteRemote: true })
    expect(deleted.ok).toBe(true)
    expect(remote.git('branch', '--format=%(refname:short)').trim()).toBe('main')
  })

  it('reports a checkout that would lose changes', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    repo.commitAll('init')
    repo.git('switch', '-q', '-c', 'other')
    repo.write('a.txt', 'other\n')
    repo.commitAll('other')
    repo.git('switch', '-q', 'main')
    repo.write('a.txt', 'local edit\n')
    const result = await checkoutBranch(await contextOf(repo), { name: 'other', remote: false })
    expect(result).toMatchObject({ ok: false, kind: 'dirty' })
  })
})

describe('recentBranches', () => {
  it('keeps existing local branches, newest first, without the current one', () => {
    const reflog = [
      'checkout: moving from a to main',
      'checkout: moving from main to a',
      'commit: x',
      'checkout: moving from b to deleted',
      'checkout: moving from main to b'
    ].join('\n')
    expect(recentBranches(reflog, new Set(['main', 'a', 'b']), 'main')).toEqual(['a', 'b'])
  })
})
