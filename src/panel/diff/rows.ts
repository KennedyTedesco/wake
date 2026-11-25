// Turns a parsed patch into the rows the diff view draws: unified or side by side, with the
// unchanged lines between hunks that the person chose to expand.
import type { DiffLine, Hunk, ParsedPatch } from '../../shared/diff/parse'
import { alignBlock } from './align'

export type ContextLine = Extract<DiffLine, { type: 'context' }>
export type ChangeLine = Exclude<DiffLine, { type: 'context' }>

/** Unchanged lines hidden before hunk `index` (or after the last hunk, `index === hunks.length`). */
export type Gap = {
  index: number
  /** First and last hidden line on the new side, 1-based and inclusive. */
  firstNew: number
  lastNew: number
  /** Old line number minus new line number inside the gap. */
  offset: number
}

/** Lines revealed at each end of a gap: right after the previous hunk, right before the next. */
export type Expansion = Record<number, { afterPrevious: number; beforeNext: number }>

export type Row =
  | {
      kind: 'hunk'
      key: string
      hunkIndex: number
      hunk: Hunk | null
      gap: Gap | null
      hidden: number
    }
  | { kind: 'line'; key: string; line: DiffLine; hunkIndex: number | null }
  | {
      kind: 'pair'
      key: string
      left: DiffLine | null
      right: DiffLine | null
      hunkIndex: number | null
    }

export const EXPAND_STEP = 20

const lineBefore = (start: number, count: number) => (count === 0 ? start : start - 1)
const lineAfter = (start: number, count: number) => (count === 0 ? start + 1 : start + count)

export function findGaps(hunks: Hunk[], newLineCount: number | null): Gap[] {
  if (newLineCount === null || hunks.length === 0) return []
  const gaps: Gap[] = []
  let nextNew = 1
  let nextOld = 1
  hunks.forEach((hunk, index) => {
    const lastNew = lineBefore(hunk.newStart, hunk.newCount)
    if (lastNew >= nextNew)
      gaps.push({ index, firstNew: nextNew, lastNew, offset: nextOld - nextNew })
    nextNew = lineAfter(hunk.newStart, hunk.newCount)
    nextOld = lineAfter(hunk.oldStart, hunk.oldCount)
  })
  if (newLineCount >= nextNew) {
    gaps.push({
      index: hunks.length,
      firstNew: nextNew,
      lastNew: newLineCount,
      offset: nextOld - nextNew
    })
  }
  return gaps
}

export function splitLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function contextLine(newNo: number, gap: Gap, newLines: string[]): ContextLine {
  return {
    type: 'context',
    text: newLines[newNo - 1] ?? '',
    oldNo: newNo + gap.offset,
    newNo,
    noNewline: false
  }
}

type HeaderRow = Extract<Row, { kind: 'hunk' }>
type Entry =
  | { kind: 'header'; row: HeaderRow }
  | { kind: 'line'; line: DiffLine; hunkIndex: number | null }

function revealedLines(
  gap: Gap,
  expansion: Expansion,
  newLines: string[]
): { before: ContextLine[]; after: ContextLine[]; hidden: number } {
  const size = gap.lastNew - gap.firstNew + 1
  const state = expansion[gap.index] ?? { afterPrevious: 0, beforeNext: 0 }
  const afterPrevious = Math.min(state.afterPrevious, size)
  const beforeNext = Math.min(state.beforeNext, size - afterPrevious)
  const before: ContextLine[] = []
  const after: ContextLine[] = []
  for (let i = 0; i < afterPrevious; i++) before.push(contextLine(gap.firstNew + i, gap, newLines))
  for (let i = beforeNext; i > 0; i--) after.push(contextLine(gap.lastNew - i + 1, gap, newLines))
  return { before, after, hidden: size - afterPrevious - beforeNext }
}

/** The hunks with their headers and expanded context, in display order. */
function buildEntries(patch: ParsedPatch, newText: string | null, expansion: Expansion): Entry[] {
  const newLines = newText === null ? null : splitLines(newText)
  const gaps = findGaps(patch.hunks, newLines?.length ?? null)
  const gapAt = new Map(gaps.map((gap) => [gap.index, gap]))
  const entries: Entry[] = []

  for (let index = 0; index <= patch.hunks.length; index++) {
    const hunk = patch.hunks[index] ?? null
    const gap = gapAt.get(index) ?? null
    const revealed = gap && newLines ? revealedLines(gap, expansion, newLines) : null
    for (const line of revealed?.before ?? []) entries.push({ kind: 'line', line, hunkIndex: null })
    const hidden = revealed?.hidden ?? 0
    // A header earns its row when it starts a hunk or still hides lines.
    if (hunk || hidden > 0) {
      entries.push({
        kind: 'header',
        row: { kind: 'hunk', key: `h${index}`, hunkIndex: index, hunk, gap, hidden }
      })
    }
    for (const line of revealed?.after ?? []) entries.push({ kind: 'line', line, hunkIndex: null })
    for (const line of hunk?.lines ?? []) entries.push({ kind: 'line', line, hunkIndex: index })
  }
  return entries
}

const lineKey = (line: DiffLine) =>
  line.type === 'context' ? `c${line.oldNo}:${line.newNo}` : `${line.type}${line.ordinal}`

export function unifiedRows(
  patch: ParsedPatch,
  newText: string | null,
  expansion: Expansion
): Row[] {
  return buildEntries(patch, newText, expansion).map((entry) =>
    entry.kind === 'header'
      ? entry.row
      : { kind: 'line', key: lineKey(entry.line), line: entry.line, hunkIndex: entry.hunkIndex }
  )
}

/** Side by side: a change block's removed lines face the added lines most like them. */
export function splitRows(patch: ParsedPatch, newText: string | null, expansion: Expansion): Row[] {
  const rows: Row[] = []
  let dels: ChangeLine[] = []
  let adds: ChangeLine[] = []
  let blockHunk: number | null = null
  const flush = () => {
    for (const [left, right] of alignBlock(dels, adds)) {
      rows.push({
        kind: 'pair',
        key: `p${left ? lineKey(left) : ''}|${right ? lineKey(right) : ''}`,
        left,
        right,
        hunkIndex: blockHunk
      })
    }
    dels = []
    adds = []
  }
  for (const entry of buildEntries(patch, newText, expansion)) {
    if (entry.kind === 'header') {
      flush()
      rows.push(entry.row)
    } else if (entry.line.type === 'del') {
      if (adds.length > 0) flush()
      blockHunk = entry.hunkIndex
      dels.push(entry.line)
    } else if (entry.line.type === 'add') {
      if (dels.length === 0 && adds.length === 0) blockHunk = entry.hunkIndex
      adds.push(entry.line)
    } else {
      flush()
      const { line, hunkIndex } = entry
      rows.push({ kind: 'pair', key: lineKey(line), left: line, right: line, hunkIndex })
    }
  }
  flush()
  return rows
}

/** Each changed line's counterpart in its change block, both ways, as `alignBlock` pairs them. */
export function pairChangedLines(patch: ParsedPatch): Map<number, ChangeLine> {
  const partners = new Map<number, ChangeLine>()
  const pairBlock = (dels: ChangeLine[], adds: ChangeLine[]) => {
    for (const [left, right] of alignBlock(dels, adds)) {
      if (!left || !right) continue
      partners.set(left.ordinal, right)
      partners.set(right.ordinal, left)
    }
  }
  for (const hunk of patch.hunks) {
    let dels: ChangeLine[] = []
    let adds: ChangeLine[] = []
    for (const line of hunk.lines) {
      if (line.type === 'add') {
        adds.push(line)
        continue
      }
      if (line.type === 'del' && adds.length === 0) {
        dels.push(line)
        continue
      }
      pairBlock(dels, adds)
      dels = line.type === 'del' ? [line] : []
      adds = []
    }
    pairBlock(dels, adds)
  }
  return partners
}

/** The ordinals of a hunk's changed lines. */
export function hunkOrdinals(hunk: Hunk): number[] {
  const ordinals: number[] = []
  for (const line of hunk.lines) if (line.type !== 'context') ordinals.push(line.ordinal)
  return ordinals
}
