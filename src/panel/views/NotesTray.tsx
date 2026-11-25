import {
  Bot,
  Check,
  Copy,
  CornerDownLeft,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  X
} from 'lucide-react'
import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentTarget } from '../../shared/model'
import { anchorLabel } from '../diff/NoteRows'
import { operation } from '../lib/bridge'
import { copyText } from '../lib/clipboard'
import { timeAgo } from '../lib/format'
import { formatNotes } from '../lib/notesFormat'
import {
  deleteNote,
  groupNotes,
  type NoteSource,
  type ReviewNote,
  removeNotes,
  restoreNotes,
  setTrayOpen,
  updateNote,
  useNotes
} from '../state/notes'
import { focusChanges, selectCommit, setTab, showFailure, toast } from '../state/store'
import { PathLabel } from '../ui/PathLabel'

/** Next to the Changes and History tabs: opens the notes, once there is a note to send. */
export function NotesButton() {
  const count = useNotes((state) => state.notes.length)
  const open = useNotes((state) => state.trayOpen)
  if (count === 0 && !open) return null
  const label = `${count} ${count === 1 ? 'note' : 'notes'} for the agent`
  return (
    <button
      type="button"
      className="tab tab-notes"
      data-open={open || undefined}
      aria-expanded={open}
      title={label}
      aria-label={label}
      onClick={() => setTrayOpen(!open)}
    >
      <MessageSquareText size={14} />
      <span className="count">{count}</span>
    </button>
  )
}

const AGENT_NAMES: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  cursor: 'Cursor',
  copilot: 'Copilot',
  amp: 'Amp',
  omp: 'OMP'
}

function agentName(agent: string | null): string {
  if (!agent) return 'Agent'
  return AGENT_NAMES[agent] ?? agent.charAt(0).toUpperCase() + agent.slice(1)
}

const STATE_LABEL: Record<AgentTarget['state'], string> = {
  working: 'Working',
  blocked: 'Needs you',
  waiting: 'Waiting',
  done: 'Done'
}

function sourceLabel(source: NoteSource): string {
  switch (source.kind) {
    case 'working':
      return 'Uncommitted'
    case 'commit':
      return `Commit ${source.shortSha}`
    case 'stash':
      return `Stash ${source.index}`
  }
}

/** Shows the diff a note was written on. */
function goTo(note: ReviewNote): void {
  switch (note.source.kind) {
    case 'working':
      setTab('changes')
      focusChanges({ kind: 'file', path: note.path })
      return
    case 'stash':
      setTab('changes')
      focusChanges({ kind: 'stash', index: note.source.index })
      return
    case 'commit':
      setTab('history')
      void selectCommit(note.source.sha)
  }
}

const NEW_AGENT = 'new'

export function NotesTray() {
  const open = useNotes((state) => state.trayOpen)
  const notes = useNotes((state) => state.notes)
  const groups = useMemo(() => groupNotes(notes), [notes])
  const [targets, setTargets] = useState<AgentTarget[] | null>(null)
  const [target, setTarget] = useState<string>(NEW_AGENT)
  const [submit, setSubmit] = useState(true)
  const [sending, setSending] = useState(false)

  const loadTargets = useCallback(async () => {
    const result = await operation('review.targets', {})
    const list = Array.isArray(result) ? result : []
    setTargets(list)
    // The agent that wrote the changes is most likely the one that finished last.
    const idle = list.find((agent) => agent.state === 'waiting' || agent.state === 'done')
    setTarget((current) =>
      list.some((agent) => agent.terminalId === current)
        ? current
        : ((idle ?? list[0])?.terminalId ?? NEW_AGENT)
    )
  }, [])

  useEffect(() => {
    if (open) void loadTargets()
  }, [open, loadTargets])

  if (!open) return null

  const ordered = groups.flatMap((group) => group.notes)
  const chosen = targets?.find((agent) => agent.terminalId === target) ?? null

  const send = async () => {
    if (ordered.length === 0 || sending) return
    setSending(true)
    const text = formatNotes(ordered)
    const result = chosen
      ? await operation('review.send', { terminalId: chosen.terminalId, text, submit })
      : await operation('review.launch', { text })
    setSending(false)
    if (!result.ok) {
      showFailure('Could not send the notes', result)
      void loadTargets()
      return
    }
    removeNotes(ordered.map((note) => note.id))
    setTrayOpen(false)
    const what = ordered.length === 1 ? 'the note' : `${ordered.length} notes`
    const who = chosen ? `${agentName(chosen.agent)} (${chosen.title})` : 'a new agent'
    toast(`Sent ${what} to ${who}.`, 'success', {
      label: 'Restore notes',
      run: () => restoreNotes(ordered)
    })
  }

  const copy = () => {
    if (copyText(formatNotes(ordered)))
      toast(`Copied ${ordered.length === 1 ? 'the note' : `${ordered.length} notes`}.`, 'success')
  }

  const clear = () => {
    removeNotes(ordered.map((note) => note.id))
    toast('Removed every note.', 'info', { label: 'Undo', run: () => restoreNotes(ordered) })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    setTrayOpen(false)
  }

  return (
    <aside className="notes-tray" aria-label="Notes for the agent" onKeyDown={onKeyDown}>
      <header className="notes-tray-head">
        <MessageSquareText size={15} />
        <h2>Notes for the agent</h2>
        <span className="count">{ordered.length}</span>
        <button
          type="button"
          className="icon-button"
          aria-label="Close"
          title="Close (Esc)"
          onClick={() => setTrayOpen(false)}
        >
          <X size={15} />
        </button>
      </header>

      {ordered.length === 0 ? (
        <div className="notes-empty">
          <p>No notes yet.</p>
          <p className="muted">
            Hover a line in a diff and click <Plus size={11} aria-hidden /> to write a note. Drag
            the <Plus size={11} aria-hidden /> over more lines to note a range.
          </p>
        </div>
      ) : (
        <div className="notes-list">
          {groups.map((group) => (
            <section key={group.key} className="notes-group">
              <div className="notes-group-head">
                <PathLabel path={group.path} />
                <span className="notes-source">{sourceLabel(group.source)}</span>
              </div>
              {group.notes.map((note) => (
                <TrayNote key={note.id} note={note} />
              ))}
            </section>
          ))}
        </div>
      )}

      <footer className="notes-send">
        <div className="notes-targets-head">
          <span className="notes-label">Send to</span>
          <button
            type="button"
            className="icon-button"
            title="Look for agents again"
            aria-label="Look for agents again"
            onClick={() => void loadTargets()}
          >
            <RefreshCw size={13} />
          </button>
        </div>
        <div className="notes-targets" role="radiogroup" aria-label="Send to">
          {(targets ?? []).map((agent) => (
            <TargetOption
              key={agent.terminalId}
              id={agent.terminalId}
              selected={target === agent.terminalId}
              onSelect={setTarget}
            >
              <Bot size={14} className="target-icon" />
              <span className="target-text">
                <span className="target-name">{agent.title}</span>
                <span className="target-meta">
                  {agentName(agent.agent)} ·{' '}
                  <span data-state={agent.state}>{STATE_LABEL[agent.state]}</span> ·{' '}
                  {timeAgo(agent.since)}
                </span>
              </span>
            </TargetOption>
          ))}
          <TargetOption id={NEW_AGENT} selected={target === NEW_AGENT} onSelect={setTarget}>
            <Plus size={14} className="target-icon" />
            <span className="target-text">
              <span className="target-name">New agent</span>
              <span className="target-meta">
                Starts the agent from Wake's settings with these notes
              </span>
            </span>
          </TargetOption>
        </div>
        {chosen ? (
          <label
            className="notes-submit"
            title="Off: the notes wait in the agent's prompt, so you can add to them before you press Enter"
          >
            <input
              type="checkbox"
              checked={submit}
              onChange={(event) => setSubmit(event.target.checked)}
            />
            Submit at once
            <span className="muted">(off: paste only)</span>
          </label>
        ) : null}
        <div className="notes-actions">
          <button
            type="button"
            className="button"
            disabled={ordered.length === 0}
            onClick={clear}
            title="Remove every note"
          >
            <Trash2 size={13} />
          </button>
          <button type="button" className="button" disabled={ordered.length === 0} onClick={copy}>
            <Copy size={13} />
            Copy
          </button>
          <button
            type="button"
            className="button"
            data-variant="primary"
            disabled={ordered.length === 0 || sending}
            onClick={() => void send()}
          >
            <Send size={13} />
            {sending
              ? 'Sending…'
              : `Send ${ordered.length === 1 ? 'note' : `${ordered.length} notes`}`}
          </button>
        </div>
      </footer>
    </aside>
  )
}

function TargetOption({
  id,
  selected,
  onSelect,
  children
}: {
  id: string
  selected: boolean
  onSelect: (id: string) => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className="target"
      onClick={() => onSelect(id)}
    >
      {children}
      {selected ? <Check size={14} className="target-check" /> : null}
    </button>
  )
}

function TrayNote({ note }: { note: ReviewNote }) {
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(note.body)
  const excerpt = note.anchor.kind === 'lines' ? note.anchor.excerpt : []

  const save = () => {
    updateNote(note.id, body)
    setEditing(false)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      save()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setBody(note.body)
      setEditing(false)
    }
  }

  return (
    <article className="tray-note">
      <div className="tray-note-head">
        <button
          type="button"
          className="tray-note-where"
          title="Show it in the diff"
          onClick={() => goTo(note)}
        >
          {anchorLabel(note.anchor)}
          <CornerDownLeft size={11} />
        </button>
        <span className="note-actions">
          <button
            type="button"
            className="icon-button"
            title="Edit the note"
            aria-label="Edit the note"
            onClick={() => {
              setBody(note.body)
              setEditing(true)
            }}
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
      {excerpt.length > 0 ? (
        <pre className="tray-note-code">
          {excerpt.slice(0, 3).join('\n')}
          {excerpt.length > 3 ? `\n… ${excerpt.length - 3} more` : ''}
        </pre>
      ) : null}
      {editing ? (
        <div className="tray-note-edit">
          <textarea
            className="input textarea note-input"
            aria-label="Note for the agent"
            value={body}
            // biome-ignore lint/a11y/noAutofocus: the field opens because the person asked to edit
            autoFocus
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="note-composer-actions">
            <button type="button" className="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="button"
              data-variant="primary"
              disabled={!body.trim()}
              onClick={save}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <p className="note-body">{note.body}</p>
      )}
    </article>
  )
}
