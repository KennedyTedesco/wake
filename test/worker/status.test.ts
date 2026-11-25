import { describe, expect, it } from 'vitest'
import { parseStatus, readSnapshot, remoteInfo } from '../../src/worker/status'
import { contextOf, tempRepos, withRemote } from './context'

const make = tempRepos()

describe('repo.state', () => {
  it('lists every kind of change', async () => {
    const repo = make()
    repo.write('modified.txt', 'a\n')
    repo.write('deleted.txt', 'a\n')
    repo.write('old-name.txt', 'some content that stays the same\nacross the rename\n')
    repo.commitAll('init')
    repo.write('modified.txt', 'b\n')
    repo.git('rm', '-q', 'deleted.txt')
    repo.git('mv', 'old-name.txt', 'new name.txt')
    repo.write('added.txt', 'new\n')
    repo.git('add', 'added.txt')
    repo.write('dir/nested/untracked.txt', 'x\n')

    const snapshot = await readSnapshot(await contextOf(repo), 'ws')
    const byPath = Object.fromEntries(snapshot.files.map((file) => [file.path, file]))
    expect(byPath['modified.txt']?.kind).toBe('modified')
    expect(byPath['deleted.txt']?.kind).toBe('deleted')
    expect(byPath['new name.txt']).toEqual({
      path: 'new name.txt',
      oldPath: 'old-name.txt',
      kind: 'renamed'
    })
    expect(byPath['added.txt']?.kind).toBe('added')
    expect(byPath['dir/nested/untracked.txt']?.kind).toBe('untracked')
    expect(snapshot.head).toEqual({ kind: 'branch', name: 'main', upstream: null })
    expect(snapshot.workspaceName).toBe('ws')
    expect(snapshot.operation).toBeNull()
    expect(snapshot.lastCommit).toMatchObject({ summary: 'init', pushed: false })
  })

  it('reports an unborn branch', async () => {
    const repo = make()
    repo.write('a.txt', 'a\n')
    const snapshot = await readSnapshot(await contextOf(repo), 'ws')
    expect(snapshot.head).toEqual({ kind: 'unborn', name: 'main' })
    expect(snapshot.lastCommit).toBeNull()
    expect(snapshot.files).toEqual([{ path: 'a.txt', kind: 'untracked' }])
  })

  it('reports a merge with conflicts', async () => {
    const repo = make()
    repo.write('a.txt', 'base\n')
    repo.commitAll('init')
    repo.git('switch', '-q', '-c', 'feature')
    repo.write('a.txt', 'feature\n')
    repo.commitAll('feature')
    repo.git('switch', '-q', 'main')
    repo.write('a.txt', 'main\n')
    repo.commitAll('main')
    expect(() => repo.git('merge', 'feature')).toThrow()

    const snapshot = await readSnapshot(await contextOf(repo), 'ws')
    expect(snapshot.operation).toBe('merge')
    expect(snapshot.files).toEqual([{ path: 'a.txt', kind: 'conflicted' }])
  })

  it('tracks the upstream, the remote and pushed state', async () => {
    const { repo } = withRemote(make)
    repo.write('b.txt', 'b\n')
    repo.commitAll('second')

    const snapshot = await readSnapshot(await contextOf(repo), 'ws')
    expect(snapshot.head).toMatchObject({
      kind: 'branch',
      name: 'main',
      upstream: { name: 'origin/main', remote: 'origin', ahead: 1, behind: 0, gone: false }
    })
    expect(snapshot.remote?.name).toBe('origin')
    expect(snapshot.lastCommit).toMatchObject({ summary: 'second', pushed: false })
    expect(snapshot.stashCount).toBe(0)
  })
})

describe('parseStatus', () => {
  it('caps the untracked files', () => {
    const output = ['# branch.oid (initial)', '# branch.head main', '? a', '? b', '? c', ''].join(
      '\0'
    )
    const status = parseStatus(output, 2)
    expect(status.files).toHaveLength(2)
    expect(status.truncated).toBe(true)
    expect(status.branch.oid).toBeNull()
  })

  it('marks a gone upstream', () => {
    const output = [
      '# branch.oid abc',
      '# branch.head main',
      '# branch.upstream origin/main',
      ''
    ].join('\0')
    expect(parseStatus(output).branch).toMatchObject({
      upstream: 'origin/main',
      hasAheadBehind: false
    })
  })
})

describe('remoteInfo', () => {
  it.each([
    ['git@github.com:o/r.git', 'https://github.com/o/r', 'github'],
    ['https://gitlab.com/group/sub/r.git', 'https://gitlab.com/group/sub/r', 'gitlab'],
    ['ssh://git@bitbucket.org:22/o/r', 'https://bitbucket.org/o/r', 'bitbucket'],
    ['/tmp/remote.git', null, 'other']
  ])('reads %s', (url, webUrl, host) => {
    expect(remoteInfo('origin', url)).toEqual({ name: 'origin', url, webUrl, host })
  })
})
