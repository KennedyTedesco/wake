import { describe, expect, it } from 'vitest'
import { parsePatch } from '../../shared/diff/parse'
import { alignBlock, similarity } from './align'
import { findMoves } from './moved'
import type { ChangeLine } from './rows'

let ordinal = 0
const del = (text: string, oldNo: number): ChangeLine => ({
  type: 'del',
  text,
  oldNo,
  ordinal: ordinal++,
  noNewline: false
})
const add = (text: string, newNo: number): ChangeLine => ({
  type: 'add',
  text,
  newNo,
  ordinal: ordinal++,
  noNewline: false
})

describe('alignBlock', () => {
  it('pairs an edited line with its new version past an inserted line', () => {
    const removed = [del('const total = items.length', 1), del('return total * price', 2)]
    const added = [
      add('const total = items.length + extra', 1),
      add('log("computing")', 2),
      add('return total * unitPrice', 3)
    ]
    const pairs = alignBlock(removed, added).map(([l, r]) => [l?.text ?? null, r?.text ?? null])
    expect(pairs).toEqual([
      ['const total = items.length', 'const total = items.length + extra'],
      [null, 'log("computing")'],
      ['return total * price', 'return total * unitPrice']
    ])
  })

  it('rates identical text as fully similar and unrelated text low', () => {
    expect(similarity('  foo(bar)', 'foo(bar)')).toBe(1)
    expect(similarity('import x from "y"', 'while (true) {}')).toBeLessThan(0.3)
  })
})

describe('findMoves', () => {
  it('marks a block that moved to another place, re-indented', () => {
    const patch = parsePatch(
      [
        'diff --git a/a.ts b/a.ts',
        '--- a/a.ts',
        '+++ b/a.ts',
        '@@ -1,6 +1,3 @@',
        '-function helper(value) {',
        '-  return value.trim().toLowerCase()',
        '-}',
        ' const a = 1',
        ' const b = 2',
        ' const c = 3',
        '@@ -20,2 +17,6 @@',
        ' const y = 9',
        ' const z = 10',
        '+export const tools = {',
        '+  function helper(value) {',
        '+    return value.trim().toLowerCase()',
        '+  }',
        ''
      ].join('\n')
    )
    const moves = findMoves(patch)
    expect(moves.get(0)).toEqual({ otherLine: 20, runStart: true, runLength: 3 })
    expect(moves.size).toBe(6)
  })

  it('leaves an in-place re-indent alone', () => {
    const patch = parsePatch(
      [
        'diff --git a/a.ts b/a.ts',
        '--- a/a.ts',
        '+++ b/a.ts',
        '@@ -1,3 +1,3 @@',
        '-if (ready) {',
        '-start(engine, options)',
        '-}',
        '+  if (ready) {',
        '+  start(engine, options)',
        '+  }',
        ''
      ].join('\n')
    )
    expect(findMoves(patch).size).toBe(0)
  })
})
