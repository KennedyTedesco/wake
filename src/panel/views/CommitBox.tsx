import { Sparkles, Square } from 'lucide-react'
import { type KeyboardEvent, useRef } from 'react'
import type { RepoSnapshot } from '../../shared/model'
import { plural } from '../lib/format'
import {
  commit,
  draftMessage,
  setDraft,
  stopDrafting,
  toggleAmend,
  undoCommit,
  useStore
} from '../state/store'

// Git's own convention: a summary past 50 characters is long, past 72 it gets cut in many views.
const SUMMARY_SOFT_LIMIT = 50
const SUMMARY_HARD_LIMIT = 72

export function CommitBox({ repo, includedCount }: { repo: RepoSnapshot; includedCount: number }) {
  const draft = useStore((state) => state.draft)
  const committing = useStore((state) => state.committing)
  const drafting = useStore((state) => state.drafting)
  const recentCommit = useStore((state) => state.recentCommit)
  const undoable =
    recentCommit !== null && repo.lastCommit?.sha === recentCommit && !repo.lastCommit.pushed
      ? repo.lastCommit
      : null
  const description = useRef<HTMLTextAreaElement>(null)

  const branch = repo.head.kind === 'detached' ? 'detached HEAD' : repo.head.name
  const conflicted = repo.files.some((file) => file.kind === 'conflicted')
  const canAmend = repo.lastCommit !== null
  const summary = draft.summary.trim()
  const disabledReason = committing
    ? 'Committing…'
    : conflicted
      ? 'Resolve the conflicts first'
      : repo.operation
        ? `Finish the ${repo.operation} with the button above`
        : !summary
          ? 'Write a summary first'
          : includedCount === 0 && !draft.amend
            ? 'Include at least one file'
            : null

  const label = draft.amend
    ? 'Amend last commit'
    : includedCount === 0
      ? `Commit to ${branch}`
      : `Commit ${plural(includedCount, 'file')} to ${branch}`

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (!disabledReason) void commit()
    }
  }

  const length = draft.summary.length
  return (
    <form
      className="commit-box"
      onSubmit={(event) => {
        event.preventDefault()
        if (!disabledReason) void commit()
      }}
      onKeyDown={onKeyDown}
    >
      {undoable ? (
        <div className="undo-bar">
          <span className="undo-text">
            Committed <strong>{undoable.summary}</strong>
          </span>
          <button type="button" className="button" onClick={() => void undoCommit()}>
            Undo
          </button>
        </div>
      ) : null}
      <div className="summary-field" data-drafting={drafting || undefined}>
        <input
          className="input"
          placeholder={
            drafting
              ? 'Writing a message…'
              : draft.amend
                ? 'Summary of the amended commit'
                : 'Summary (required)'
          }
          aria-label="Commit summary"
          value={draft.summary}
          maxLength={1000}
          readOnly={drafting}
          onChange={(event) => setDraft({ summary: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
              event.preventDefault()
              description.current?.focus()
            }
          }}
        />
        {length > SUMMARY_SOFT_LIMIT ? (
          <span
            className="summary-count"
            data-over={length > SUMMARY_HARD_LIMIT || undefined}
            title="Keep the summary under 50 characters; many tools cut it at 72"
          >
            {SUMMARY_HARD_LIMIT - length}
          </span>
        ) : null}
        <button
          type="button"
          className="ai-button"
          data-active={drafting || undefined}
          disabled={!drafting && includedCount === 0}
          aria-label={drafting ? 'Stop writing the message' : 'Write the message with AI'}
          title={
            drafting
              ? 'Stop'
              : includedCount === 0
                ? 'Include a file first'
                : 'Write the message with AI from the included changes'
          }
          onClick={() => (drafting ? stopDrafting() : void draftMessage())}
        >
          {drafting ? <Square size={11} fill="currentColor" /> : <Sparkles size={14} />}
        </button>
      </div>
      <textarea
        ref={description}
        className="input textarea"
        readOnly={drafting}
        placeholder="Description"
        aria-label="Commit description"
        rows={3}
        value={draft.description}
        onChange={(event) => setDraft({ description: event.target.value })}
      />
      <div className="commit-options">
        {canAmend ? (
          <label
            className="toggle"
            title={
              repo.lastCommit?.pushed
                ? 'This commit is already pushed: amending it needs a force push'
                : undefined
            }
          >
            <input
              type="checkbox"
              checked={draft.amend}
              onChange={(event) => void toggleAmend(event.target.checked)}
            />
            <span>Amend</span>
            {draft.amend && repo.lastCommit?.pushed ? (
              <span className="tag" data-tone="warning">
                pushed
              </span>
            ) : null}
          </label>
        ) : null}
        <span className="muted commit-hint">⌘⏎</span>
      </div>
      <button
        type="submit"
        className="button commit-button"
        data-variant="primary"
        disabled={!!disabledReason}
        title={disabledReason ?? undefined}
      >
        {committing ? <span className="spinner" /> : null}
        <span className="commit-label">{label}</span>
      </button>
    </form>
  )
}
