import {
  ArrowLeft,
  FileDiff,
  FolderX,
  GitBranch,
  History,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Server
} from 'lucide-react'
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react'
import type { RepoSnapshot } from '../shared/model'
import { onWorkerEvent, operation } from './lib/bridge'
import { surface } from './lib/surface'
import { openNotes, setTrayOpen, useNotes } from './state/notes'
import {
  closeDetail,
  refresh,
  setSyncProgress,
  setTab,
  type Tab,
  updatePrefs,
  useStore
} from './state/store'
import { DialogHost } from './ui/DialogHost'
import { MenuHost } from './ui/Menu'
import { Toasts } from './ui/Toasts'
import { ChangesDetail } from './views/ChangesDetail'
import { ChangesList } from './views/ChangesList'
import { CommitView } from './views/CommitView'
import { HistoryList } from './views/HistoryList'
import { NotesButton, NotesTray } from './views/NotesTray'
import { Toolbar } from './views/Toolbar'

// Below this width the list and the diff take turns instead of sitting side by side.
const WIDE_LAYOUT_MIN = 680
const SIDEBAR_MIN = 220

export function App() {
  useEffect(() => {
    void refresh()
    const offChanged = onWorkerEvent('repo.changed', () => void refresh())
    const offProgress = onWorkerEvent('sync.progress', ({ text, percent }) =>
      setSyncProgress(text, percent)
    )
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      offChanged()
      offProgress()
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  // In the full-size tab, Escape goes back to the terminal unless something else wants it: a
  // field being edited, an open menu or dialog, or a handler that already took the key.
  useEffect(() => {
    if (surface !== 'tab') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, dialog, .menu, .branch-menu, .notes-tray')
      )
        return
      if (useStore.getState().dialog) return
      void operation('view.backToTerminal', {})
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const repoState = useStore((state) => state.repoState)
  const repoError = useStore((state) => state.repoError)

  let content: React.ReactNode
  if (!repoState) {
    content = repoError ? (
      <Notice icon={<FolderX size={28} />} title="Wake could not start" body={repoError} />
    ) : (
      <div className="notice">
        <span className="spinner" />
      </div>
    )
  } else {
    switch (repoState.kind) {
      case 'no-workspace':
        content = (
          <Notice
            icon={<GitBranch size={28} />}
            title="No workspace open"
            body="Open a workspace in Orca to see its changes, history and branches here."
          />
        )
        break
      case 'unsupported-host':
        content = (
          <Notice
            icon={<Server size={28} />}
            title={`${repoState.workspaceName} runs on another machine`}
            body="Wake works with workspaces on this computer for now. Use Orca's Source Control for remote workspaces."
          />
        )
        break
      case 'not-a-repo':
        content = (
          <Notice
            icon={<FolderX size={28} />}
            title={`${repoState.workspaceName} is not a Git repository`}
            body={repoState.path}
          />
        )
        break
      case 'ready':
        content = <Shell repo={repoState.repo} />
        break
    }
  }

  return (
    <>
      {content}
      <MenuHost />
      <DialogHost />
      <Toasts />
    </>
  )
}

function Notice({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="notice">
      <span className="notice-icon">{icon}</span>
      <h2>{title}</h2>
      <p className="muted">{body}</p>
    </div>
  )
}

function useWide(element: React.RefObject<HTMLElement | null>): boolean {
  const [wide, setWide] = useState(true)
  useEffect(() => {
    const node = element.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWide(entry.contentRect.width >= WIDE_LAYOUT_MIN)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [element])
  return wide
}

function Shell({ repo }: { repo: RepoSnapshot }) {
  const tab = useStore((state) => state.tab)
  const showDetail = useStore((state) => state.showDetail)
  const sidebarWidth = useStore((state) => state.prefs.sidebarWidth)
  const sidebarCollapsed = useStore((state) => state.prefs.sidebarCollapsed)
  const main = useRef<HTMLDivElement>(null)
  const wide = useWide(main)
  // The narrow layout already shows the list and the diff in turns, so only wide folds the list.
  const collapsed = wide && sidebarCollapsed
  useEffect(() => openNotes(repo.root), [repo.root])

  const back = wide ? null : (
    <button
      type="button"
      className="icon-button back"
      aria-label="Back to the list"
      onClick={closeDetail}
    >
      <ArrowLeft size={15} />
    </button>
  )
  const conflicted = repo.files.some((file) => file.kind === 'conflicted')

  return (
    <div className="app">
      <Toolbar repo={repo} />
      <div
        ref={main}
        className="main"
        data-layout={wide ? 'wide' : 'narrow'}
        data-detail={(!wide && showDetail) || undefined}
      >
        {collapsed ? (
          <Rail tab={tab} changes={repo.files.length} conflicted={conflicted} />
        ) : (
          <aside className="sidebar" style={wide ? { inlineSize: sidebarWidth } : undefined}>
            <div className="tabs">
              <div className="tablist" role="tablist">
                <button
                  type="button"
                  role="tab"
                  className="tab"
                  aria-selected={tab === 'changes'}
                  onClick={() => setTab('changes')}
                >
                  Changes
                  {repo.files.length > 0 ? (
                    <span className="count" data-tone={conflicted ? 'warning' : undefined}>
                      {repo.files.length}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  role="tab"
                  className="tab"
                  aria-selected={tab === 'history'}
                  onClick={() => setTab('history')}
                >
                  History
                </button>
              </div>
              <NotesButton />
              {wide ? (
                <button
                  type="button"
                  className="tab tab-fold"
                  title="Hide the list"
                  aria-label="Hide the list"
                  onClick={() => updatePrefs({ sidebarCollapsed: true })}
                >
                  <PanelLeftClose size={15} />
                </button>
              ) : null}
            </div>
            {tab === 'changes' ? <ChangesList repo={repo} /> : <HistoryList repo={repo} />}
          </aside>
        )}
        {wide && !collapsed ? <Resizer width={sidebarWidth} container={main} /> : null}
        <section className="detail">
          {tab === 'changes' ? (
            <ChangesDetail repo={repo} leading={back} />
          ) : (
            <CommitView repo={repo} leading={back} />
          )}
        </section>
        <NotesTray />
      </div>
    </div>
  )
}

function Resizer({
  width,
  container
}: {
  width: number
  container: React.RefObject<HTMLElement | null>
}) {
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const max = (container.current?.clientWidth ?? 900) * 0.6
    const onMove = (move: PointerEvent) => {
      const next = width + move.clientX - startX
      // Dragging the list well under its smallest width folds it, as in VS Code.
      if (next < SIDEBAR_MIN / 2) {
        updatePrefs({ sidebarCollapsed: true })
        return
      }
      updatePrefs({ sidebarWidth: Math.round(Math.max(SIDEBAR_MIN, Math.min(max, next))) })
    }
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
  }
  return (
    <div
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => updatePrefs({ sidebarWidth: 300 })}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft')
          updatePrefs({ sidebarWidth: Math.max(SIDEBAR_MIN, width - 16) })
        if (event.key === 'ArrowRight') updatePrefs({ sidebarWidth: width + 16 })
      }}
    />
  )
}

/** The folded list: one icon for each view, and the way back to the full list. */
function Rail({ tab, changes, conflicted }: { tab: Tab; changes: number; conflicted: boolean }) {
  const notes = useNotes((state) => state.notes.length)
  const trayOpen = useNotes((state) => state.trayOpen)
  const open = (next: Tab) => {
    setTab(next)
    updatePrefs({ sidebarCollapsed: false })
  }
  return (
    <nav className="rail" aria-label="Views">
      <button
        type="button"
        className="rail-button"
        title="Show the list"
        aria-label="Show the list"
        onClick={() => updatePrefs({ sidebarCollapsed: false })}
      >
        <PanelLeftOpen size={16} />
      </button>
      <button
        type="button"
        className="rail-button"
        aria-current={tab === 'changes' || undefined}
        title="Changes"
        aria-label={`Changes, ${changes} files`}
        onClick={() => open('changes')}
      >
        <FileDiff size={16} />
        {changes > 0 ? (
          <span className="rail-badge" data-tone={conflicted ? 'warning' : undefined}>
            {changes}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        className="rail-button"
        aria-current={tab === 'history' || undefined}
        title="History"
        aria-label="History"
        onClick={() => open('history')}
      >
        <History size={16} />
      </button>
      {notes > 0 || trayOpen ? (
        <button
          type="button"
          className="rail-button"
          data-open={trayOpen || undefined}
          aria-expanded={trayOpen}
          title={`${notes} ${notes === 1 ? 'note' : 'notes'} for the agent`}
          aria-label={`${notes} ${notes === 1 ? 'note' : 'notes'} for the agent`}
          onClick={() => setTrayOpen(!trayOpen)}
        >
          <MessageSquareText size={16} />
          <span className="rail-badge" data-tone="accent">
            {notes}
          </span>
        </button>
      ) : null}
    </nav>
  )
}
