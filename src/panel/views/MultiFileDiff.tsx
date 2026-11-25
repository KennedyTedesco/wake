// Every file of a commit (or stash) in one scrolling page, as GitHub shows a pull request, next
// to a filterable tree of the changed files. The tree follows the scroll, and a click on a file
// in the tree scrolls to its diff.
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  Copy,
  FileText,
  Folder,
  FolderOpen,
  ListTree,
  MessageSquarePlus,
  Rows3,
  Search,
  WrapText,
  X
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parsePatch } from '../../shared/diff/parse'
import type { ChangedFile, CommitFile } from '../../shared/model'
import { DiffContent, noteSourceOf } from '../diff/DiffPane'
import { type DiffSource, useDiff } from '../diff/useDiff'
import { copyText } from '../lib/clipboard'
import { buildTree, filterFiles, type TreeNode, treeOrder } from '../lib/fileTree'
import { plural } from '../lib/format'
import { startDraft } from '../state/notes'
import { toast, updatePrefs, useStore } from '../state/store'
import { FileStatus } from '../ui/FileStatus'
import { PathLabel } from '../ui/PathLabel'

type File = ChangedFile | CommitFile

type Props = {
  files: File[]
  sourceFor: (file: ChangedFile) => DiffSource
  /** Scrolls with the diffs above them, such as the commit message. */
  header: ReactNode
}

// A file this large waits for a click, as on GitHub: drawing it would stall the page.
const LARGE_DIFF_LINES = 3000
const ROW = 20
// Keep in step with `--files-bar` in app.css: sticky file headers sit below the bar.
const BAR_HEIGHT = 38

const statsOf = (file: File) =>
  'additions' in file && file.additions !== null && file.deletions !== null
    ? { additions: file.additions, deletions: file.deletions }
    : null

export function MultiFileDiff({ files, sourceFor, header }: Props) {
  const prefs = useStore((state) => state.prefs)
  const [filter, setFilter] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [closedDirs, setClosedDirs] = useState<ReadonlySet<string>>(new Set())
  const [treeOpen, setTreeOpen] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const sections = useRef(new Map<string, HTMLElement>())

  const tree = useMemo(() => buildTree(filterFiles(files, filter)), [files, filter])
  const ordered = useMemo(() => treeOrder(tree), [tree])
  const totals = useMemo(
    () =>
      files.reduce(
        (sum, file) => {
          const stats = statsOf(file)
          return stats
            ? {
                additions: sum.additions + stats.additions,
                deletions: sum.deletions + stats.deletions
              }
            : sum
        },
        { additions: 0, deletions: 0 }
      ),
    [files]
  )

  // The file whose diff crosses the top of the page is the one the tree marks.
  const frame = useRef(0)
  const spy = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const element = scroller.current
      if (!element) return
      const line = element.scrollTop + BAR_HEIGHT + 4
      let current: string | null = ordered[0]?.path ?? null
      for (const file of ordered) {
        const section = sections.current.get(file.path)
        if (section && section.offsetTop <= line) current = file.path
      }
      setActive(current)
    })
  }, [ordered])
  useEffect(spy, [spy])

  const scrollTo = (path: string) => {
    const element = scroller.current
    const section = sections.current.get(path)
    if (!element || !section) return
    element.scrollTo({ top: section.offsetTop - BAR_HEIGHT })
    setActive(path)
    setTreeOpen(false)
  }

  const register = useCallback((path: string, element: HTMLElement | null) => {
    if (element) sections.current.set(path, element)
    else sections.current.delete(path)
  }, [])

  const toggleFile = useCallback((path: string) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const allCollapsed = ordered.length > 0 && ordered.every((file) => collapsed.has(file.path))

  return (
    <div className="multi" data-tree-open={treeOpen || undefined}>
      <aside className="tree-pane" aria-label="Changed files">
        <label className="search tree-search">
          <Search size={13} />
          <input
            className="search-input"
            placeholder="Filter files"
            value={filter}
            spellCheck={false}
            onChange={(event) => setFilter(event.target.value)}
          />
          {filter ? (
            <button
              type="button"
              className="icon-button"
              aria-label="Clear filter"
              onClick={() => setFilter('')}
            >
              <X size={12} />
            </button>
          ) : null}
        </label>
        <div className="tree" role="tree">
          {ordered.length === 0 ? <p className="empty-hint">No file matches “{filter}”.</p> : null}
          <TreeRows
            nodes={tree}
            depth={0}
            active={active}
            closed={closedDirs}
            onToggleDir={(path) =>
              setClosedDirs((current) => {
                const next = new Set(current)
                if (next.has(path)) next.delete(path)
                else next.add(path)
                return next
              })
            }
            onSelect={scrollTo}
          />
        </div>
      </aside>
      <div ref={scroller} className="multi-scroll" onScroll={spy}>
        {header}
        <div className="files-bar">
          <button
            type="button"
            className="icon-button tree-toggle"
            aria-pressed={treeOpen}
            title="Show the file tree"
            onClick={() => setTreeOpen((open) => !open)}
          >
            <ListTree size={14} />
          </button>
          <span className="files-count">
            {filter
              ? `${ordered.length} of ${plural(files.length, 'file')}`
              : plural(files.length, 'file')}
          </span>
          {totals.additions || totals.deletions ? (
            <span className="diff-stats">
              <span className="stat-add">+{totals.additions}</span>
              <span className="stat-del">−{totals.deletions}</span>
            </span>
          ) : null}
          <span className="files-bar-spacer" />
          <button
            type="button"
            className="icon-button"
            title={allCollapsed ? 'Expand all files' : 'Collapse all files'}
            onClick={() =>
              setCollapsed(allCollapsed ? new Set() : new Set(ordered.map((file) => file.path)))
            }
          >
            {allCollapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
          </button>
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
            title={prefs.fullFile ? 'Show only the changes' : 'Show whole files'}
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
        </div>
        {ordered.map((file) => (
          <FileSection
            key={file.path}
            file={file}
            source={sourceFor(file)}
            collapsed={collapsed.has(file.path)}
            onToggle={toggleFile}
            register={register}
            root={scroller}
          />
        ))}
        {files.length === 0 ? <p className="empty-hint">No file changes.</p> : null}
      </div>
    </div>
  )
}

function TreeRows({
  nodes,
  depth,
  active,
  closed,
  onToggleDir,
  onSelect
}: {
  nodes: TreeNode<File>[]
  depth: number
  active: string | null
  closed: ReadonlySet<string>
  onToggleDir: (path: string) => void
  onSelect: (path: string) => void
}) {
  return nodes.map((node) => {
    const indent = { paddingInlineStart: `${8 + depth * 12}px` }
    if (node.kind === 'dir') {
      const open = !closed.has(node.path)
      return (
        <div key={`d:${node.path}`} role="group">
          <button
            type="button"
            role="treeitem"
            aria-expanded={open}
            className="tree-row tree-dir"
            style={indent}
            title={node.path}
            onClick={() => onToggleDir(node.path)}
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {open ? <FolderOpen size={13} /> : <Folder size={13} />}
            <span className="tree-name">{node.name}</span>
            <span className="folder-count">{treeOrder(node.children).length}</span>
          </button>
          {open ? (
            <TreeRows
              nodes={node.children}
              depth={depth + 1}
              active={active}
              closed={closed}
              onToggleDir={onToggleDir}
              onSelect={onSelect}
            />
          ) : null}
        </div>
      )
    }
    const stats = statsOf(node.file)
    return (
      <button
        type="button"
        role="treeitem"
        aria-selected={node.file.path === active}
        key={`f:${node.file.path}`}
        className="tree-row tree-file"
        style={{ paddingInlineStart: `${8 + depth * 12 + 18}px` }}
        title={node.file.oldPath ? `${node.file.oldPath} → ${node.file.path}` : node.file.path}
        onClick={() => onSelect(node.file.path)}
      >
        <span className="tree-name" data-kind={node.file.kind}>
          {node.name}
        </span>
        {stats ? (
          <span className="file-stats">
            {stats.additions > 0 ? <span className="stat-add">+{stats.additions}</span> : null}
            {stats.deletions > 0 ? <span className="stat-del">−{stats.deletions}</span> : null}
          </span>
        ) : null}
        <FileStatus kind={node.file.kind} />
      </button>
    )
  })
}

function FileSection({
  file,
  source,
  collapsed,
  onToggle,
  register,
  root
}: {
  file: File
  source: DiffSource
  collapsed: boolean
  onToggle: (path: string) => void
  register: (path: string, element: HTMLElement | null) => void
  root: React.RefObject<HTMLDivElement | null>
}) {
  const ref = useRef<HTMLElement>(null)
  const [near, setNear] = useState(false)
  const [forced, setForced] = useState(false)
  const stats = statsOf(file)
  const lines = stats ? stats.additions + stats.deletions : 0
  const large = lines > LARGE_DIFF_LINES

  useEffect(() => {
    register(file.path, ref.current)
    return () => register(file.path, null)
  }, [file.path, register])

  // Diffs load as they come near the screen, so a commit of 300 files opens at once.
  useEffect(() => {
    const element = ref.current
    if (!element || near) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true)
          observer.disconnect()
        }
      },
      { root: root.current, rootMargin: '1500px 0px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [near, root])

  return (
    <section ref={ref} className="file-section" aria-label={file.path}>
      <header className="file-section-head">
        <button
          type="button"
          className="icon-button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Show ${file.path}` : `Hide ${file.path}`}
          onClick={() => onToggle(file.path)}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <PathLabel path={file.path} oldPath={file.oldPath} />
        <button
          type="button"
          className="icon-button copy-path"
          aria-label="Copy file path"
          title="Copy file path"
          onClick={() => copyText(file.path) && toast('Path copied')}
        >
          <Copy size={12} />
        </button>
        {stats ? (
          <span className="diff-stats">
            <span className="stat-add">+{stats.additions}</span>
            <span className="stat-del">−{stats.deletions}</span>
          </span>
        ) : null}
        <button
          type="button"
          className="icon-button"
          aria-label={`Add a note on ${file.path}`}
          title="Add a note on this file for the agent (or click + on a line)"
          onClick={() => {
            if (collapsed) onToggle(file.path)
            startDraft({ source: noteSourceOf(source), path: file.path, anchor: { kind: 'file' } })
          }}
        >
          <MessageSquarePlus size={13} />
        </button>
        <FileStatus kind={file.kind} />
      </header>
      {collapsed ? null : near && (!large || forced) ? (
        <SectionBody source={source} />
      ) : near && large ? (
        <div className="file-section-gate">
          <span className="muted">Large diff: {lines.toLocaleString('en')} changed lines.</span>
          <button type="button" className="button" onClick={() => setForced(true)}>
            Load diff
          </button>
        </div>
      ) : (
        <div style={{ minBlockSize: Math.min(4000, (lines + 8) * ROW) }} />
      )}
    </section>
  )
}

function SectionBody({ source }: { source: DiffSource }) {
  const ignoreWhitespace = useStore((state) => state.prefs.ignoreWhitespace)
  const load = useDiff(source, 0, ignoreWhitespace)
  const diff = load.status === 'ready' ? load.diff : null
  const patch = useMemo(() => (diff?.kind === 'text' ? parsePatch(diff.patch) : null), [diff])
  if (load.status === 'loading') {
    return (
      <div className="file-section-gate">
        <span className="spinner" />
      </div>
    )
  }
  if (load.status === 'error') {
    return (
      <div className="file-section-gate">
        <span className="muted">{load.message}</span>
      </div>
    )
  }
  return (
    <div className="file-section-body">
      <DiffContent
        source={source}
        diff={load.diff}
        patch={patch}
        selectable={false}
        navigator={null}
        inline
      />
    </div>
  )
}
