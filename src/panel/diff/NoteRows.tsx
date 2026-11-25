import { MessageSquare, Pencil, Trash2 } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'
import {
  cancelDraft,
  deleteNote,
  editNote,
  type NoteAnchor,
  type NoteDraft,
  type ReviewNote,
  saveDraft
} from '../state/notes'

export function anchorLabel(anchor: NoteAnchor): string {
  if (anchor.kind === 'file') return 'Whole file'
  const range =
    anchor.start === anchor.end ? `Line ${anchor.start}` : `Lines ${anchor.start}–${anchor.end}`
  return anchor.side === 'old' ? `${range} (removed)` : range
}

/** A saved note, shown under the lines it is about. */
export function NoteCard({ note }: { note: ReviewNote }) {
  return (
    <div className="note-card" data-anchor={note.anchor.kind}>
      <div className="note-card-head">
        <MessageSquare size={13} className="note-icon" />
        <span className="note-where">{anchorLabel(note.anchor)}</span>
        <span className="note-actions">
          <button
            type="button"
            className="icon-button"
            title="Edit the note"
            aria-label="Edit the note"
            onClick={() => editNote(note.id)}
          >
            <Pencil size={12} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Remove the note"
            aria-label="Remove the note"
            onClick={() => deleteNote(note.id)}
          >
            <Trash2 size={12} />
          </button>
        </span>
      </div>
      <p className="note-body">{note.body}</p>
    </div>
  )
}

/** Where the person writes a new note, or edits one. */
export function NoteComposer({ draft }: { draft: NoteDraft }) {
  const [body, setBody] = useState(draft.body)
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      saveDraft(body)
    } else if (event.key === 'Escape') {
      // Escape here closes the composer; it must not also leave the tab.
      event.preventDefault()
      event.stopPropagation()
      cancelDraft()
    }
  }
  return (
    <div className="note-card note-composer" data-anchor={draft.anchor.kind}>
      <div className="note-card-head">
        <MessageSquare size={13} className="note-icon" />
        <span className="note-where">{anchorLabel(draft.anchor)}</span>
      </div>
      <textarea
        className="input textarea note-input"
        placeholder="What should the agent change here?"
        aria-label="Note for the agent"
        value={body}
        // biome-ignore lint/a11y/noAutofocus: the composer opens because the person asked to write
        autoFocus
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="note-composer-actions">
        <span className="muted note-hint">⌘⏎ to save · Esc to cancel</span>
        <button type="button" className="button" onClick={cancelDraft}>
          Cancel
        </button>
        <button
          type="button"
          className="button"
          data-variant="primary"
          disabled={!body.trim()}
          onClick={() => saveDraft(body)}
        >
          {draft.id ? 'Save' : 'Add note'}
        </button>
      </div>
    </div>
  )
}
