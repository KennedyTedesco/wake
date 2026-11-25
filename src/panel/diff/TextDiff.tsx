import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronsUpDown, ChevronUp, MoveRight, Plus } from 'lucide-react'
import {
  type KeyboardEvent,
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { DiffLine, ParsedPatch } from '../../shared/diff/parse'
import type { DiffLayout } from '../lib/prefs'
import type { LineAnchor, NoteDraft, ReviewNote } from '../state/notes'
import { Code } from './Code'
import { intralineRanges, type Range } from './intraline'
import { findMoves, type Move } from './moved'
import { NoteCard, NoteComposer } from './NoteRows'
import {
  type ChangeLine,
  EXPAND_STEP,
  type Expansion,
  findGaps,
  type Gap,
  hunkOrdinals,
  pairChangedLines,
  type Row,
  splitLines,
  splitRows,
  unifiedRows
} from './rows'
import type { Highlights } from './useDiff'

/** Review notes of this file in this diff, and how to start a new one. */
export type DiffReview = {
  notes: ReviewNote[]
  /** The note being written or edited, when it belongs to this file. */
  draft: NoteDraft | null
  begin: (anchor: LineAnchor) => void
}

/** What the diff header's arrows call to step through the changes. */
export type DiffNavigator = { next(): void; previous(): void }

/** Line selection for the Changes tab; absent for history, where nothing is selectable. */
export type LineSelection = {
  selected: ReadonlySet<number>
  /** Includes or excludes these ordinals. */
  set: (ordinals: number[], include: boolean) => void
}

type Props = {
  patch: ParsedPatch
  newText: string | null
  highlights: Highlights
  layout: DiffLayout
  wrap: boolean
  selection: LineSelection | null
  /** Shows every unchanged line too, as one whole file. */
  fullFile: boolean
  /** Absent when the diff is part of a longer page, such as all files of a commit. */
  navigator: RefObject<DiffNavigator | null> | null
  /** Grows to its full height inside a parent that scrolls, instead of scrolling itself. */
  inline?: boolean
  review: DiffReview | null
}

type Side = 'old' | 'new'

/** A diff row, or a review note shown under the lines it is about. */
type ViewRow =
  | Row
  | { kind: 'note'; key: string; note: ReviewNote }
  | { kind: 'composer'; key: string; draft: NoteDraft }

/** The number of `line` on one side, or null when the line is not on that side. */
function lineOnSide(line: DiffLine | null, side: Side): number | null {
  if (!line) return null
  if (line.type === 'context') return side === 'old' ? line.oldNo : line.newNo
  if (line.type === 'del') return side === 'old' ? line.oldNo : null
  return side === 'new' ? line.newNo : null
}

function rowLines(row: ViewRow): (DiffLine | null)[] {
  return row.kind === 'line' ? [row.line] : row.kind === 'pair' ? [row.left, row.right] : []
}

/** The rows with each note (and the open composer) right under the last line it covers. */
function withNotes(rows: Row[], review: DiffReview | null): ViewRow[] {
  const pinned: { anchor: LineAnchor; row: ViewRow }[] = []
  for (const note of review?.notes ?? []) {
    if (note.anchor.kind !== 'lines' || note.id === review?.draft?.id) continue
    pinned.push({ anchor: note.anchor, row: { kind: 'note', key: `note:${note.id}`, note } })
  }
  const draft = review?.draft
  if (draft?.anchor.kind === 'lines') {
    pinned.push({
      anchor: draft.anchor,
      row: { kind: 'composer', key: `draft:${draft.id ?? 'new'}`, draft }
    })
  }
  if (pinned.length === 0) return rows
  const after = new Map<number, ViewRow[]>()
  for (const { anchor, row } of pinned) {
    let index = 0
    rows.forEach((candidate, i) => {
      const numbers = rowLines(candidate).map((line) => lineOnSide(line, anchor.side))
      if (numbers.some((n) => n !== null && n <= anchor.end)) index = i
    })
    after.set(index, [...(after.get(index) ?? []), row])
  }
  return rows.flatMap((row, i) => [row, ...(after.get(i) ?? [])])
}

function isChanged(row: ViewRow): boolean {
  if (row.kind === 'line') return row.line.type !== 'context'
  if (row.kind === 'pair') return row.left?.type !== 'context' || row.right?.type !== 'context'
  return false
}

/** Whether a row shows the line `lineNo` of one side, for jumping to it. */
function showsLine(row: ViewRow, side: Side, lineNo: number): boolean {
  const lines = rowLines(row)
  return lines.some((line) =>
    side === 'old'
      ? line?.type === 'del' && line.oldNo === lineNo
      : line?.type === 'add' && line.newNo === lineNo
  )
}

const ROW_HEIGHT = 20

export function TextDiff({
  patch,
  newText,
  highlights,
  layout,
  wrap,
  selection,
  fullFile,
  navigator,
  inline = false,
  review
}: Props) {
  const [expansion, setExpansion] = useState<Expansion>({})
  const [flash, setFlash] = useState<string | null>(null)

  const effectiveExpansion = useMemo(() => {
    if (!fullFile || newText === null) return expansion
    const all: Expansion = {}
    for (const gap of findGaps(patch.hunks, splitLines(newText).length)) {
      all[gap.index] = { afterPrevious: gap.lastNew - gap.firstNew + 1, beforeNext: 0 }
    }
    return all
  }, [fullFile, newText, patch, expansion])

  const baseRows = useMemo(
    () =>
      layout === 'split'
        ? splitRows(patch, newText, effectiveExpansion)
        : unifiedRows(patch, newText, effectiveExpansion),
    [patch, newText, effectiveExpansion, layout]
  )
  const rows = useMemo(() => withNotes(baseRows, review), [baseRows, review])
  const changeStarts = useMemo(() => {
    const starts: number[] = []
    let previous = false
    rows.forEach((row, index) => {
      const changed = isChanged(row)
      if (changed && !previous) starts.push(index)
      previous = changed
    })
    return starts
  }, [rows])
  const moves = useMemo(() => findMoves(patch), [patch])
  const partners = useMemo(() => pairChangedLines(patch), [patch])
  const intraline = useIntraline(partners)

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: inline ? 0 : rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 40,
    getItemKey: (index) => rows[index]?.key ?? index
  })

  // Dragging over line numbers includes or excludes every line it passes, like GitHub Desktop.
  const drag = useRef<{ include: boolean } | null>(null)
  // Dragging from a line's note button picks the lines a new note is about, like GitHub.
  type Pick = { side: Side; from: number; to: number }
  const [pick, setPick] = useState<Pick | null>(null)
  const pickRef = useRef(pick)
  pickRef.current = pick
  const finishPick = useRef<(pick: Pick) => void>(() => {})
  finishPick.current = (current) => {
    if (!review) return
    const start = Math.min(current.from, current.to)
    const end = Math.max(current.from, current.to)
    const excerpt: string[] = []
    const seen = new Set<number>()
    for (const row of baseRows) {
      for (const line of rowLines(row)) {
        const n = lineOnSide(line, current.side)
        if (line && n !== null && n >= start && n <= end && !seen.has(n)) {
          seen.add(n)
          excerpt.push(line.text)
        }
      }
    }
    review.begin({ kind: 'lines', side: current.side, start, end, excerpt })
  }
  useEffect(() => {
    const stop = () => {
      drag.current = null
      const current = pickRef.current
      if (!current) return
      pickRef.current = null
      setPick(null)
      finishPick.current(current)
    }
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [])

  // The ref moves with each event, not each render, so a fast drag loses no line.
  const movePick = useCallback((next: Pick) => {
    pickRef.current = next
    setPick(next)
  }, [])
  const onNoteDown = useCallback(
    (line: DiffLine, side: Side, instant: boolean) => {
      const n = lineOnSide(line, side)
      if (n === null) return
      if (instant) finishPick.current({ side, from: n, to: n })
      else movePick({ side, from: n, to: n })
    },
    [movePick]
  )
  const onPickEnter = useCallback(
    (line: DiffLine) => {
      const current = pickRef.current
      if (!current) return
      const n = lineOnSide(line, current.side)
      if (n !== null && n !== current.to) movePick({ ...current, to: n })
    },
    [movePick]
  )
  const isPicked = (line: DiffLine | null, side: Side): boolean => {
    if (!pick || pick.side !== side) return false
    const n = lineOnSide(line, side)
    return n !== null && n >= Math.min(pick.from, pick.to) && n <= Math.max(pick.from, pick.to)
  }

  const onGutterDown = useCallback(
    (line: DiffLine) => {
      if (!selection || line.type === 'context') return
      const include = !selection.selected.has(line.ordinal)
      drag.current = { include }
      selection.set([line.ordinal], include)
    },
    [selection]
  )
  const onGutterEnter = useCallback(
    (line: DiffLine) => {
      if (!selection || !drag.current || line.type === 'context') return
      if (selection.selected.has(line.ordinal) !== drag.current.include) {
        selection.set([line.ordinal], drag.current.include)
      }
    },
    [selection]
  )

  const expand = useCallback((gap: Gap, direction: 'up' | 'down' | 'all') => {
    setExpansion((current) => {
      const state = current[gap.index] ?? { afterPrevious: 0, beforeNext: 0 }
      const size = gap.lastNew - gap.firstNew + 1
      const next =
        direction === 'all'
          ? { afterPrevious: size, beforeNext: 0 }
          : direction === 'down'
            ? { ...state, afterPrevious: state.afterPrevious + EXPAND_STEP }
            : { ...state, beforeNext: state.beforeNext + EXPAND_STEP }
      return { ...current, [gap.index]: next }
    })
  }, [])

  const step = useCallback(
    (direction: 1 | -1) => {
      const top = virtualizer.range?.startIndex ?? 0
      const target =
        direction === 1
          ? changeStarts.find((index) => index > top + 1)
          : changeStarts.findLast((index) => index < top - 1)
      if (target !== undefined) virtualizer.scrollToIndex(target, { align: 'start' })
    },
    [changeStarts, virtualizer]
  )
  useEffect(() => {
    if (!navigator) return
    navigator.current = { next: () => step(1), previous: () => step(-1) }
    return () => {
      navigator.current = null
    }
  }, [navigator, step])

  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const jump = useCallback(
    (side: Side, lineNo: number) => {
      const index = rows.findIndex((row) => showsLine(row, side, lineNo))
      const row = rows[index]
      if (!row) return
      if (inline) {
        scrollRef.current
          ?.querySelector(`[data-index="${index}"]`)
          ?.scrollIntoView({ block: 'center' })
      } else {
        virtualizer.scrollToIndex(index, { align: 'center' })
      }
      setFlash(row.key)
      clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setFlash(null), 1400)
    },
    [rows, virtualizer, inline]
  )

  const onKeyDown = (event: KeyboardEvent) => {
    // Note composers sit inside the diff: their letters are text, not shortcuts.
    if (event.target instanceof HTMLTextAreaElement) return
    const nextKey = event.key === 'n' || (event.altKey && event.key === 'ArrowDown')
    const previousKey = event.key === 'p' || (event.altKey && event.key === 'ArrowUp')
    if (!nextKey && !previousKey) return
    event.preventDefault()
    step(nextKey ? 1 : -1)
  }

  const reviewing = review !== null
  const renderRow = (row: ViewRow, index: number, measure?: (node: Element | null) => void) => (
    <div
      key={row.key}
      className={inline ? 'diff-row' : undefined}
      data-index={index}
      data-flash={flash === row.key || undefined}
      ref={measure}
    >
      {row.kind === 'hunk' ? (
        <HunkHeader
          row={row}
          selection={selection}
          canExpand={newText !== null && !fullFile}
          onExpand={expand}
        />
      ) : row.kind === 'note' ? (
        <NoteCard note={row.note} />
      ) : row.kind === 'composer' ? (
        <NoteComposer draft={row.draft} />
      ) : row.kind === 'line' ? (
        <UnifiedLine
          line={row.line}
          highlights={highlights}
          ranges={intraline(row.line)}
          move={row.line.type === 'context' ? undefined : moves.get(row.line.ordinal)}
          onJump={jump}
          selected={isSelected(row.line, selection)}
          selectable={selection !== null}
          onGutterDown={onGutterDown}
          onGutterEnter={onGutterEnter}
          reviewing={reviewing}
          picked={isPicked(row.line, row.line.type === 'del' ? 'old' : 'new')}
          onNoteDown={onNoteDown}
          onPickEnter={onPickEnter}
        />
      ) : (
        <SplitLine
          row={row}
          highlights={highlights}
          intraline={intraline}
          moves={moves}
          onJump={jump}
          selection={selection}
          onGutterDown={onGutterDown}
          onGutterEnter={onGutterEnter}
          reviewing={reviewing}
          isPicked={isPicked}
          onNoteDown={onNoteDown}
          onPickEnter={onPickEnter}
        />
      )}
    </div>
  )

  if (inline) {
    return (
      <div
        ref={scrollRef}
        className="diff-inline"
        data-layout={layout}
        data-wrap={wrap || undefined}
      >
        {rows.map((row, index) => renderRow(row, index))}
      </div>
    )
  }

  const items = virtualizer.getVirtualItems()
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: n and p step through changes
    <div
      ref={scrollRef}
      className="diff-scroll"
      role="region"
      aria-label="Diff"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must take focus to scroll by keyboard
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-layout={layout}
      data-wrap={wrap || undefined}
      data-selectable={selection ? true : undefined}
    >
      <div className="diff-canvas" style={{ height: virtualizer.getTotalSize() }}>
        <div className="diff-window" style={{ transform: `translateY(${items[0]?.start ?? 0}px)` }}>
          {items.map((item) => {
            const row = rows[item.index]
            return row ? renderRow(row, item.index, virtualizer.measureElement) : null
          })}
        </div>
      </div>
    </div>
  )
}

function isSelected(line: DiffLine, selection: LineSelection | null): boolean {
  return line.type !== 'context' && selection !== null && selection.selected.has(line.ordinal)
}

/** Word-level ranges for a changed line, computed once per line pair. */
function useIntraline(partners: Map<number, ChangeLine>) {
  return useMemo(() => {
    const cache = new Map<number, Range[] | null>()
    return (line: DiffLine): Range[] | undefined => {
      if (line.type === 'context') return undefined
      if (!cache.has(line.ordinal)) {
        const partner = partners.get(line.ordinal)
        const result = partner
          ? line.type === 'del'
            ? intralineRanges(line.text, partner.text)
            : intralineRanges(partner.text, line.text)
          : null
        if (partner && result) {
          cache.set(line.type === 'del' ? line.ordinal : partner.ordinal, result.before)
          cache.set(line.type === 'del' ? partner.ordinal : line.ordinal, result.after)
        } else {
          cache.set(line.ordinal, null)
        }
      }
      return cache.get(line.ordinal) ?? undefined
    }
  }, [partners])
}

function tokensOf(line: DiffLine, highlights: Highlights) {
  return line.type === 'del' ? highlights.old?.[line.oldNo - 1] : highlights.new?.[line.newNo - 1]
}

const MARKER = { add: '+', del: '-', context: ' ' } as const

type LineHandlers = {
  onGutterDown: (line: DiffLine) => void
  onGutterEnter: (line: DiffLine) => void
}

type NoteHandlers = {
  /** Whether notes can be added: the person sees the note button on hover. */
  reviewing: boolean
  /** `instant` opens the note at once (keyboard); otherwise a drag picks the range until mouse up. */
  onNoteDown: (line: DiffLine, side: Side, instant: boolean) => void
  onPickEnter: (line: DiffLine) => void
}

/** The "+" that starts a note on a line; drag it over more lines to note a range. */
function NoteButton({
  line,
  side,
  onNoteDown
}: {
  line: DiffLine
  side: Side
  onNoteDown: NoteHandlers['onNoteDown']
}) {
  return (
    <button
      type="button"
      className="note-add"
      title="Add a note for the agent (drag to pick more lines)"
      aria-label="Add a note on this line"
      onMouseDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        // It sits in the gutter, whose own mouse down includes or excludes the line.
        event.stopPropagation()
        onNoteDown(line, side, false)
      }}
      onClick={(event) => {
        // A click from the keyboard has no mouse down before it.
        if (event.detail === 0) onNoteDown(line, side, true)
      }}
    >
      <Plus size={12} strokeWidth={2.5} />
    </button>
  )
}

type JumpHandler = (side: Side, lineNo: number) => void

/** On the first line of moved code: where it went, or came from, as a link to that place. */
function MoveTag({
  line,
  move,
  onJump
}: {
  line: DiffLine
  move: Move | undefined
  onJump: JumpHandler
}) {
  if (!move?.runStart || line.type === 'context') return null
  const lines = move.runLength === 1 ? 'line' : `${move.runLength} lines`
  const label =
    line.type === 'del'
      ? `Moved ${lines} to ${move.otherLine}`
      : `Moved ${lines} from ${move.otherLine}`
  return (
    <button
      type="button"
      className="move-tag"
      title={`Show line ${move.otherLine}`}
      onClick={() => onJump(line.type === 'del' ? 'new' : 'old', move.otherLine)}
    >
      <MoveRight size={11} />
      {label}
    </button>
  )
}

const UnifiedLine = memo(function UnifiedLine({
  line,
  highlights,
  ranges,
  move,
  onJump,
  selected,
  selectable,
  onGutterDown,
  onGutterEnter,
  reviewing,
  picked,
  onNoteDown,
  onPickEnter
}: {
  line: DiffLine
  highlights: Highlights
  ranges: Range[] | undefined
  move: Move | undefined
  onJump: JumpHandler
  selected: boolean
  selectable: boolean
  picked: boolean
} & LineHandlers &
  NoteHandlers) {
  const changed = line.type !== 'context'
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: extends a note range while the pointer drags
    <div
      className="dl"
      data-type={line.type}
      data-selected={(selectable && changed && selected) || undefined}
      data-moved={move ? true : undefined}
      data-picked={picked || undefined}
      onMouseEnter={reviewing ? () => onPickEnter(line) : undefined}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; keyboard users use the hunk and file toggles */}
      <span
        className="gutter"
        data-clickable={(selectable && changed) || undefined}
        title={
          selectable && changed
            ? selected
              ? 'Exclude this line from the commit'
              : 'Include this line in the commit'
            : undefined
        }
        onMouseDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          onGutterDown(line)
        }}
        onMouseEnter={() => onGutterEnter(line)}
      >
        <span className="ln">{line.type === 'add' ? '' : line.oldNo}</span>
        <span className="ln">{line.type === 'del' ? '' : line.newNo}</span>
        {reviewing ? (
          <NoteButton
            line={line}
            side={line.type === 'del' ? 'old' : 'new'}
            onNoteDown={onNoteDown}
          />
        ) : null}
      </span>
      <span className="marker">{MARKER[line.type]}</span>
      <Code
        text={line.text}
        tokens={tokensOf(line, highlights)}
        ranges={move ? undefined : ranges}
      />
      <MoveTag line={line} move={move} onJump={onJump} />
      {line.noNewline ? (
        <span className="eof" title="No newline at end of file">
          ⏎̸
        </span>
      ) : null}
    </div>
  )
})

function SplitLine({
  row,
  highlights,
  intraline,
  moves,
  onJump,
  selection,
  onGutterDown,
  onGutterEnter,
  reviewing,
  isPicked,
  onNoteDown,
  onPickEnter
}: {
  row: Extract<Row, { kind: 'pair' }>
  highlights: Highlights
  intraline: (line: DiffLine) => Range[] | undefined
  moves: Map<number, Move>
  onJump: JumpHandler
  selection: LineSelection | null
  isPicked: (line: DiffLine | null, side: Side) => boolean
} & LineHandlers &
  NoteHandlers) {
  const side = (line: DiffLine | null, which: 'left' | 'right') => {
    if (!line) return <div className="half" data-type="empty" />
    const changed = line.type !== 'context'
    const selected = isSelected(line, selection)
    const move = line.type === 'context' ? undefined : moves.get(line.ordinal)
    const number =
      which === 'left'
        ? line.type === 'add'
          ? ''
          : line.oldNo
        : line.type === 'del'
          ? ''
          : line.newNo
    const noteSide: Side = which === 'left' ? 'old' : 'new'
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: extends a note range while the pointer drags
      <div
        className="half"
        data-type={line.type}
        data-selected={(selection && changed && selected) || undefined}
        data-moved={move ? true : undefined}
        data-picked={isPicked(line, noteSide) || undefined}
        onMouseEnter={reviewing ? () => onPickEnter(line) : undefined}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; keyboard users use the hunk and file toggles */}
        <span
          className="gutter"
          data-clickable={(selection && changed) || undefined}
          onMouseDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            onGutterDown(line)
          }}
          onMouseEnter={() => onGutterEnter(line)}
        >
          <span className="ln">{number}</span>
          {reviewing ? <NoteButton line={line} side={noteSide} onNoteDown={onNoteDown} /> : null}
        </span>
        <span className="marker">{MARKER[line.type]}</span>
        <Code
          text={line.text}
          tokens={tokensOf(line, highlights)}
          ranges={move ? undefined : intraline(line)}
        />
        <MoveTag line={line} move={move} onJump={onJump} />
      </div>
    )
  }
  return (
    <div className="pair">
      {side(row.left, 'left')}
      {side(row.right, 'right')}
    </div>
  )
}

function HunkHeader({
  row,
  selection,
  canExpand,
  onExpand
}: {
  row: Extract<Row, { kind: 'hunk' }>
  selection: LineSelection | null
  canExpand: boolean
  onExpand: (gap: Gap, direction: 'up' | 'down' | 'all') => void
}) {
  const { hunk, gap, hidden } = row
  const ordinals = hunk ? hunkOrdinals(hunk) : []
  const chosen = selection
    ? ordinals.filter((ordinal) => selection.selected.has(ordinal)).length
    : 0
  const state = chosen === 0 ? 'off' : chosen === ordinals.length ? 'on' : 'mixed'
  const isTop = gap?.index === 0
  const isBottom = hunk === null

  return (
    <div className="hunk" data-state={selection && hunk ? state : undefined}>
      <span className="hunk-gutter">
        {canExpand && gap && hidden > 0 ? (
          hidden <= EXPAND_STEP ? (
            <button
              type="button"
              className="expand"
              title={`Show ${hidden} hidden lines`}
              onClick={() => onExpand(gap, 'all')}
            >
              <ChevronsUpDown size={13} />
            </button>
          ) : (
            <>
              {!isTop ? (
                <button
                  type="button"
                  className="expand"
                  title="Show more lines below"
                  onClick={() => onExpand(gap, 'down')}
                >
                  <ChevronDown size={13} />
                </button>
              ) : null}
              {!isBottom ? (
                <button
                  type="button"
                  className="expand"
                  title="Show more lines above"
                  onClick={() => onExpand(gap, 'up')}
                >
                  <ChevronUp size={13} />
                </button>
              ) : null}
            </>
          )
        ) : null}
      </span>
      {selection && hunk ? (
        <button
          type="button"
          className="hunk-toggle"
          data-state={state}
          onClick={() => selection.set(ordinals, state !== 'on')}
          title={
            state === 'on' ? 'Exclude this hunk from the commit' : 'Include this hunk in the commit'
          }
        >
          {state === 'on' ? 'Included' : state === 'off' ? 'Excluded' : 'Partly included'}
        </button>
      ) : null}
      <span className="hunk-text">
        {hunk
          ? `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ ${hunk.section}`
          : `${hidden} more unchanged ${hidden === 1 ? 'line' : 'lines'}`}
      </span>
    </div>
  )
}
