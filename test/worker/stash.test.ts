import { describe, expect, it } from 'vitest'
import { stashDiff } from '../../src/worker/diff'
import {
  applyStash,
  dropStash,
  listStashes,
  parseStashList,
  pushStash,
  stashFiles
} from '../../src/worker/stash'
import { readStatus } from '../../src/worker/status'
import { contextOf, tempRepos } from './context'

const make = tempRepos()

describe('stash', () => {
  it('pushes, lists, shows, applies and drops', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    repo.commitAll('init')
    repo.write('a.txt', 'changed\n')
    repo.write('new.txt', 'untracked\n')
    const ctx = await contextOf(repo)

    expect((await pushStash(ctx, { message: 'work in progress' })).ok).toBe(true)
    expect((await readStatus(ctx)).files).toEqual([])
    const [stash] = await listStashes(ctx)
    expect(stash).toMatchObject({
      index: 0,
      ref: 'stash@{0}',
      message: 'work in progress',
      branch: 'main'
    })

    const files = await stashFiles(ctx, { index: 0 })
    expect(files).toEqual([
      { path: 'a.txt', kind: 'modified' },
      { path: 'new.txt', kind: 'added' }
    ])
    const tracked = await stashDiff(ctx, { index: 0, path: 'a.txt' })
    expect(tracked).toMatchObject({ kind: 'text', oldText: 'a\n', newText: 'changed\n' })
    const untracked = await stashDiff(ctx, { index: 0, path: 'new.txt' })
    expect(untracked).toMatchObject({ kind: 'text', oldText: null, newText: 'untracked\n' })

    expect((await applyStash(ctx, { index: 0, drop: false })).ok).toBe(true)
    expect(repo.read('a.txt')).toBe('changed\n')
    expect(repo.read('new.txt')).toBe('untracked\n')
    expect(await listStashes(ctx)).toHaveLength(1)
    expect((await dropStash(ctx, { index: 0 })).ok).toBe(true)
    expect(await listStashes(ctx)).toEqual([])
  })

  it('pops a stash', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    repo.commitAll('init')
    repo.write('a.txt', 'changed\n')
    const ctx = await contextOf(repo)
    await pushStash(ctx, {})
    expect((await applyStash(ctx, { index: 0, drop: true })).ok).toBe(true)
    expect(await listStashes(ctx)).toEqual([])
    expect(repo.read('a.txt')).toBe('changed\n')
  })

  it('says when there is nothing to stash', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    repo.commitAll('init')
    expect(await pushStash(await contextOf(repo), {})).toEqual({
      ok: true,
      value: null,
      message: 'There are no changes to stash.'
    })
  })

  it('refuses a stash that does not exist', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    repo.commitAll('init')
    await expect(dropStash(await contextOf(repo), { index: 3 })).rejects.toMatchObject({
      code: 'invalid_params'
    })
  })
})

describe('parseStashList', () => {
  it('reads named and automatic stashes', () => {
    const output = [
      'stash@{0}\x1fOn main: named\x1f100',
      'stash@{1}\x1fWIP on (no branch): 1a2b3c4 x\x1f50'
    ].join('\n')
    expect(parseStashList(output)).toEqual([
      { index: 0, ref: 'stash@{0}', message: 'named', branch: 'main', date: 100_000 },
      { index: 1, ref: 'stash@{1}', message: '1a2b3c4 x', branch: null, date: 50_000 }
    ])
  })
})
