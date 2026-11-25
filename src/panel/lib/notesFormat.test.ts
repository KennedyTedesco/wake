import { describe, expect, it } from 'vitest'
import type { ReviewNote } from '../state/notes'
import { formatNotes } from './notesFormat'

const note = (patch: Partial<ReviewNote>): ReviewNote => ({
  id: 'n',
  source: { kind: 'working' },
  path: 'src/a.ts',
  anchor: { kind: 'file' },
  body: 'Rename this',
  createdAt: 0,
  ...patch
})

describe('formatNotes', () => {
  it('writes lines, code and the comment in Orca note format', () => {
    const text = formatNotes([
      note({
        anchor: {
          kind: 'lines',
          side: 'new',
          start: 12,
          end: 13,
          excerpt: ['-const a = 1', '+const a = 2', ' const b = 2']
        },
        body: 'Use one "const" here\nand name it total'
      })
    ])
    expect(text).toBe(
      [
        'Review note from Wake. Please make this change:',
        '',
        'File: src/a.ts',
        'Lines: 12-13',
        'Code (diff: + added, - removed):',
        '> -const a = 1',
        '> +const a = 2',
        '>  const b = 2',
        'User comment: "Use one \\"const\\" here\\nand name it total"'
      ].join('\n')
    )
  })

  it('names the commit and marks removed lines', () => {
    const text = formatNotes([
      note({
        source: { kind: 'commit', sha: 'abcdef0123', shortSha: 'abcdef0' },
        anchor: { kind: 'file' }
      }),
      note({ anchor: { kind: 'lines', side: 'old', start: 4, end: 4, excerpt: [] } })
    ])
    expect(text).toContain('Please make these 2 changes:')
    expect(text).toContain('Commit: abcdef0\nScope: file')
    expect(text).toContain('Line: 4 (removed lines, numbered as before the change)')
  })
})
