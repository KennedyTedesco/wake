import { chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePatch } from '../../src/shared/diff/parse'
import type { FileDiff } from '../../src/shared/model'
import {
  createCommit,
  discardChanges,
  discardLines,
  ignorePattern,
  lastMessage,
  undoCommit
} from '../../src/worker/commit'
import { workingDiff } from '../../src/worker/diff'
import type { RepoContext } from '../../src/worker/repo'
import { readStatus } from '../../src/worker/status'
import { contextOf, tempRepos } from './context'

const make = tempRepos()

type TextDiff = Extract<FileDiff, { kind: 'text' }>

async function textDiff(
  ctx: RepoContext,
  path: string,
  kind: 'modified' | 'untracked' = 'modified'
) {
  const diff = await workingDiff(ctx, { file: { path, kind } })
  if (diff.kind !== 'text') throw new Error(`expected a text diff, got ${diff.kind}`)
  return diff
}

/** Ordinals of the changed lines whose text (with its +/- marker) is listed. */
function ordinals(diff: TextDiff, lines: string[]): number[] {
  const picked: number[] = []
  for (const hunk of parsePatch(diff.patch).hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'context') continue
      if (lines.includes(`${line.type === 'add' ? '+' : '-'}${line.text}`))
        picked.push(line.ordinal)
    }
  }
  return picked
}

describe('commit.create', () => {
  it('commits only the ticked files, whatever was staged', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    repo.write('b.txt', 'b\n')
    repo.commitAll('init')
    repo.write('a.txt', 'a2\n')
    repo.write('b.txt', 'b2\n')
    repo.write('c.txt', 'c\n')
    repo.git('add', 'b.txt')
    const ctx = await contextOf(repo)

    const result = await createCommit(ctx, {
      summary: 'Change a and add c',
      description: 'Body text',
      amend: false,
      files: [
        { path: 'a.txt', kind: 'modified', selection: { kind: 'all' } },
        { path: 'c.txt', kind: 'untracked', selection: { kind: 'all' } }
      ]
    })
    expect(result.ok).toBe(true)
    expect(repo.git('show', '--name-only', '--format=', 'HEAD').trim().split('\n')).toEqual([
      'a.txt',
      'c.txt'
    ])
    expect(repo.git('log', '-1', '--format=%B').trim()).toBe('Change a and add c\n\nBody text')
    const left = (await readStatus(ctx)).files.map((file) => file.path)
    expect(left).toEqual(['b.txt'])
  })

  it('commits selected lines', async () => {
    const repo = make()
    repo.write('a.txt', 'one\ntwo\nthree\n')
    repo.commitAll('init')
    repo.write('a.txt', 'one\nTWO\nthree\nfour\n')
    const ctx = await contextOf(repo)
    const diff = await textDiff(ctx, 'a.txt')

    const result = await createCommit(ctx, {
      summary: 'Add four',
      description: '',
      amend: false,
      files: [
        {
          path: 'a.txt',
          kind: 'modified',
          selection: { kind: 'lines', hash: diff.hash, lines: ordinals(diff, ['+four']) }
        }
      ]
    })
    expect(result.ok).toBe(true)
    expect(repo.git('show', 'HEAD:a.txt')).toBe('one\ntwo\nthree\nfour\n')
    expect(repo.read('a.txt')).toBe('one\nTWO\nthree\nfour\n')
  })

  it('commits selected lines of an untracked file', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    repo.commitAll('init')
    repo.write('new.txt', 'keep\nskip\n')
    const ctx = await contextOf(repo)
    const diff = await textDiff(ctx, 'new.txt', 'untracked')

    const result = await createCommit(ctx, {
      summary: 'Add new',
      description: '',
      amend: false,
      files: [
        {
          path: 'new.txt',
          kind: 'untracked',
          selection: { kind: 'lines', hash: diff.hash, lines: ordinals(diff, ['+keep']) }
        }
      ]
    })
    expect(result.ok).toBe(true)
    expect(repo.git('show', 'HEAD:new.txt')).toBe('keep\n')
  })

  it('refuses a stale line selection and changes nothing', async () => {
    const repo = make()
    repo.write('a.txt', 'one\n')
    repo.commitAll('init')
    repo.write('a.txt', 'one\ntwo\n')
    const ctx = await contextOf(repo)
    const diff = await textDiff(ctx, 'a.txt')
    repo.write('a.txt', 'one\ntwo\nthree\n')

    const result = await createCommit(ctx, {
      summary: 'Stale',
      description: '',
      amend: false,
      files: [
        {
          path: 'a.txt',
          kind: 'modified',
          selection: { kind: 'lines', hash: diff.hash, lines: [0] }
        }
      ]
    })
    expect(result).toMatchObject({ ok: false, kind: 'stale' })
    expect(repo.git('log', '--format=%s').trim()).toBe('init')
  })

  it('reads file names literally, never as globs', async () => {
    const repo = make()
    repo.write('[id].ts', 'a\n')
    repo.write('i.ts', 'a\n')
    repo.commitAll('init')
    repo.write('[id].ts', 'b\n')
    repo.write('i.ts', 'b\n')
    const ctx = await contextOf(repo)
    const result = await createCommit(ctx, {
      summary: 'Only the route',
      description: '',
      amend: false,
      files: [{ path: '[id].ts', kind: 'modified', selection: { kind: 'all' } }]
    })
    expect(result.ok).toBe(true)
    expect(repo.git('show', '--name-only', '--format=', 'HEAD').trim()).toBe('[id].ts')
  })

  it('amends the last commit', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    repo.commitAll('first')
    repo.write('b.txt', 'b\n')
    const ctx = await contextOf(repo)
    const result = await createCommit(ctx, {
      summary: 'first, amended',
      description: '',
      amend: true,
      files: [{ path: 'b.txt', kind: 'untracked', selection: { kind: 'all' } }]
    })
    expect(result.ok).toBe(true)
    expect(repo.git('log', '--format=%s').trim()).toBe('first, amended')
    expect(repo.git('show', '--name-only', '--format=', 'HEAD').trim().split('\n')).toEqual([
      'a.txt',
      'b.txt'
    ])
  })

  it('makes the first commit of an unborn branch', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    repo.write('b.txt', 'b\n')
    repo.git('add', 'b.txt')
    const ctx = await contextOf(repo)
    const result = await createCommit(ctx, {
      summary: 'root',
      description: '',
      amend: false,
      files: [{ path: 'a.txt', kind: 'untracked', selection: { kind: 'all' } }]
    })
    expect(result.ok).toBe(true)
    expect(repo.git('show', '--name-only', '--format=', 'HEAD').trim()).toBe('a.txt')
  })

  it('reports a failing hook', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    repo.commitAll('init')
    repo.write('.git/hooks/pre-commit', '#!/bin/sh\necho "lint failed" >&2\nexit 1\n')
    chmodSync(join(repo.root, '.git/hooks/pre-commit'), 0o755)
    repo.write('a.txt', 'b\n')
    const result = await createCommit(await contextOf(repo), {
      summary: 'Blocked',
      description: '',
      amend: false,
      files: [{ path: 'a.txt', kind: 'modified', selection: { kind: 'all' } }]
    })
    expect(result).toMatchObject({ ok: false, kind: 'hook', command: 'git commit' })
    expect(result.ok ? '' : result.detail).toContain('lint failed')
  })
})

describe('commit.undo', () => {
  it('moves the last commit back into the working tree', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    repo.commitAll('init')
    repo.write('a.txt', 'b\n')
    repo.git('commit', '-qam', 'Second\n\nWith a body')
    const ctx = await contextOf(repo)

    expect(await lastMessage(ctx)).toEqual({ summary: 'Second', description: 'With a body' })
    const result = await undoCommit(ctx)
    expect(result).toEqual({ ok: true, value: { summary: 'Second', description: 'With a body' } })
    expect(repo.git('log', '--format=%s').trim()).toBe('init')
    expect(repo.read('a.txt')).toBe('b\n')
  })

  it('undoes the root commit', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    repo.commitAll('root')
    const ctx = await contextOf(repo)
    expect((await undoCommit(ctx)).ok).toBe(true)
    expect(await lastMessage(ctx)).toEqual({ summary: '', description: '' })
    expect((await readStatus(ctx)).files).toEqual([{ path: 'a.txt', kind: 'added' }])
  })
})

describe('changes.discard', () => {
  it('restores tracked files and deletes untracked and added ones', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    repo.write('gone.txt', 'gone\n')
    repo.commitAll('init')
    repo.write('a.txt', 'changed\n')
    repo.git('rm', '-q', 'gone.txt')
    repo.write('dir/new.txt', 'new\n')
    repo.write('staged.txt', 'staged\n')
    repo.git('add', 'staged.txt')
    const ctx = await contextOf(repo)

    const result = await discardChanges(ctx, {
      files: [
        { path: 'a.txt', kind: 'modified' },
        { path: 'gone.txt', kind: 'deleted' },
        { path: 'dir/new.txt', kind: 'untracked' },
        { path: 'staged.txt', kind: 'added' }
      ]
    })
    expect(result.ok).toBe(true)
    expect(repo.read('a.txt')).toBe('a\n')
    expect(repo.read('gone.txt')).toBe('gone\n')
    expect(existsSync(join(repo.root, 'dir/new.txt'))).toBe(false)
    expect(existsSync(join(repo.root, 'staged.txt'))).toBe(false)
    expect((await readStatus(ctx)).files).toEqual([])
  })

  it('undoes a rename', async () => {
    const repo = make()
    repo.write('old.txt', 'content\n')
    repo.commitAll('init')
    repo.git('mv', 'old.txt', 'new.txt')
    const ctx = await contextOf(repo)
    const result = await discardChanges(ctx, {
      files: [{ path: 'new.txt', oldPath: 'old.txt', kind: 'renamed' }]
    })
    expect(result.ok).toBe(true)
    expect((await readStatus(ctx)).files).toEqual([])
  })

  it('refuses a path outside the repository', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    repo.commitAll('init')
    const ctx = await contextOf(repo)
    await expect(
      discardChanges(ctx, { files: [{ path: '../outside.txt', kind: 'untracked' }] })
    ).rejects.toMatchObject({ code: 'invalid_params' })
  })
})

describe('changes.discardLines', () => {
  it('throws away only the selected lines', async () => {
    const repo = make()
    repo.write('a.txt', 'one\ntwo\nthree\n')
    repo.commitAll('init')
    repo.write('a.txt', 'one\nTWO\nthree\nfour\n')
    const ctx = await contextOf(repo)
    const diff = await textDiff(ctx, 'a.txt')

    const result = await discardLines(ctx, {
      file: { path: 'a.txt', kind: 'modified' },
      hash: diff.hash,
      lines: ordinals(diff, ['-two', '+TWO'])
    })
    expect(result.ok).toBe(true)
    expect(repo.read('a.txt')).toBe('one\ntwo\nthree\nfour\n')
  })

  it('refuses a stale selection', async () => {
    const repo = make()
    repo.write('a.txt', 'one\n')
    repo.commitAll('init')
    repo.write('a.txt', 'one\ntwo\n')
    const ctx = await contextOf(repo)
    const result = await discardLines(ctx, {
      file: { path: 'a.txt', kind: 'modified' },
      hash: 'not-the-hash',
      lines: [0]
    })
    expect(result).toMatchObject({ ok: false, kind: 'stale' })
    expect(repo.read('a.txt')).toBe('one\ntwo\n')
  })
})

describe('changes.ignore', () => {
  it('appends a pattern on its own line', async () => {
    const repo = make()
    repo.write('.gitignore', 'node_modules')
    const ctx = await contextOf(repo)
    await ignorePattern(ctx, { pattern: '*.log' })
    await ignorePattern(ctx, { pattern: '*.log' })
    expect(repo.read('.gitignore')).toBe('node_modules\n*.log\n')
  })
})
