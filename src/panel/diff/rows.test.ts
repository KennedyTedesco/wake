import { describe, expect, it } from 'vitest'
import { parsePatch } from '../../shared/diff/parse'
import { intralineRanges } from './intraline'
import { findGaps, pairChangedLines, splitRows, unifiedRows } from './rows'

const file = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`)
const newText = `${file.map((line, i) => (i === 19 ? 'changed 20' : line)).join('\n')}\n`
const patch = parsePatch(
  [
    'diff --git a/a.txt b/a.txt',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -17,7 +17,7 @@ section',
    ' line 17',
    ' line 18',
    ' line 19',
    '-line 20',
    '+changed 20',
    ' line 21',
    ' line 22',
    ' line 23',
    ''
  ].join('\n')
)

describe('diff rows', () => {
  it('finds the hidden lines above and below the hunk', () => {
    expect(findGaps(patch.hunks, 40)).toEqual([
      { index: 0, firstNew: 1, lastNew: 16, offset: 0 },
      { index: 1, firstNew: 24, lastNew: 40, offset: 0 }
    ])
  })

  it('reveals lines next to the hunk when a gap is expanded', () => {
    const rows = unifiedRows(patch, newText, { 0: { afterPrevious: 0, beforeNext: 3 } })
    const lines = rows.flatMap((row) => (row.kind === 'line' ? [row.line] : []))
    expect(lines.slice(0, 3).map((line) => line.type === 'context' && line.newNo)).toEqual([
      14, 15, 16
    ])
    const header = rows.find((row) => row.kind === 'hunk' && row.hunkIndex === 0)
    expect(header).toMatchObject({ hidden: 13 })
  })

  it('drops a gap header once every hidden line shows', () => {
    const rows = unifiedRows(patch, newText, { 1: { afterPrevious: 100, beforeNext: 0 } })
    expect(rows.some((row) => row.kind === 'hunk' && row.hunk === null)).toBe(false)
    expect(rows.at(-1)).toMatchObject({ kind: 'line', line: { newNo: 40, oldNo: 40 } })
  })

  it('pairs a removed line with its replacement side by side', () => {
    const pairs = splitRows(patch, null, {}).filter((row) => row.kind === 'pair')
    const changed = pairs.find((row) => row.kind === 'pair' && row.left?.type === 'del')
    expect(changed).toMatchObject({ left: { text: 'line 20' }, right: { text: 'changed 20' } })
    expect(pairChangedLines(patch).get(0)).toMatchObject({ type: 'add', text: 'changed 20' })
  })
})

describe('intralineRanges', () => {
  it('marks only the edited word', () => {
    expect(intralineRanges('const answer = 41', 'const answer = 42')).toEqual({
      before: [[15, 17]],
      after: [[15, 17]]
    })
  })

  it('skips lines that were rewritten', () => {
    expect(intralineRanges('alpha beta gamma', 'completely different')).toBeNull()
  })
})
