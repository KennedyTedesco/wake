import { afterEach, describe, expect, it } from 'vitest'
import { createRepo, type Fixture } from '../../../test/fixture'
import { type ParsedPatch, parsePatch } from './parse'
import { buildPartialPatch } from './patch'

let repo: Fixture
afterEach(() => repo?.dispose())

function workingDiff(path: string, untracked = false): ParsedPatch {
  const args = untracked
    ? ['diff', '--no-index', '--', '/dev/null', path]
    : ['diff', 'HEAD', '--', path]
  try {
    return parsePatch(repo.git(...args))
  } catch (error) {
    // `--no-index` exits 1 when the files differ; execFileSync then throws with the output.
    const stdout = error && typeof error === 'object' && 'stdout' in error ? error.stdout : ''
    return parsePatch(String(stdout))
  }
}

function ordinalsOf(patch: ParsedPatch, texts: string[]): Set<number> {
  const picked = new Set<number>()
  for (const hunk of patch.hunks) {
    for (const line of hunk.lines) {
      if (
        line.type !== 'context' &&
        texts.includes(`${line.type === 'add' ? '+' : '-'}${line.text}`)
      ) {
        picked.add(line.ordinal)
      }
    }
  }
  return picked
}
function stage(patchText: string) {
  repo.write('.selection.patch', patchText)
  repo.git('apply', '--cached', '.selection.patch')
}

function discard(patchText: string) {
  repo.write('.selection.patch', patchText)
  repo.git('apply', '--reverse', '.selection.patch')
}

const lines = (count: number, prefix = 'line') =>
  `${Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`).join('\n')}\n`

describe('parsePatch', () => {
  it('numbers lines and counts changes', () => {
    repo = createRepo()
    repo.write('a.txt', 'one\ntwo\nthree\n')
    repo.commitAll('init')
    repo.write('a.txt', 'one\n2\nthree\nfour\n')
    const patch = workingDiff('a.txt')
    expect(patch.additions).toBe(2)
    expect(patch.deletions).toBe(1)
    expect(patch.changedLineCount).toBe(3)
    const [hunk] = patch.hunks
    expect(hunk?.lines.map((l) => l.type)).toEqual(['context', 'del', 'add', 'context', 'add'])
    expect(hunk?.lines.at(-1)).toMatchObject({ type: 'add', newNo: 4, ordinal: 2 })
  })

  it('keeps a removed line that looks like a header inside its hunk', () => {
    repo = createRepo()
    repo.write('a.md', '-- x\nkeep\n')
    repo.commitAll('init')
    repo.write('a.md', 'keep\n')
    const patch = workingDiff('a.md')
    expect(patch.hunks[0]?.lines[0]).toMatchObject({ type: 'del', text: '-- x' })
  })

  it('marks the line that has no newline at end of file', () => {
    repo = createRepo()
    repo.write('a.txt', 'a\nb')
    repo.commitAll('init')
    repo.write('a.txt', 'a\nb\nc\n')
    const patch = workingDiff('a.txt')
    const del = patch.hunks[0]?.lines.find((l) => l.type === 'del')
    expect(del).toMatchObject({ text: 'b', noNewline: true })
  })
})

describe('buildPartialPatch: stage', () => {
  it('stages only the selected lines across hunks', () => {
    repo = createRepo()
    repo.write('a.txt', lines(30))
    repo.commitAll('init')
    const next = lines(30)
      .replace('line 2\n', 'line two\n')
      .replace('line 25\n', 'line twenty-five\n')
      .replace('line 28\n', 'line 28\nextra\n')
    repo.write('a.txt', next)
    const patch = workingDiff('a.txt')
    expect(patch.hunks.length).toBe(2)

    const selected = ordinalsOf(patch, ['-line 25', '+line twenty-five', '+extra'])
    stage(buildPartialPatch(patch, selected, 'stage') ?? '')

    const staged = repo.git('show', ':a.txt')
    expect(staged).toBe(
      lines(30).replace('line 25\n', 'line twenty-five\n').replace('line 28\n', 'line 28\nextra\n')
    )
  })

  it('keeps an unselected removal in the index', () => {
    repo = createRepo()
    repo.write('a.txt', 'a\nb\nc\n')
    repo.commitAll('init')
    repo.write('a.txt', 'a\nB\nc\nd\n')
    const patch = workingDiff('a.txt')
    stage(buildPartialPatch(patch, ordinalsOf(patch, ['+d']), 'stage') ?? '')
    expect(repo.git('show', ':a.txt')).toBe('a\nb\nc\nd\n')
  })

  it('stages part of a new file', () => {
    repo = createRepo()
    repo.write('base.txt', 'x\n')
    repo.commitAll('init')
    repo.write('new.txt', 'keep 1\ndrop\nkeep 2\n')
    const patch = workingDiff('new.txt', true)
    expect(patch.isNew).toBe(true)
    stage(buildPartialPatch(patch, ordinalsOf(patch, ['+keep 1', '+keep 2']), 'stage') ?? '')
    expect(repo.git('show', ':new.txt')).toBe('keep 1\nkeep 2\n')
  })

  it('stages part of a deletion as a smaller file', () => {
    repo = createRepo()
    repo.write('gone.txt', 'a\nb\nc\n')
    repo.commitAll('init')
    repo.git('rm', '-q', 'gone.txt')
    repo.git('reset', '-q')
    const patch = workingDiff('gone.txt')
    expect(patch.isDeleted).toBe(true)
    stage(buildPartialPatch(patch, ordinalsOf(patch, ['-b']), 'stage') ?? '')
    expect(repo.git('show', ':gone.txt')).toBe('a\nc\n')
  })

  it('answers null when nothing is selected', () => {
    repo = createRepo()
    repo.write('a.txt', 'a\n')
    repo.commitAll('init')
    repo.write('a.txt', 'b\n')
    expect(buildPartialPatch(workingDiff('a.txt'), new Set(), 'stage')).toBeNull()
  })

  it('stages an added last line when the old file had no newline at its end', () => {
    repo = createRepo()
    repo.write('a.txt', 'a\nb')
    repo.commitAll('init')
    repo.write('a.txt', 'a\nb\nc\n')
    const patch = workingDiff('a.txt')
    stage(buildPartialPatch(patch, ordinalsOf(patch, ['-b', '+b']), 'stage') ?? '')
    expect(repo.git('show', ':a.txt')).toBe('a\nb\n')
  })
})

describe('buildPartialPatch: discard', () => {
  it('reverts only the selected lines in the working tree', () => {
    repo = createRepo()
    repo.write('a.txt', lines(30))
    repo.commitAll('init')
    const changed = lines(30)
      .replace('line 2\n', 'line two\n')
      .replace('line 25\n', 'twenty-five\n')
    repo.write('a.txt', changed)
    const patch = workingDiff('a.txt')
    discard(buildPartialPatch(patch, ordinalsOf(patch, ['-line 2', '+line two']), 'discard') ?? '')
    expect(repo.read('a.txt')).toBe(lines(30).replace('line 25\n', 'twenty-five\n'))
  })

  it('discards one added line of an untracked file and keeps the file', () => {
    repo = createRepo()
    repo.write('base.txt', 'x\n')
    repo.commitAll('init')
    repo.write('new.txt', 'a\nb\nc\n')
    const patch = workingDiff('new.txt', true)
    discard(buildPartialPatch(patch, ordinalsOf(patch, ['+b']), 'discard') ?? '')
    expect(repo.read('new.txt')).toBe('a\nc\n')
  })

  it('refuses lines of a deleted file', () => {
    repo = createRepo()
    repo.write('a.txt', 'a\n')
    repo.commitAll('init')
    repo.git('rm', '-q', 'a.txt')
    repo.git('reset', '-q')
    const patch = workingDiff('a.txt')
    expect(() => buildPartialPatch(patch, new Set([0]), 'discard')).toThrow()
  })
})
