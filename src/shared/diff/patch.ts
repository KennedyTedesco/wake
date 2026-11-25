// Turns a line selection into a patch git can apply.
//
// `stage` builds the part of the change to put in the index, applied with `git apply --cached`
// to an index that matches HEAD. `discard` builds the part to throw away, applied with
// `git apply --reverse` to the working tree.
import type { DiffLine, Hunk, ParsedPatch } from './parse'

export type PatchMode = 'stage' | 'discard'

type OutLine = { marker: ' ' | '+' | '-'; text: string; noNewline: boolean }

/** How a line of the original diff appears in the partial patch, or null to leave it out. */
function project(line: DiffLine, selected: ReadonlySet<number>, mode: PatchMode): OutLine | null {
  const { text, noNewline } = line
  if (line.type === 'context') return { marker: ' ', text, noNewline }
  const isSelected = selected.has(line.ordinal)
  if (isSelected) return { marker: line.type === 'add' ? '+' : '-', text, noNewline }
  // An unselected change keeps the side the patch applies to as it is: the index (HEAD) holds
  // the removed lines, the working tree holds the added ones.
  const keptSide = mode === 'stage' ? 'del' : 'add'
  return line.type === keptSide ? { marker: ' ', text, noNewline } : null
}

function counts(lines: OutLine[]): { old: number; new: number } {
  let oldCount = 0
  let newCount = 0
  for (const line of lines) {
    if (line.marker !== '+') oldCount++
    if (line.marker !== '-') newCount++
  }
  return { old: oldCount, new: newCount }
}

/** A start line as a hunk header writes it: the line before the change when the side is empty. */
function headerStart(firstLine: number, count: number): number {
  return count === 0 ? firstLine - 1 : firstLine
}

function firstLine(start: number, count: number): number {
  return count === 0 ? start + 1 : start
}

function rewriteHeader(patch: ParsedPatch, mode: PatchMode, partial: boolean): string[] {
  const header = patch.header.filter((line) => !line.startsWith('index '))
  const minus = header.findIndex((line) => line.startsWith('--- '))
  const plus = header.findIndex((line) => line.startsWith('+++ '))
  const toSide = (line: string, from: 'a/' | 'b/', to: 'a/' | 'b/') =>
    line.replace(`"${from}`, `"${to}`).replace(` ${from}`, ` ${to}`)

  // Staging some of a deleted file's lines leaves the file in place, smaller: a modification.
  if (mode === 'stage' && patch.isDeleted && partial && minus >= 0 && plus >= 0) {
    const oldName = header[minus] ?? ''
    header[plus] = toSide(oldName.replace(/^--- /, '+++ '), 'a/', 'b/')
    return header.filter((line) => !line.startsWith('deleted file mode'))
  }
  // Discarding some lines of a new file keeps the file on disk: also a modification.
  if (mode === 'discard' && patch.isNew && minus >= 0 && plus >= 0) {
    const newName = header[plus] ?? ''
    header[minus] = toSide(newName.replace(/^\+\+\+ /, '--- '), 'b/', 'a/')
    return header.filter((line) => !line.startsWith('new file mode'))
  }
  // Discarding lines never reverts the file mode along with them.
  if (mode === 'discard') {
    return header.filter((line) => !line.startsWith('old mode') && !line.startsWith('new mode'))
  }
  return header
}

/**
 * The patch for the selected changed lines, or null when the selection holds no change.
 * Throws for a selection the patch format cannot express (discarding lines of a deleted file).
 */
export function buildPartialPatch(
  patch: ParsedPatch,
  selected: ReadonlySet<number>,
  mode: PatchMode
): string | null {
  if (mode === 'discard' && patch.isDeleted) {
    throw new Error('Lines of a deleted file cannot be discarded one by one')
  }

  const body: string[] = []
  // Lines the emitted hunks add minus lines they remove, which shifts every later hunk.
  let delta = 0
  let partial = false

  for (const hunk of patch.hunks) {
    const out: OutLine[] = []
    let hasChange = false
    for (const line of hunk.lines) {
      const projected = project(line, selected, mode)
      if (line.type !== 'context' && !selected.has(line.ordinal)) partial = true
      if (!projected) continue
      if (projected.marker !== ' ') hasChange = true
      out.push(projected)
    }
    if (!hasChange) continue

    const sizes = counts(out)
    const header = hunkHeader(hunk, sizes, delta, mode)
    delta += sizes.new - sizes.old
    body.push(header)
    for (const line of out) {
      body.push(`${line.marker}${line.text}`)
      if (line.noNewline) body.push('\\ No newline at end of file')
    }
  }

  if (body.length === 0) return null
  return `${[...rewriteHeader(patch, mode, partial), ...body].join('\n')}\n`
}

function hunkHeader(
  hunk: Hunk,
  sizes: { old: number; new: number },
  delta: number,
  mode: PatchMode
): string {
  // The side the patch applies to keeps the hunk's own position; the other side moves by the
  // changes earlier hunks made.
  let oldStart: number
  let newStart: number
  if (mode === 'stage') {
    const first = firstLine(hunk.oldStart, hunk.oldCount)
    oldStart = headerStart(first, sizes.old)
    newStart = headerStart(first + delta, sizes.new)
  } else {
    const first = firstLine(hunk.newStart, hunk.newCount)
    newStart = headerStart(first, sizes.new)
    oldStart = headerStart(first - delta, sizes.old)
  }
  const section = hunk.section ? ` ${hunk.section}` : ''
  return `@@ -${oldStart},${sizes.old} +${newStart},${sizes.new} @@${section}`
}
