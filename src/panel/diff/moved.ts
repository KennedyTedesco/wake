// Finds code that moved: a run of removed lines that comes back, line for line, as a run of
// added lines in another place. Like `git diff --color-moved`, but it also follows code that was
// re-indented on the way, which is how moved code usually arrives.
import type { ParsedPatch } from '../../shared/diff/parse'
import type { ChangeLine } from './rows'

export type Move = {
  /** The line number at the other end of the move: new side for a removed line, old for added. */
  otherLine: number
  /** The first line of its moved run, where the panel names the move. */
  runStart: boolean
  runLength: number
}

// Shorter runs match by accident: a lone `}` or `return null` is everywhere.
const MIN_RUN = 3
const MIN_RUN_CHARS = 40

const key = (text: string) => text.trim()

/** A line that carries content; blank lines and lone brackets never start a move. */
function meaningful(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text)
}

type Located = { line: ChangeLine; block: number }

function changedRuns(patch: ParsedPatch) {
  const dels: Located[] = []
  const adds: Located[] = []
  let block = 0
  for (const hunk of patch.hunks) {
    let inChange = false
    for (const line of hunk.lines) {
      if (line.type === 'context') {
        inChange = false
        continue
      }
      if (!inChange) {
        block++
        inChange = true
      }
      if (line.type === 'del') dels.push({ line, block })
      else adds.push({ line, block })
    }
    block++
  }
  return { dels, adds }
}

export function findMoves(patch: ParsedPatch): Map<number, Move> {
  const moves = new Map<number, Move>()
  if (patch.additions === 0 || patch.deletions === 0) return moves
  const { dels, adds } = changedRuns(patch)

  const addsByKey = new Map<string, number[]>()
  adds.forEach((entry, index) => {
    const text = key(entry.line.text)
    if (!meaningful(text)) return
    const list = addsByKey.get(text) ?? []
    list.push(index)
    addsByKey.set(text, list)
  })

  let d = 0
  while (d < dels.length) {
    const start = dels[d]
    if (!start || moves.has(start.line.ordinal) || !meaningful(key(start.line.text))) {
      d++
      continue
    }
    let best = { length: 0, addIndex: -1 }
    for (const candidate of addsByKey.get(key(start.line.text)) ?? []) {
      const first = adds[candidate]
      // Removed and added in the same block is an edit in place (often re-indentation).
      if (!first || first.block === start.block || moves.has(first.line.ordinal)) continue
      let length = 0
      while (true) {
        const del = dels[d + length]
        const add = adds[candidate + length]
        if (!del || !add || key(del.line.text) !== key(add.line.text)) break
        if (length > 0 && !consecutive(dels[d + length - 1]?.line, del.line)) break
        if (length > 0 && !consecutive(adds[candidate + length - 1]?.line, add.line)) break
        length++
      }
      if (length > best.length) best = { length, addIndex: candidate }
    }

    const run = dels.slice(d, d + best.length)
    const chars = run.reduce((sum, entry) => sum + key(entry.line.text).length, 0)
    if (best.length >= MIN_RUN && chars >= MIN_RUN_CHARS) {
      for (let i = 0; i < best.length; i++) {
        const del = dels[d + i]?.line
        const add = adds[best.addIndex + i]?.line
        if (!del || !add || del.type !== 'del' || add.type !== 'add') continue
        const run = { runStart: i === 0, runLength: best.length }
        moves.set(del.ordinal, { otherLine: add.newNo, ...run })
        moves.set(add.ordinal, { otherLine: del.oldNo, ...run })
      }
      d += best.length
    } else {
      d++
    }
  }
  return moves
}

/** Whether `next` directly follows `previous` in its file. */
function consecutive(previous: ChangeLine | undefined, next: ChangeLine): boolean {
  if (!previous || previous.type !== next.type) return false
  return previous.type === 'del' && next.type === 'del'
    ? next.oldNo === previous.oldNo + 1
    : previous.type === 'add' && next.type === 'add' && next.newNo === previous.newNo + 1
}
