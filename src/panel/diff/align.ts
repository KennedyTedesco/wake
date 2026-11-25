// Pairs the removed and added lines of one change block by how alike they are, the way a person
// reads an edit: a rewritten line faces the line it replaced, and a line inserted between two
// edits faces nothing. Pairing by position alone misaligns everything after an insertion.
import type { ChangeLine } from './rows'

export type AlignedPair = [ChangeLine | null, ChangeLine | null]

// Below this, two lines are different lines, not two versions of one line.
const MIN_SIMILARITY = 0.45
// Blocks larger than this fall back to positional pairing to keep the alignment cheap.
const MAX_CELLS = 40_000

function bigrams(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  const clean = text.trim()
  for (let i = 0; i < clean.length - 1; i++) {
    const pair = clean.slice(i, i + 2)
    counts.set(pair, (counts.get(pair) ?? 0) + 1)
  }
  return counts
}

/** Sørensen–Dice coefficient over character bigrams, 0 to 1. */
export function similarity(a: string, b: string): number {
  if (a.trim() === b.trim()) return 1
  const left = bigrams(a)
  const right = bigrams(b)
  let total = 0
  let shared = 0
  for (const count of left.values()) total += count
  for (const [pair, count] of right) {
    total += count
    shared += Math.min(count, left.get(pair) ?? 0)
  }
  return total === 0 ? 0 : (2 * shared) / total
}

function positional(dels: ChangeLine[], adds: ChangeLine[]): AlignedPair[] {
  return Array.from({ length: Math.max(dels.length, adds.length) }, (_, i) => [
    dels[i] ?? null,
    adds[i] ?? null
  ])
}

/**
 * The best order-preserving pairing: a dynamic program over the block that maximizes the summed
 * similarity of paired lines, as an alignment of two sequences.
 */
export function alignBlock(dels: ChangeLine[], adds: ChangeLine[]): AlignedPair[] {
  if (dels.length === 0 || adds.length === 0) return positional(dels, adds)
  if (dels.length * adds.length > MAX_CELLS) return positional(dels, adds)

  const rows = dels.length + 1
  const cols = adds.length + 1
  const score = new Float64Array(rows * cols)
  const sim = new Float64Array(dels.length * adds.length)
  for (let i = 0; i < dels.length; i++) {
    for (let j = 0; j < adds.length; j++) {
      sim[i * adds.length + j] = similarity(dels[i]?.text ?? '', adds[j]?.text ?? '')
    }
  }
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const s = sim[(i - 1) * adds.length + (j - 1)] ?? 0
      const match =
        s >= MIN_SIMILARITY ? (score[(i - 1) * cols + (j - 1)] ?? 0) + s : Number.NEGATIVE_INFINITY
      score[i * cols + j] = Math.max(
        match,
        score[(i - 1) * cols + j] ?? 0,
        score[i * cols + (j - 1)] ?? 0
      )
    }
  }

  // Walk back from the end, then reverse.
  const out: AlignedPair[] = []
  let i = dels.length
  let j = adds.length
  while (i > 0 || j > 0) {
    const here = score[i * cols + j] ?? 0
    const s = i > 0 && j > 0 ? (sim[(i - 1) * adds.length + (j - 1)] ?? 0) : 0
    if (
      i > 0 &&
      j > 0 &&
      s >= MIN_SIMILARITY &&
      here === (score[(i - 1) * cols + (j - 1)] ?? 0) + s
    ) {
      out.push([dels[i - 1] ?? null, adds[j - 1] ?? null])
      i--
      j--
    } else if (
      j > 0 &&
      (i === 0 || (score[i * cols + (j - 1)] ?? 0) >= (score[(i - 1) * cols + j] ?? 0))
    ) {
      out.push([null, adds[j - 1] ?? null])
      j--
    } else {
      out.push([dels[i - 1] ?? null, null])
      i--
    }
  }
  out.reverse()
  return compact(out)
}

/** Lets a lone removed line and a lone added line share a row when they sit side by side, so a
 *  block of unrelated rewrites still reads as two columns instead of a staircase. */
function compact(pairs: AlignedPair[]): AlignedPair[] {
  const out: AlignedPair[] = []
  let pendingDels: ChangeLine[] = []
  let pendingAdds: ChangeLine[] = []
  const flush = () => {
    out.push(...positional(pendingDels, pendingAdds))
    pendingDels = []
    pendingAdds = []
  }
  for (const [left, right] of pairs) {
    if (left && right) {
      flush()
      out.push([left, right])
    } else if (left) {
      pendingDels.push(left)
    } else if (right) {
      pendingAdds.push(right)
    }
  }
  flush()
  return out
}
