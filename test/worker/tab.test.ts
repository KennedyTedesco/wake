import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openRepo } from '../../src/worker/repo'
import { prepareTabFile, TAB_FILE } from '../../src/worker/tab'
import { createRepo, type Fixture } from '../fixture'

let repo: Fixture
afterEach(() => repo?.dispose())

describe('prepareTabFile', () => {
  it('writes the marker once and keeps it out of git status', async () => {
    repo = createRepo()
    repo.write('a.txt', 'a\n')
    repo.commitAll('init')
    const ctx = await openRepo(repo.root)
    if (!ctx) throw new Error('not a repository')

    expect(await prepareTabFile(repo.root, ctx)).toEqual({ ok: true, value: TAB_FILE })
    expect(await prepareTabFile(repo.root, ctx)).toEqual({ ok: true, value: TAB_FILE })

    expect(repo.git('status', '--porcelain', '--untracked-files=all')).toBe('')
    const exclude = readFileSync(join(repo.root, '.git', 'info', 'exclude'), 'utf8')
    expect(exclude.split('\n').filter((line) => line === `/${TAB_FILE}`)).toHaveLength(1)
  })

  it('refuses a repository that tracks a file with the marker name', async () => {
    repo = createRepo()
    repo.write(TAB_FILE, 'mine\n')
    repo.commitAll('init')
    const ctx = await openRepo(repo.root)
    if (!ctx) throw new Error('not a repository')
    const result = await prepareTabFile(repo.root, ctx)
    expect(result.ok).toBe(false)
    expect(repo.read(TAB_FILE)).toBe('mine\n')
  })
})
