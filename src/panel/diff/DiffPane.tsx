import {
  ChevronDown,
  ChevronUp,
  Columns2,
  Copy,
  ExternalLink,
  FileText,
  FileWarning,
  MessageSquarePlus,
  MoreHorizontal,
  Rows3,
  WrapText
} from 'lucide-react'
import { type RefObject, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  allChangedLines,
  type ParsedPatch,
  parsePatch,
  supportsLineSelection
} from '../../shared/diff/parse'
import type { FileDiff } from '../../shared/model'
import { copyText } from '../lib/clipboard'
import { formatBytes, splitPath } from '../lib/format'
import { type NoteSource, notesFor, sourceKey, startDraft, useNotes } from '../state/notes'
import { type Inclusion, run, setInclusion, toast, updatePrefs, useStore } from '../state/store'
import { openMenuBelow } from '../ui/Menu'
import { PathLabel } from '../ui/PathLabel'
import { ConflictView } from './ConflictView'
import { ImageDiff } from './ImageDiff'
import { NoteCard, NoteComposer } from './NoteRows'
import { type DiffNavigator, type DiffReview, type LineSelection, TextDiff } from './TextDiff'
import { type DiffSource, sourcePath, useDiff, useHighlights } from './useDiff'

type Props = {
  source: DiffSource
  /** Lets the person pick lines for the next commit (the Changes tab). */
  selectable: boolean
  /** Shown before the header, such as a Back button in the narrow layout. */
  leading?: React.ReactNode
}

export function DiffPane({ source, selectable, leading }: Props) {
  const revision = useStore((state) => (source.kind === 'working' ? state.revision : 0))
  const prefs = useStore((state) => state.prefs)
  const load = useDiff(source, revision, prefs.ignoreWhitespace)
  const path = sourcePath(source)
  const diff = load.status === 'ready' ? load.diff : null
  const patch = useMemo(() => (diff?.kind === 'text' ? parsePatch(diff.patch) : null), [diff])
  const navigator = useRef<DiffNavigator | null>(null)
  const navigable = diff?.kind === 'text' && (patch?.hunks.length ?? 0) > 0

  return (
    <section className="diff-pane" aria-label={`Diff of ${path}`}>
      <DiffHeader
        source={source}
        patch={patch}
        leading={leading}
        navigator={navigable ? navigator : null}
      />
      <div className="diff-body">
        {load.status === 'loading' ? (
          <div className="diff-message">
            <span className="spinner" />
          </div>
        ) : load.status === 'error' ? (
          <div className="diff-message">
            <FileWarning size={20} />
            <p>{load.message}</p>
          </div>
        ) : (
          <DiffContent
            source={source}
            diff={load.diff}
            patch={patch}
            selectable={selectable && !prefs.ignoreWhitespace}
            navigator={navigator}
          />
        )}
      </div>
    </section>
  )
}

function DiffHeader({
  source,
  patch,
  leading,
  navigator
}: {
  source: DiffSource
  patch: ParsedPatch | null
  leading?: React.ReactNode
  /** Present when the diff has changes to step through. */
  navigator: RefObject<DiffNavigator | null> | null
}) {
  const prefs = useStore((state) => state.prefs)
  const path = sourcePath(source)
  const oldPath = source.kind === 'stash' ? undefined : source.file.oldPath

  const more = (event: React.MouseEvent<HTMLButtonElement>) =>
    openMenuBelow(event.currentTarget, [
      {
        label: prefs.ignoreWhitespace ? 'Show whitespace changes' : 'Hide whitespace changes',
        onSelect: () => updatePrefs({ ignoreWhitespace: !prefs.ignoreWhitespace })
      },
      { separator: true },
      {
        label: 'Copy file path',
        icon: Copy,
        onSelect: () => copyText(path) && toast('Path copied')
      },
      ...(source.kind === 'working' && source.file.kind !== 'deleted'
        ? [
            {
              label: 'Open in editor',
              icon: ExternalLink,
              onSelect: () =>
                void run('workspace.openFile', { path }, { title: 'Could not open the file' })
            }
          ]
        : [])
    ])

  return (
    <header className="diff-header">
      {leading}
      <div className="diff-title" title={oldPath ? `${oldPath} → ${path}` : path}>
        <PathLabel path={path} oldPath={oldPath} />
      </div>
      {patch && (patch.additions > 0 || patch.deletions > 0) ? (
        <span className="diff-stats">
          <span className="stat-add">+{patch.additions}</span>
          <span className="stat-del">−{patch.deletions}</span>
        </span>
      ) : null}
      <button
        type="button"
        className="icon-button"
        title="Add a note on this file for the agent (or click + on a line)"
        aria-label="Add a note on this file"
        onClick={() => startDraft({ source: noteSourceOf(source), path, anchor: { kind: 'file' } })}
      >
        <MessageSquarePlus size={14} />
      </button>
      {navigator ? (
        <div className="segmented" role="group" aria-label="Changes">
          <button
            type="button"
            title="Previous change (p)"
            aria-label="Previous change"
            onClick={() => navigator.current?.previous()}
          >
            <ChevronUp size={14} />
          </button>
          <button
            type="button"
            title="Next change (n)"
            aria-label="Next change"
            onClick={() => navigator.current?.next()}
          >
            <ChevronDown size={14} />
          </button>
        </div>
      ) : null}
      <div className="segmented" role="group" aria-label="Diff layout">
        <button
          type="button"
          aria-pressed={prefs.diffLayout === 'unified'}
          title="Unified"
          onClick={() => updatePrefs({ diffLayout: 'unified' })}
        >
          <Rows3 size={14} />
        </button>
        <button
          type="button"
          aria-pressed={prefs.diffLayout === 'split'}
          title="Side by side"
          onClick={() => updatePrefs({ diffLayout: 'split' })}
        >
          <Columns2 size={14} />
        </button>
      </div>
      <button
        type="button"
        className="icon-button"
        aria-pressed={prefs.fullFile}
        title={prefs.fullFile ? 'Show only the changes' : 'Show the whole file'}
        onClick={() => updatePrefs({ fullFile: !prefs.fullFile })}
      >
        <FileText size={14} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-pressed={prefs.wrapLines}
        title={prefs.wrapLines ? 'Stop wrapping long lines' : 'Wrap long lines'}
        onClick={() => updatePrefs({ wrapLines: !prefs.wrapLines })}
      >
        <WrapText size={14} />
      </button>
      <button
        type="button"
        className="icon-button"
        title="More"
        aria-label="More diff options"
        onClick={more}
      >
        <MoreHorizontal size={14} />
      </button>
    </header>
  )
}

/** The body of one file's diff, with the notes the person wrote on it. */
export function DiffContent(props: {
  source: DiffSource
  diff: FileDiff
  patch: ParsedPatch | null
  selectable: boolean
  navigator: RefObject<DiffNavigator | null> | null
  /** Part of a page of several files: grows to full height and never scrolls itself. */
  inline?: boolean
}) {
  const path = sourcePath(props.source)
  const identity = sourceIdentity(props.source)
  // A new DiffSource object arrives with every render; the note source changes only with it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `identity` stands for `props.source`
  const source = useMemo(() => noteSourceOf(props.source), [identity])
  const allNotes = useNotes((state) => state.notes)
  const draft = useNotes((state) => state.draft)
  const notes = useMemo(() => notesFor(allNotes, source, path), [allNotes, source, path])
  const ownDraft =
    draft && draft.path === path && sourceKey(draft.source) === sourceKey(source) ? draft : null
  const review = useMemo<DiffReview>(
    () => ({
      notes: notes.filter((note) => note.anchor.kind === 'lines'),
      draft: ownDraft?.anchor.kind === 'lines' ? ownDraft : null,
      begin: (anchor) => startDraft({ source, path, anchor })
    }),
    [notes, ownDraft, source, path]
  )
  const fileNotes = notes.filter((note) => note.anchor.kind === 'file' && note.id !== ownDraft?.id)
  const fileDraft = ownDraft?.anchor.kind === 'file' ? ownDraft : null
  return (
    <>
      {fileNotes.length > 0 || fileDraft ? (
        <div className="file-notes">
          {fileNotes.map((note) => (
            <NoteCard key={note.id} note={note} />
          ))}
          {fileDraft ? <NoteComposer draft={fileDraft} /> : null}
        </div>
      ) : null}
      <DiffBody {...props} review={review} />
    </>
  )
}

function sourceIdentity(source: DiffSource): string {
  return source.kind === 'commit'
    ? `c:${source.sha}`
    : source.kind === 'stash'
      ? `s:${source.index}`
      : 'w'
}

export function noteSourceOf(source: DiffSource): NoteSource {
  switch (source.kind) {
    case 'working':
      return { kind: 'working' }
    case 'commit':
      return { kind: 'commit', sha: source.sha, shortSha: source.sha.slice(0, 7) }
    case 'stash':
      return { kind: 'stash', index: source.index }
  }
}

function DiffBody({
  source,
  diff,
  patch,
  selectable,
  navigator,
  inline = false,
  review
}: {
  source: DiffSource
  diff: FileDiff
  patch: ParsedPatch | null
  selectable: boolean
  navigator: RefObject<DiffNavigator | null> | null
  inline?: boolean
  review: DiffReview
}) {
  const prefs = useStore((state) => state.prefs)
  const path = sourcePath(source)
  const textSides = diff.kind === 'text' ? diff : null
  const highlights = useHighlights(path, textSides?.oldText ?? null, textSides?.newText ?? null)
  const selection = useLineSelection(
    source.kind === 'working' &&
      selectable &&
      patch &&
      diff.kind === 'text' &&
      supportsLineSelection(patch)
      ? { path, patch, hash: diff.hash }
      : null
  )

  switch (diff.kind) {
    case 'text': {
      if (!patch || patch.hunks.length === 0) return <NoTextChange patch={patch} diff={diff} />
      return (
        <TextDiff
          key={diff.hash}
          patch={patch}
          newText={diff.newText}
          highlights={highlights}
          layout={prefs.diffLayout}
          wrap={prefs.wrapLines}
          selection={selection}
          fullFile={prefs.fullFile}
          navigator={navigator}
          inline={inline}
          review={review}
        />
      )
    }
    case 'binary':
      return (
        <div className="diff-message">
          <p>This binary file changed.</p>
          <p className="muted">
            {diff.oldSize !== null ? formatBytes(diff.oldSize) : 'New'} →{' '}
            {diff.newSize !== null ? formatBytes(diff.newSize) : 'Deleted'}
          </p>
        </div>
      )
    case 'image':
      return <ImageDiff diff={diff} />
    case 'too-large':
      return (
        <div className="diff-message">
          <p>This diff is too large to show ({formatBytes(diff.size)}).</p>
          {source.kind === 'working' ? (
            <button
              type="button"
              className="button"
              onClick={() =>
                void run('workspace.openFile', { path }, { title: 'Could not open the file' })
              }
            >
              Open in editor
            </button>
          ) : null}
        </div>
      )
    case 'conflicted':
      return <ConflictView path={path} diff={diff} />
  }
}

function NoTextChange({
  patch,
  diff
}: {
  patch: ParsedPatch | null
  diff: Extract<FileDiff, { kind: 'text' }>
}) {
  const message = patch?.modeChange
    ? `File mode changed from ${patch.modeChange.from} to ${patch.modeChange.to}.`
    : patch?.isRename
      ? 'The file was renamed without changes.'
      : diff.newText === '' || diff.oldText === ''
        ? 'The file is empty.'
        : 'No changes to show.'
  return (
    <div className="diff-message">
      <p>{message}</p>
    </div>
  )
}

/** The Changes tab's line picks for one file, kept in the store as an Inclusion. */
function useLineSelection(
  target: { path: string; patch: ParsedPatch; hash: string } | null
): LineSelection | null {
  const path = target?.path ?? ''
  const inclusion = useStore((state) => (target ? state.inclusions[path] : undefined))
  const patch = target?.patch ?? null
  const hash = target?.hash ?? ''
  const enabled = target !== null
  const stale = enabled && inclusion?.kind === 'lines' && inclusion.hash !== hash

  useEffect(() => {
    if (stale) {
      setInclusion(path, { kind: 'all' })
      toast(`${splitPath(path).name} changed on disk: its line selection was reset`)
    }
  }, [stale, path])

  const selected = useMemo(() => {
    if (!patch || !inclusion || inclusion.kind === 'all' || stale)
      return new Set(allChangedLines(patch ?? emptyPatch))
    if (inclusion.kind === 'none') return new Set<number>()
    return new Set(inclusion.lines)
  }, [patch, inclusion, stale])

  const set = useCallback(
    (ordinals: number[], include: boolean) => {
      if (!patch) return
      const next = new Set(selected)
      for (const ordinal of ordinals) {
        if (include) next.add(ordinal)
        else next.delete(ordinal)
      }
      const total = patch.changedLineCount
      const value: Inclusion =
        next.size === total
          ? { kind: 'all' }
          : next.size === 0
            ? { kind: 'none' }
            : { kind: 'lines', hash, lines: [...next].sort((a, b) => a - b), total }
      setInclusion(path, value)
    },
    [patch, selected, hash, path]
  )

  return useMemo(() => (enabled ? { selected, set } : null), [enabled, selected, set])
}

const emptyPatch = parsePatch('')
