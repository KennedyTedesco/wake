import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Copy,
  EyeOff,
  FolderOpen,
  GitMerge,
  List,
  ListTree,
  MoreHorizontal,
  Trash2,
  Undo2
} from 'lucide-react'
import { type KeyboardEvent, useMemo, useRef, useState } from 'react'
import type { ChangedFile, RepoSnapshot } from '../../shared/model'
import { copyText } from '../lib/clipboard'
import { buildTree, type TreeRow, visibleRows } from '../lib/fileTree'
import { plural, splitPath } from '../lib/format'
import type { ChangesView } from '../lib/prefs'
import {
  type ChangesFocus,
  focusChanges,
  type Inclusion,
  openDialog,
  run,
  setAllIncluded,
  setInclusion,
  toast,
  updatePrefs,
  useStore
} from '../state/store'
import { Checkbox, type CheckState } from '../ui/Checkbox'
import { FileStatus } from '../ui/FileStatus'
import { contextMenu, type MenuItem, openMenuBelow } from '../ui/Menu'
import { PathLabel } from '../ui/PathLabel'
import { CommitBox } from './CommitBox'

function checkState(inclusion: Inclusion | undefined): CheckState {
  if (!inclusion || inclusion.kind === 'all') return 'on'
  if (inclusion.kind === 'none') return 'off'
  return inclusion.lines.length === 0 ? 'off' : 'mixed'
}

function discardFiles(files: ChangedFile[]) {
  const many = files.length > 1
  const only = files[0]
  openDialog({
    kind: 'confirm',
    title: many
      ? `Discard changes in ${files.length} files?`
      : `Discard changes in ${only ? splitPath(only.path).name : 'file'}?`,
    body: many
      ? 'Every change in these files is lost, and new files are deleted. This cannot be undone.'
      : only?.kind === 'untracked' || only?.kind === 'added'
        ? 'This new file is deleted. This cannot be undone.'
        : 'Its changes are lost and it goes back to the last commit. This cannot be undone.',
    confirmLabel: 'Discard changes',
    destructive: true,
    onConfirm: async () => {
      await run(
        'changes.discard',
        {
          files: files.map(({ path, oldPath, kind }) => ({
            path,
            kind,
            ...(oldPath ? { oldPath } : {})
          }))
        },
        {
          title: 'Could not discard the changes',
          success: many ? `Discarded changes in ${files.length} files` : 'Changes discarded'
        }
      )
    }
  })
}

function fileMenu(file: ChangedFile, repo: RepoSnapshot): MenuItem[] {
  const { name } = splitPath(file.path)
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot) : null
  const ignore = (pattern: string) =>
    void run(
      'changes.ignore',
      { pattern },
      { title: 'Could not update .gitignore', success: `Added ${pattern} to .gitignore` }
    )
  return [
    {
      label: 'Discard changes…',
      icon: Undo2,
      destructive: true,
      onSelect: () => discardFiles([file])
    },
    ...(file.kind === 'untracked'
      ? [
          { separator: true } as const,
          { label: 'Ignore file', icon: EyeOff, onSelect: () => ignore(file.path) },
          ...(extension
            ? [
                {
                  label: `Ignore all ${extension} files`,
                  icon: EyeOff,
                  onSelect: () => ignore(`*${extension}`)
                }
              ]
            : [])
        ]
      : []),
    { separator: true },
    {
      label: 'Copy file path',
      icon: Copy,
      onSelect: () => copyText(file.path) && toast('Path copied')
    },
    {
      label: 'Copy full path',
      icon: Copy,
      onSelect: () => copyText(`${repo.root}/${file.path}`) && toast('Path copied')
    },
    ...(file.kind !== 'deleted'
      ? [
          {
            label: 'Open in editor',
            icon: FolderOpen,
            onSelect: () =>
              void run(
                'workspace.openFile',
                { path: file.path },
                { title: 'Could not open the file' }
              )
          }
        ]
      : [])
  ]
}

export function ChangesList({ repo }: { repo: RepoSnapshot }) {
  const inclusions = useStore((state) => state.inclusions)
  const focus = useStore((state) => state.changesFocus)
  const files = repo.files
  const view = useStore((state) => state.prefs.changesView)
  const included = files.filter((file) => checkState(inclusions[file.path]) !== 'off').length
  const allState: CheckState =
    included === 0
      ? 'off'
      : included === files.length && files.every((f) => checkState(inclusions[f.path]) === 'on')
        ? 'on'
        : 'mixed'

  const headerMenu = (element: HTMLElement) =>
    openMenuBelow(element, [
      {
        label: 'Stash all changes',
        icon: Archive,
        disabled: files.length === 0,
        onSelect: () =>
          void run('stash.push', {}, { title: 'Could not stash', success: 'Changes stashed' })
      },
      {
        label: 'Discard all changes…',
        icon: Trash2,
        destructive: true,
        disabled: files.length === 0,
        onSelect: () => discardFiles(files)
      }
    ])

  return (
    <div className="changes">
      {repo.operation ? <OperationBanner repo={repo} /> : null}
      <div className="list-header">
        <Checkbox
          state={files.length === 0 ? 'off' : allState}
          label={allState === 'on' ? 'Exclude all files' : 'Include all files'}
          disabled={files.length === 0}
          onChange={setAllIncluded}
        />
        <span className="list-title">
          {files.length === 0 ? 'No changed files' : plural(files.length, 'changed file')}
        </span>
        {files.length > 0 ? (
          <div className="segmented" role="group" aria-label="Show files as">
            <button
              type="button"
              aria-pressed={view === 'tree'}
              title="Show as a tree"
              onClick={() => updatePrefs({ changesView: 'tree' })}
            >
              <ListTree size={14} />
            </button>
            <button
              type="button"
              aria-pressed={view === 'list'}
              title="Show as a list"
              onClick={() => updatePrefs({ changesView: 'list' })}
            >
              <List size={14} />
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className="icon-button"
          aria-label="Changes actions"
          onClick={(event) => headerMenu(event.currentTarget)}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
      <FileRows repo={repo} focus={focus} inclusions={inclusions} view={view} />
      {repo.filesTruncated ? (
        <p className="list-note">
          Only the first files are listed. Add a .gitignore to hide build output.
        </p>
      ) : null}
      {repo.stashCount > 0 ? (
        <button
          type="button"
          className="stash-entry"
          data-active={focus?.kind === 'stash' || undefined}
          onClick={() => focusChanges({ kind: 'stash', index: 0 })}
        >
          <Archive size={14} />
          <span>Stashed changes</span>
          <span className="count">{repo.stashCount}</span>
        </button>
      ) : null}
      <CommitBox repo={repo} includedCount={included} />
    </div>
  )
}

type Row = TreeRow<ChangedFile>

/** What a group of files adds up to: all in, none in, or some. */
function groupState(files: ChangedFile[], inclusions: Record<string, Inclusion>): CheckState {
  let on = 0
  let off = 0
  for (const file of files) {
    const state = checkState(inclusions[file.path])
    if (state === 'on') on++
    else if (state === 'off') off++
  }
  return on === files.length ? 'on' : off === files.length ? 'off' : 'mixed'
}

function setGroupIncluded(files: ChangedFile[], include: boolean) {
  for (const file of files) setInclusion(file.path, include ? { kind: 'all' } : { kind: 'none' })
}

function folderMenu(row: Extract<Row, { kind: 'dir' }>, onCollapseAll: () => void): MenuItem[] {
  return [
    { label: 'Include folder', onSelect: () => setGroupIncluded(row.files, true) },
    { label: 'Exclude folder', onSelect: () => setGroupIncluded(row.files, false) },
    { separator: true },
    {
      label: `Discard changes in ${row.name}…`,
      icon: Undo2,
      destructive: true,
      onSelect: () => discardFiles(row.files)
    },
    { separator: true },
    {
      label: 'Copy folder path',
      icon: Copy,
      onSelect: () => copyText(row.path) && toast('Path copied')
    },
    { label: 'Collapse all folders', onSelect: onCollapseAll }
  ]
}

function FileRows({
  repo,
  focus,
  inclusions,
  view
}: {
  repo: RepoSnapshot
  focus: ChangesFocus
  inclusions: Record<string, Inclusion>
  view: ChangesView
}) {
  const files = repo.files
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const tree = useMemo(() => buildTree(files), [files])
  const rows = useMemo<Row[]>(
    () =>
      view === 'tree'
        ? visibleRows(tree, closed)
        : files.map((file) => ({ kind: 'file', name: file.path, file, depth: 0 })),
    [view, tree, closed, files]
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 28,
    overscan: 12
  })
  const focusedIndex =
    focus?.kind === 'file'
      ? rows.findIndex((row) => row.kind === 'file' && row.file.path === focus.path)
      : -1

  const toggleFolder = (path: string) =>
    setClosed((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  const collapseAll = () =>
    setClosed(
      new Set(visibleRows(tree, new Set()).flatMap((row) => (row.kind === 'dir' ? [row.path] : [])))
    )

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      // Folders are skipped: the arrows walk the files, as the diff beside them does.
      for (let index = focusedIndex + step; index >= 0 && index < rows.length; index += step) {
        const row = rows[index]
        if (row?.kind !== 'file') continue
        focusChanges({ kind: 'file', path: row.file.path })
        virtualizer.scrollToIndex(index, { align: 'auto' })
        break
      }
    } else if (event.key === ' ' && focusedIndex >= 0) {
      event.preventDefault()
      const row = rows[focusedIndex]
      if (row?.kind === 'file') {
        const on = checkState(inclusions[row.file.path]) === 'on'
        setInclusion(row.file.path, on ? { kind: 'none' } : { kind: 'all' })
      }
    }
  }

  return (
    <div
      ref={scrollRef}
      className="file-list"
      data-view={view}
      role="tree"
      tabIndex={0}
      aria-label="Changed files"
      aria-activedescendant={focusedIndex >= 0 ? `file-${focusedIndex}` : undefined}
      onKeyDown={onKeyDown}
    >
      <div style={{ blockSize: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]
          if (!row) return null
          const indent = { paddingInlineStart: `${10 + row.depth * 14}px` }
          if (row.kind === 'dir') {
            const state = groupState(row.files, inclusions)
            return (
              <div
                key={`d:${row.path}`}
                role="treeitem"
                tabIndex={-1}
                aria-expanded={row.open}
                className="file-row folder-row"
                style={{ transform: `translateY(${item.start}px)`, ...indent }}
                onClick={() => toggleFolder(row.path)}
                onKeyDown={undefined}
                onContextMenu={contextMenu(() => folderMenu(row, collapseAll))}
                title={row.path}
              >
                <Checkbox
                  state={state}
                  label={state === 'on' ? `Exclude ${row.path}` : `Include ${row.path}`}
                  onChange={(include) => setGroupIncluded(row.files, include)}
                />
                {row.open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span className="folder-name">{row.name}</span>
                <span className="folder-count">{row.files.length}</span>
              </div>
            )
          }
          const { file } = row
          const { name } = splitPath(file.path)
          const state = checkState(inclusions[file.path])
          return (
            <div
              key={file.path}
              id={`file-${item.index}`}
              role="treeitem"
              tabIndex={-1}
              aria-selected={item.index === focusedIndex}
              className="file-row"
              style={{
                transform: `translateY(${item.start}px)`,
                ...(view === 'tree' ? { paddingInlineStart: `${10 + row.depth * 14 + 19}px` } : {})
              }}
              onClick={() => focusChanges({ kind: 'file', path: file.path })}
              onKeyDown={undefined}
              onContextMenu={contextMenu(() => fileMenu(file, repo))}
              title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
            >
              <Checkbox
                state={state}
                label={
                  state === 'on'
                    ? `Exclude ${name} from the commit`
                    : `Include ${name} in the commit`
                }
                onChange={(include) =>
                  setInclusion(file.path, include ? { kind: 'all' } : { kind: 'none' })
                }
              />
              {view === 'tree' ? (
                <span className="path-label">
                  <span className="path-name" data-kind={file.kind}>
                    {name}
                  </span>
                  {file.oldPath ? <span className="path-dir">from {file.oldPath}</span> : null}
                </span>
              ) : (
                <PathLabel path={file.path} oldPath={file.oldPath} />
              )}
              <FileStatus kind={file.kind} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

const OPERATION_LABEL = {
  merge: 'Merge',
  rebase: 'Rebase',
  'cherry-pick': 'Cherry-pick',
  revert: 'Revert'
} as const

function OperationBanner({ repo }: { repo: RepoSnapshot }) {
  if (!repo.operation) return null
  const label = OPERATION_LABEL[repo.operation]
  const conflicts = repo.files.filter((file) => file.kind === 'conflicted').length
  return (
    <div className="banner" data-tone={conflicts > 0 ? 'warning' : 'info'}>
      <GitMerge size={15} />
      <div className="banner-text">
        <strong>{label} in progress</strong>
        <span>
          {conflicts > 0
            ? `${plural(conflicts, 'conflicted file')} to resolve`
            : 'All conflicts are resolved'}
        </span>
      </div>
      <div className="banner-actions">
        <button
          type="button"
          className="button"
          onClick={() =>
            openDialog({
              kind: 'confirm',
              title: `Abort the ${label.toLowerCase()}?`,
              body: 'The repository goes back to how it was before it started. Conflict resolutions you made are lost.',
              confirmLabel: `Abort ${label.toLowerCase()}`,
              destructive: true,
              onConfirm: async () => {
                await run(
                  'operation.abort',
                  {},
                  {
                    title: `Could not abort the ${label.toLowerCase()}`,
                    success: `${label} aborted`
                  }
                )
              }
            })
          }
        >
          Abort
        </button>
        <button
          type="button"
          className="button"
          data-variant="primary"
          disabled={conflicts > 0}
          onClick={() =>
            void run(
              'operation.continue',
              {},
              {
                title: `Could not continue the ${label.toLowerCase()}`,
                success: `${label} completed`
              }
            )
          }
        >
          {repo.operation === 'merge' ? 'Commit merge' : 'Continue'}
        </button>
      </div>
    </div>
  )
}
