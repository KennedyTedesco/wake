// Review notes: what the person wants an agent to change, pinned to lines or to a whole file.
// They live in localStorage per repository: Orca keeps it per plugin, so the sidebar and the tab
// share it, and a restart keeps it.
import { create } from 'zustand'

/** Which diff a note was written on. */
export type NoteSource =
  | { kind: 'working' }
  | { kind: 'commit'; sha: string; shortSha: string }
  | { kind: 'stash'; index: number }

export type LineAnchor = {
  kind: 'lines'
  /** `old` numbers lines as they were before the change (removed lines), `new` as they are now. */
  side: 'old' | 'new'
  start: number
  end: number
  /** The text of those lines, so the agent finds them after the file moves on. */
  excerpt: string[]
}

export type NoteAnchor = { kind: 'file' } | LineAnchor

export type ReviewNote = {
  id: string
  source: NoteSource
  path: string
  anchor: NoteAnchor
  body: string
  createdAt: number
}

export type NoteDraft = {
  /** Set when the draft edits a note that already exists. */
  id: string | null
  source: NoteSource
  path: string
  anchor: NoteAnchor
  body: string
}

const KEY = 'wake.notes'

type NotesState = {
  root: string | null
  notes: ReviewNote[]
  draft: NoteDraft | null
  /** Whether the list of notes, with the send controls, is open. */
  trayOpen: boolean
}

function readAll(): Record<string, ReviewNote[]> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    // Notes are only ever written by this file, so the shape is ours; a broken value starts empty.
    return stored && typeof stored === 'object' ? (stored as Record<string, ReviewNote[]>) : {}
  } catch {
    return {}
  }
}

function writeAll(root: string, notes: ReviewNote[]): void {
  try {
    const all = readAll()
    if (notes.length === 0) delete all[root]
    else all[root] = notes
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // Storage can be unavailable in browser clients; notes then last for the session.
  }
}

export const useNotes = create<NotesState>(() => ({
  root: null,
  notes: [],
  draft: null,
  trayOpen: false
}))

// The sidebar and the tab can be open at once: a note written in one shows in the other.
window.addEventListener('storage', (event) => {
  const { root } = useNotes.getState()
  if (event.key === KEY && root) useNotes.setState({ notes: readAll()[root] ?? [] })
})

const set = useNotes.setState
const get = useNotes.getState

function save(notes: ReviewNote[]): void {
  const { root } = get()
  set({ notes })
  if (root) writeAll(root, notes)
}

/** Loads the notes of the repository the panel shows. */
export function openNotes(root: string): void {
  if (get().root === root) return
  set({ root, notes: readAll()[root] ?? [], draft: null })
}

export function setTrayOpen(open: boolean): void {
  set({ trayOpen: open })
}

/** Puts notes back after an undo, ahead of any written since. */
export function restoreNotes(restored: readonly ReviewNote[]): void {
  const ids = new Set(get().notes.map((note) => note.id))
  save([...restored.filter((note) => !ids.has(note.id)), ...get().notes])
}

export function sourceKey(source: NoteSource): string {
  switch (source.kind) {
    case 'working':
      return 'working'
    case 'commit':
      return `commit:${source.sha}`
    case 'stash':
      return `stash:${source.index}`
  }
}

export function startDraft(draft: Omit<NoteDraft, 'id' | 'body'>): void {
  set({ draft: { ...draft, id: null, body: '' } })
}

export function editNote(id: string): void {
  const note = get().notes.find((item) => item.id === id)
  if (note)
    set({
      draft: {
        id: note.id,
        source: note.source,
        path: note.path,
        anchor: note.anchor,
        body: note.body
      }
    })
}

export function cancelDraft(): void {
  set({ draft: null })
}

export function saveDraft(body: string): void {
  const { draft, notes } = get()
  const text = body.trim()
  if (!draft) return
  if (!text) {
    set({ draft: null })
    return
  }
  const next = draft.id
    ? notes.map((note) => (note.id === draft.id ? { ...note, body: text } : note))
    : [
        ...notes,
        {
          id: crypto.randomUUID(),
          source: draft.source,
          path: draft.path,
          anchor: draft.anchor,
          body: text,
          createdAt: Date.now()
        }
      ]
  set({ draft: null })
  save(next)
}

export function deleteNote(id: string): void {
  const { draft } = get()
  if (draft?.id === id) set({ draft: null })
  save(get().notes.filter((note) => note.id !== id))
}

export function updateNote(id: string, body: string): void {
  const text = body.trim()
  if (!text) return
  save(get().notes.map((note) => (note.id === id ? { ...note, body: text } : note)))
}

export function removeNotes(ids: readonly string[]): void {
  const gone = new Set(ids)
  save(get().notes.filter((note) => !gone.has(note.id)))
}

/** The notes of one file in one diff, in line order. */
export function notesFor(
  notes: readonly ReviewNote[],
  source: NoteSource,
  path: string
): ReviewNote[] {
  const key = sourceKey(source)
  return notes
    .filter((note) => note.path === path && sourceKey(note.source) === key)
    .sort(
      (a, b) =>
        (a.anchor.kind === 'lines' ? a.anchor.start : 0) -
        (b.anchor.kind === 'lines' ? b.anchor.start : 0)
    )
}

export type NoteGroup = { key: string; source: NoteSource; path: string; notes: ReviewNote[] }

/** Notes by file, files in the order they got their first note, each file's notes in line order. */
export function groupNotes(notes: readonly ReviewNote[]): NoteGroup[] {
  const groups = new Map<string, NoteGroup>()
  for (const note of notes) {
    const key = `${sourceKey(note.source)}\0${note.path}`
    if (!groups.has(key))
      groups.set(key, {
        key,
        source: note.source,
        path: note.path,
        notes: notesFor(notes, note.source, note.path)
      })
  }
  return [...groups.values()]
}
