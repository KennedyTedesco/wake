import { describe, expect, it } from 'vitest'
import { mergeBranch } from '../../src/worker/branches'
import { abortOperation, continueOperation, resolveConflict } from '../../src/worker/conflicts'
import { workingDiff } from '../../src/worker/diff'
import { readOperation, readStatus } from '../../src/worker/status'
import { contextOf, type MakeRepo, tempRepos } from './context'

const make = tempRepos()

/** `main` and `feature` both change both files, so merging `feature` conflicts twice. */
async function conflictingMerge(makeRepo: MakeRepo) {
  const repo = makeRepo()
  repo.write('a.txt', 'base\n')
  repo.write('b.txt', 'base\n')
  repo.commitAll('init')
  repo.git('switch', '-q', '-c', 'feature')
  repo.write('a.txt', 'feature\n')
  repo.write('b.txt', 'feature\n')
  repo.commitAll('feature')
  repo.git('switch', '-q', 'main')
  repo.write('a.txt', 'main\n')
  repo.write('b.txt', 'main\n')
  repo.commitAll('main')
  const ctx = await contextOf(repo)
  const merged = await mergeBranch(ctx, { name: 'feature' })
  return { repo, ctx, merged }
}

describe('merge conflicts', () => {
  it('reports the conflict and aborts the merge', async () => {
    const { repo, ctx, merged } = await conflictingMerge(make)
    expect(merged).toMatchObject({ ok: false, kind: 'conflicts' })
    expect(readOperation(ctx)).toBe('merge')

    expect(await workingDiff(ctx, { file: { path: 'a.txt', kind: 'conflicted' } })).toMatchObject({
      kind: 'conflicted',
      ours: 'main',
      theirs: 'feature'
    })

    expect((await abortOperation(ctx)).ok).toBe(true)
    expect(readOperation(ctx)).toBeNull()
    expect(repo.read('a.txt')).toBe('main\n')
  })

  it('resolves each file and continues', async () => {
    const { repo, ctx } = await conflictingMerge(make)

    expect(await continueOperation(ctx)).toMatchObject({ ok: false, kind: 'conflicts' })
    expect(await resolveConflict(ctx, { path: 'a.txt', using: 'working' })).toMatchObject({
      ok: false,
      kind: 'conflicts'
    })
    repo.write('a.txt', 'both\n')
    expect((await resolveConflict(ctx, { path: 'a.txt', using: 'working' })).ok).toBe(true)
    expect((await resolveConflict(ctx, { path: 'b.txt', using: 'theirs' })).ok).toBe(true)
    expect(repo.read('b.txt')).toBe('feature\n')
    expect((await readStatus(ctx)).files.some((file) => file.kind === 'conflicted')).toBe(false)

    expect((await continueOperation(ctx)).ok).toBe(true)
    expect(readOperation(ctx)).toBeNull()
    expect(repo.git('log', '-1', '--format=%P').trim().split(' ')).toHaveLength(2)
    expect(repo.git('show', 'HEAD:a.txt')).toBe('both\n')
  })

  it('takes our side', async () => {
    const { repo, ctx } = await conflictingMerge(make)
    expect((await resolveConflict(ctx, { path: 'a.txt', using: 'ours' })).ok).toBe(true)
    expect(repo.read('a.txt')).toBe('main\n')
  })

  it('has nothing to abort without an operation', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    repo.commitAll('init')
    expect(await abortOperation(await contextOf(repo))).toMatchObject({ ok: false, kind: 'other' })
  })
})
