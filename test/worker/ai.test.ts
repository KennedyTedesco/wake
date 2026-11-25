import { afterEach, describe, expect, it } from 'vitest'
import { buildPrompt, parseCommitMessage } from '../../src/worker/ai'
import { patchHash } from '../../src/worker/diff'
import { openRepo } from '../../src/worker/repo'
import { createRepo, type Fixture } from '../fixture'

let repo: Fixture
afterEach(() => repo?.dispose())

describe('parseCommitMessage', () => {
  it('splits the summary from the body', () => {
    expect(
      parseCommitMessage('Add retry to fetch\n\nThe remote drops idle connections.\n')
    ).toEqual({
      summary: 'Add retry to fetch',
      description: 'The remote drops idle connections.'
    })
  })

  it('drops code fences, labels and quotes agents wrap answers in', () => {
    expect(parseCommitMessage('```\nCommit message: "Fix typo in README"\n```')).toEqual({
      summary: 'Fix typo in README',
      description: ''
    })
  })

  it('keeps a quote that ends the summary itself', () => {
    expect(parseCommitMessage('Change greeting to "Hello"')?.summary).toBe(
      'Change greeting to "Hello"'
    )
  })

  it('answers null for an empty answer', () => {
    expect(parseCommitMessage('\n```\n```\n')).toBeNull()
  })
})

describe('buildPrompt', () => {
  it('describes only the selected lines of a file', async () => {
    repo = createRepo()
    repo.write('a.txt', 'one\ntwo\n')
    repo.commitAll('Start the list')
    repo.write('a.txt', 'one\ntwo\nkept line\nleft out\n')
    const ctx = await openRepo(repo.root)
    if (!ctx) throw new Error('not a repository')
    const diff = repo.git(
      ...['diff', '--no-ext-diff', '--no-color', '--find-renames'],
      ...['--diff-algorithm=histogram', '--indent-heuristic', 'HEAD', '--', 'a.txt']
    )
    const prompt = await buildPrompt(
      ctx,
      [
        {
          path: 'a.txt',
          kind: 'modified',
          selection: { kind: 'lines', hash: patchHash(diff), lines: [0] }
        }
      ],
      'Write in Portuguese'
    )
    expect(prompt).toContain('+kept line')
    expect(prompt).not.toContain('left out')
    expect(prompt).toContain('- Start the list')
    expect(prompt).toContain('Write in Portuguese')
  })
})
