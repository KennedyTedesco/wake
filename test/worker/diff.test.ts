import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { commitDiff, workingDiff } from '../../src/worker/diff'
import { contextOf, tempRepos } from './context'

const make = tempRepos()

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

describe('diff.working', () => {
  it('answers a text diff with both sides', async () => {
    const repo = make()
    repo.write('a.txt', 'one\ntwo\n')
    repo.commitAll('init')
    repo.write('a.txt', 'one\n2\n')
    const diff = await workingDiff(await contextOf(repo), {
      file: { path: 'a.txt', kind: 'modified' }
    })
    expect(diff).toMatchObject({ kind: 'text', oldText: 'one\ntwo\n', newText: 'one\n2\n' })
    expect(diff.kind === 'text' && diff.patch).toContain('+2')
  })

  it('diffs an untracked file against nothing', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    repo.commitAll('init')
    repo.write('new.txt', 'new\n')
    const diff = await workingDiff(await contextOf(repo), {
      file: { path: 'new.txt', kind: 'untracked' }
    })
    expect(diff).toMatchObject({ kind: 'text', oldText: null, newText: 'new\n' })
    expect(diff.kind === 'text' && diff.patch).toContain('new file mode')
  })

  it('diffs a file of an unborn branch', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    repo.git('add', 'a.txt')
    const diff = await workingDiff(await contextOf(repo), {
      file: { path: 'a.txt', kind: 'added' }
    })
    expect(diff).toMatchObject({ kind: 'text', oldText: null, newText: 'a\n' })
  })

  it('ignores whitespace on request', async () => {
    const repo = make()
    repo.write('a.txt', 'a b\n')
    repo.commitAll('init')
    repo.write('a.txt', 'a  b\n')
    const diff = await workingDiff(await contextOf(repo), {
      file: { path: 'a.txt', kind: 'modified' },
      ignoreWhitespace: true
    })
    expect(diff.kind === 'text' && diff.patch.includes('@@')).toBe(false)
  })

  it('answers images as data URLs and other binaries by size', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    repo.commitAll('init')
    writeFileSync(join(repo.root, 'dot.png'), PNG)
    repo.write('blob.bin', '\0\x01\x02')
    const ctx = await contextOf(repo)

    const image = await workingDiff(ctx, { file: { path: 'dot.png', kind: 'untracked' } })
    expect(image).toMatchObject({
      kind: 'image',
      oldImage: null,
      oldSize: null,
      newSize: PNG.length
    })
    expect(image.kind === 'image' && image.newImage?.startsWith('data:image/png;base64,')).toBe(
      true
    )
    const binary = await workingDiff(ctx, { file: { path: 'blob.bin', kind: 'untracked' } })
    expect(binary).toEqual({ kind: 'binary', oldSize: null, newSize: 3 })
  })

  it('answers too-large for a huge patch', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    repo.commitAll('init')
    repo.write('big.txt', `${'x'.repeat(100)}\n`.repeat(8000))
    const diff = await workingDiff(await contextOf(repo), {
      file: { path: 'big.txt', kind: 'untracked' }
    })
    expect(diff.kind).toBe('too-large')
  })
})

describe('diff.commit', () => {
  it('diffs a commit against its parent, renames included', async () => {
    const repo = make()
    repo.write('old.txt', 'one\ntwo\nthree\nfour\n')
    repo.commitAll('init')
    repo.git('mv', 'old.txt', 'new.txt')
    repo.write('new.txt', 'one\ntwo\nthree\nfour\nfive\n')
    const sha = repo.commitAll('rename')
    const diff = await commitDiff(await contextOf(repo), {
      sha,
      file: { path: 'new.txt', oldPath: 'old.txt' }
    })
    expect(diff).toMatchObject({
      kind: 'text',
      oldText: 'one\ntwo\nthree\nfour\n',
      newText: 'one\ntwo\nthree\nfour\nfive\n'
    })
    expect(diff.kind === 'text' && diff.patch).toContain('rename from old.txt')
  })

  it('diffs a root commit against the empty tree', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    const sha = repo.commitAll('root')
    const diff = await commitDiff(await contextOf(repo), { sha, file: { path: 'a.txt' } })
    expect(diff).toMatchObject({ kind: 'text', oldText: null, newText: 'a\n' })
  })
})
