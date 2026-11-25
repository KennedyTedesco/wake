import { diffWordsWithSpace } from 'diff'

/** Half-open character range [start, end) of a line. */
export type Range = [number, number]

const MAX_LENGTH = 1000
// Below this share of unchanged characters, word highlights only add noise: the line was
// rewritten, not edited.
const MIN_SIMILARITY = 0.4

/** The changed words between a removed line and the added line that replaced it. */
export function intralineRanges(
  before: string,
  after: string
): { before: Range[]; after: Range[] } | null {
  if (before.length > MAX_LENGTH || after.length > MAX_LENGTH || before === after) return null
  const parts = diffWordsWithSpace(before, after)
  const removed: Range[] = []
  const added: Range[] = []
  let beforeAt = 0
  let afterAt = 0
  let same = 0
  for (const part of parts) {
    const length = part.value.length
    if (part.added) {
      added.push([afterAt, afterAt + length])
      afterAt += length
    } else if (part.removed) {
      removed.push([beforeAt, beforeAt + length])
      beforeAt += length
    } else {
      same += length
      beforeAt += length
      afterAt += length
    }
  }
  if (same / Math.max(before.length, after.length, 1) < MIN_SIMILARITY) return null
  return { before: merge(removed), after: merge(added) }
}

function merge(ranges: Range[]): Range[] {
  const merged: Range[] = []
  for (const range of ranges) {
    const last = merged.at(-1)
    if (last && last[1] >= range[0]) last[1] = Math.max(last[1], range[1])
    else merged.push([range[0], range[1]])
  }
  return merged
}
