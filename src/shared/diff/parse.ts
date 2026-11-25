// Parses the unified diff git prints for one file. Both sides use it: the panel to draw the
// diff, the worker to turn a line selection back into a patch. Keep it dependency free.

export type DiffLine =
  | { type: 'context'; text: string; oldNo: number; newNo: number; noNewline: boolean }
  | { type: 'add'; text: string; newNo: number; ordinal: number; noNewline: boolean }
  | { type: 'del'; text: string; oldNo: number; ordinal: number; noNewline: boolean }

export type Hunk = {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  /** The function or section name git prints after the second `@@`. */
  section: string
  lines: DiffLine[]
}

export type ParsedPatch = {
  /** Every line before the first hunk: `diff --git`, mode lines, `index`, `---`, `+++`. */
  header: string[]
  isNew: boolean
  isDeleted: boolean
  isRename: boolean
  isBinary: boolean
  /** Set when only the file mode changes, such as a script made executable. */
  modeChange: { from: string; to: string } | null
  hunks: Hunk[]
  /** How many + and - lines the patch has; ordinals run from 0 to this, exclusive. */
  changedLineCount: number
  additions: number
  deletions: number
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/

export function parsePatch(patch: string): ParsedPatch {
  const lines = patch.split('\n')
  if (lines.at(-1) === '') lines.pop()

  const result: ParsedPatch = {
    header: [],
    isNew: false,
    isDeleted: false,
    isRename: false,
    isBinary: false,
    modeChange: null,
    hunks: [],
    changedLineCount: 0,
    additions: 0,
    deletions: 0
  }

  let oldMode: string | null = null
  let index = 0
  for (; index < lines.length; index++) {
    const line = lines[index] ?? ''
    if (line.startsWith('@@ ')) break
    result.header.push(line)
    if (line.startsWith('new file mode')) result.isNew = true
    else if (line.startsWith('deleted file mode')) result.isDeleted = true
    else if (line.startsWith('rename from') || line.startsWith('copy from')) result.isRename = true
    else if (line.startsWith('Binary files') || line === 'GIT binary patch') result.isBinary = true
    else if (line.startsWith('old mode ')) oldMode = line.slice('old mode '.length)
    else if (line.startsWith('new mode ') && oldMode) {
      result.modeChange = { from: oldMode, to: line.slice('new mode '.length) }
    }
  }

  let ordinal = 0
  while (index < lines.length) {
    const match = HUNK_HEADER.exec(lines[index] ?? '')
    if (!match) {
      index++
      continue
    }
    const hunk: Hunk = {
      oldStart: Number(match[1]),
      oldCount: match[2] === undefined ? 1 : Number(match[2]),
      newStart: Number(match[3]),
      newCount: match[4] === undefined ? 1 : Number(match[4]),
      section: match[5] ?? '',
      lines: []
    }
    index++
    let oldNo = hunk.oldStart
    let newNo = hunk.newStart
    let oldLeft = hunk.oldCount
    let newLeft = hunk.newCount
    // The counts say where the hunk ends: a removed line can itself start with `--- ` or `@@ `.
    while (index < lines.length && (oldLeft > 0 || newLeft > 0 || lines[index]?.startsWith('\\'))) {
      const line = lines[index] ?? ''
      const marker = line[0]
      const text = line.slice(1)
      if (marker === '\\') {
        const previous = hunk.lines.at(-1)
        if (previous) previous.noNewline = true
      } else if (marker === '+') {
        hunk.lines.push({ type: 'add', text, newNo: newNo++, ordinal: ordinal++, noNewline: false })
        newLeft--
        result.additions++
      } else if (marker === '-') {
        hunk.lines.push({ type: 'del', text, oldNo: oldNo++, ordinal: ordinal++, noNewline: false })
        oldLeft--
        result.deletions++
      } else {
        // A context line; an empty line is a context line whose leading space was trimmed.
        hunk.lines.push({
          type: 'context',
          text,
          oldNo: oldNo++,
          newNo: newNo++,
          noNewline: false
        })
        oldLeft--
        newLeft--
      }
      index++
    }
    result.hunks.push(hunk)
  }
  result.changedLineCount = ordinal
  return result
}

/** The ordinals of every changed line, for a selection of the whole file. */
export function allChangedLines(patch: ParsedPatch): number[] {
  return Array.from({ length: patch.changedLineCount }, (_, ordinal) => ordinal)
}

/** Whether line-by-line selection makes sense for this file. Renames, binaries and pure mode
 *  changes are committed or discarded as a whole. */
export function supportsLineSelection(patch: ParsedPatch): boolean {
  return !patch.isBinary && !patch.isRename && patch.changedLineCount > 0
}
