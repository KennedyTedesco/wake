// The text an agent receives. It follows the format of Orca's own diff notes (`File:`,
// `Lines:`, `User comment:`), so an agent reads a note from Wake as it reads one from Orca.
import type { ReviewNote } from '../state/notes'

function quoted(body: string): string {
  const escaped = body
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
  return `"${escaped}"`
}

function where(note: ReviewNote): string[] {
  const lines: string[] = [`File: ${note.path}`]
  if (note.source.kind === 'commit') lines.push(`Commit: ${note.source.shortSha}`)
  if (note.source.kind === 'stash') lines.push(`Stash: stash@{${note.source.index}}`)
  const { anchor } = note
  if (anchor.kind === 'file') {
    lines.push('Scope: file')
    return lines
  }
  const range =
    anchor.start === anchor.end ? `Line: ${anchor.start}` : `Lines: ${anchor.start}-${anchor.end}`
  // Line numbers of removed lines refer to the file before the change.
  lines.push(
    anchor.side === 'old' ? `${range} (removed lines, numbered as before the change)` : range
  )
  if (anchor.excerpt.length > 0) {
    lines.push('Code:', ...anchor.excerpt.slice(0, 12).map((text) => `> ${text}`))
    if (anchor.excerpt.length > 12) lines.push(`> … ${anchor.excerpt.length - 12} more lines`)
  }
  return lines
}

export function formatNotes(notes: readonly ReviewNote[]): string {
  const intro =
    notes.length === 1
      ? 'Review note from Wake. Please make this change:'
      : `Review notes from Wake. Please make these ${notes.length} changes:`
  const blocks = notes.map((note) =>
    [...where(note), `User comment: ${quoted(note.body)}`].join('\n')
  )
  return [intro, ...blocks].join('\n\n')
}
