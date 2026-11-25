import { describe, expect, it } from 'vitest'
import { parseRefs, readDetails, readLog } from '../../src/worker/history'
import { contextOf, tempRepos, withRemote } from './context'

const make = tempRepos()

describe('history.log', () => {
  it('pages through HEAD and marks unpushed commits', async () => {
    const { repo } = withRemote(make)
    for (const n of [1, 2, 3]) {
      repo.write(`f${n}.txt`, `${n}\n`)
      repo.commitAll(`commit ${n}`)
    }
    repo.git('tag', 'v1', 'HEAD~1')
    const ctx = await contextOf(repo)

    const first = await readLog(ctx, { skip: 0, limit: 2 })
    expect(first.hasMore).toBe(true)
    expect(first.commits.map((commit) => commit.summary)).toEqual(['commit 3', 'commit 2'])
    expect(first.commits.every((commit) => commit.unpushed)).toBe(true)
    expect(first.commits[0]?.refs).toEqual(['main'])
    expect(first.commits[1]?.refs).toEqual(['tag:v1'])

    const second = await readLog(ctx, { skip: 2, limit: 2 })
    expect(second.hasMore).toBe(false)
    expect(second.commits.map((commit) => [commit.summary, commit.unpushed])).toEqual([
      ['commit 1', true],
      ['init', false]
    ])
    expect(second.commits[1]?.refs).toEqual(['origin/main'])
  })

  it('searches messages and finds a commit by sha', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    const init = repo.commitAll('Initial import')
    repo.write('a.txt', 'b\n')
    repo.commitAll('Fix the parser')
    const ctx = await contextOf(repo)

    const byMessage = await readLog(ctx, { skip: 0, limit: 10, query: 'PARSER' })
    expect(byMessage.commits.map((commit) => commit.summary)).toEqual(['Fix the parser'])
    const bySha = await readLog(ctx, { skip: 0, limit: 10, query: init.slice(0, 8) })
    expect(bySha.commits[0]?.sha).toBe(init)
  })

  it('answers nothing on an unborn branch', async () => {
    const repo = make()
    expect(await readLog(await contextOf(repo), { skip: 0, limit: 10 })).toEqual({
      commits: [],
      hasMore: false
    })
  })
})

describe('history.details', () => {
  it('lists renames with line counts and co-authors', async () => {
    const repo = make()
    repo.write('old.txt', 'line 1\nline 2\nline 3\nline 4\n')
    repo.write('image.bin', Buffer.from([0, 1, 2]).toString('latin1'))
    repo.commitAll('init')
    repo.git('mv', 'old.txt', 'new.txt')
    repo.write('new.txt', 'line 1\nline 2\nline 3\nline 4\nline 5\n')
    repo.write('image.bin', Buffer.from([0, 1, 2, 3]).toString('latin1'))
    repo.git('add', '-A')
    repo.git('commit', '-q', '-m', 'Rename\n\nCo-authored-by: Grace Hopper <grace@example.com>')
    const ctx = await contextOf(repo)

    const details = await readDetails(ctx, { sha: 'HEAD' })
    expect(details.commit.summary).toBe('Rename')
    expect(details.coAuthors).toEqual([{ name: 'Grace Hopper', email: 'grace@example.com' }])
    const byPath = Object.fromEntries(details.files.map((file) => [file.path, file]))
    expect(byPath['new.txt']).toEqual({
      path: 'new.txt',
      oldPath: 'old.txt',
      kind: 'renamed',
      additions: 1,
      deletions: 0
    })
    expect(byPath['image.bin']).toMatchObject({
      kind: 'modified',
      additions: null,
      deletions: null
    })
  })

  it('lists the files of a root commit', async () => {
    const repo = make()
    repo.write('a.txt', 'a\nb\n')
    repo.commitAll('root')
    const details = await readDetails(await contextOf(repo), { sha: 'HEAD' })
    expect(details.files).toEqual([{ path: 'a.txt', kind: 'added', additions: 2, deletions: 0 }])
  })

  it('refuses a revision that looks like an option', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    repo.commitAll('root')
    await expect(readDetails(await contextOf(repo), { sha: '--output=x' })).rejects.toMatchObject({
      code: 'invalid_params'
    })
  })
})

describe('parseRefs', () => {
  it('drops HEAD pointers and marks tags', () => {
    expect(parseRefs('HEAD -> main, tag: v1.0, origin/main, origin/HEAD')).toEqual([
      'main',
      'tag:v1.0',
      'origin/main'
    ])
  })
})
