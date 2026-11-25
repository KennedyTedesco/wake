import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ArrowUp,
  Copy,
  ExternalLink,
  GitBranchPlus,
  GitCommitVertical,
  RotateCcw,
  Search,
  Tag,
  Undo2,
  X
} from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef } from 'react'
import type { Commit, RepoSnapshot } from '../../shared/model'
import { openExternal } from '../lib/bridge'
import { copyText } from '../lib/clipboard'
import { commitUrl, hostLabel, timeAgo } from '../lib/format'
import { refNameError, sanitizeRefName } from '../lib/refName'
import {
  loadHistory,
  openDialog,
  run,
  selectCommit,
  setHistoryQuery,
  toast,
  undoCommit,
  useStore
} from '../state/store'
import { Avatar } from '../ui/Avatar'
import { contextMenu, type MenuItem } from '../ui/Menu'

export function commitMenu(commit: Commit, repo: RepoSnapshot): MenuItem[] {
  const isHead = repo.lastCommit?.sha === commit.sha
  const url = repo.remote ? commitUrl(repo.remote, commit.sha) : null
  return [
    ...(isHead && commit.unpushed
      ? [
          { label: 'Undo commit', icon: Undo2, onSelect: () => void undoCommit() },
          { separator: true } as const
        ]
      : []),
    {
      label: 'Revert changes in commit',
      icon: RotateCcw,
      onSelect: () =>
        void run(
          'commit.revert',
          { sha: commit.sha },
          { title: 'Could not revert the commit', success: `Reverted ${commit.shortSha}` }
        )
    },
    {
      label: 'Reset to commit…',
      icon: Undo2,
      disabled: isHead,
      onSelect: () =>
        openDialog({
          kind: 'confirm',
          title: `Reset ${repo.head.kind === 'branch' ? repo.head.name : 'HEAD'} to ${commit.shortSha}?`,
          body: 'Every commit after this one is undone, and its changes stay in your working tree so nothing is lost. Pushed commits then need a force push.',
          confirmLabel: 'Reset to commit',
          destructive: true,
          onConfirm: async () => {
            await run(
              'commit.resetTo',
              { sha: commit.sha },
              { title: 'Could not reset', success: `Reset to ${commit.shortSha}` }
            )
          }
        })
    },
    {
      label: 'Cherry-pick commit',
      icon: GitCommitVertical,
      disabled: isHead,
      onSelect: () =>
        void run(
          'commit.cherryPick',
          { sha: commit.sha },
          { title: 'Could not cherry-pick', success: `Cherry-picked ${commit.shortSha}` }
        )
    },
    {
      label: 'Check out commit',
      icon: GitCommitVertical,
      onSelect: () =>
        openDialog({
          kind: 'confirm',
          title: `Check out ${commit.shortSha}?`,
          body: 'You leave your branch and look at the repository as it was at this commit (detached HEAD). Switch back to a branch to keep working.',
          confirmLabel: 'Check out',
          onConfirm: async () => {
            await run(
              'commit.checkout',
              { sha: commit.sha },
              { title: 'Could not check out the commit', success: `Checked out ${commit.shortSha}` }
            )
          }
        })
    },
    { separator: true },
    {
      label: 'New branch from commit…',
      icon: GitBranchPlus,
      onSelect: () =>
        openDialog({
          kind: 'prompt',
          title: `New branch from ${commit.shortSha}`,
          label: 'Name',
          initial: '',
          placeholder: 'feature/my-change',
          confirmLabel: 'Create branch',
          validate: (value) => refNameError(value, []),
          onSubmit: (value) =>
            run(
              'branch.create',
              { name: sanitizeRefName(value), startPoint: commit.sha },
              { title: 'Could not create the branch', success: `Created ${sanitizeRefName(value)}` }
            )
        })
    },
    {
      label: 'Create tag…',
      icon: Tag,
      onSelect: () =>
        openDialog({
          kind: 'prompt',
          title: `Tag ${commit.shortSha}`,
          label: 'Tag name',
          initial: '',
          placeholder: 'v1.0.0',
          confirmLabel: 'Create tag',
          validate: (value) => refNameError(value, []),
          onSubmit: (value) =>
            run(
              'tag.create',
              { name: sanitizeRefName(value), sha: commit.sha },
              { title: 'Could not create the tag', success: `Tagged ${sanitizeRefName(value)}` }
            )
        })
    },
    { separator: true },
    { label: 'Copy SHA', icon: Copy, onSelect: () => copyText(commit.sha) && toast('SHA copied') },
    {
      label: 'Copy summary',
      icon: Copy,
      onSelect: () => copyText(commit.summary) && toast('Summary copied')
    },
    ...(url && repo.remote
      ? [
          {
            label: `View on ${hostLabel(repo.remote)}`,
            icon: ExternalLink,
            onSelect: () => void openExternal(url)
          }
        ]
      : [])
  ]
}

export function HistoryList({ repo }: { repo: RepoSnapshot }) {
  const history = useStore((state) => state.history)
  const scrollRef = useRef<HTMLDivElement>(null)
  const commits = history.commits
  const virtualizer = useVirtualizer({
    count: commits.length + (history.hasMore ? 1 : 0),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 52,
    overscan: 10
  })
  const items = virtualizer.getVirtualItems()
  const last = items.at(-1)

  useEffect(() => {
    if (last && last.index >= commits.length - 1 && history.hasMore && !history.loading)
      void loadHistory(false)
  }, [last, commits.length, history.hasMore, history.loading])

  // Searching waits for a pause in typing.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onSearch = (value: string) => {
    setHistoryQuery(value)
    clearTimeout(searchTimer.current ?? undefined)
    searchTimer.current = setTimeout(() => void loadHistory(true), 250)
  }

  const selectedIndex = commits.findIndex((commit) => commit.sha === history.selectedSha)
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const next = Math.max(
      0,
      Math.min(commits.length - 1, selectedIndex + (event.key === 'ArrowDown' ? 1 : -1))
    )
    const commit = commits[next]
    if (commit) {
      void selectCommit(commit.sha, false)
      virtualizer.scrollToIndex(next, { align: 'auto' })
    }
  }

  return (
    <div className="history">
      <label className="search list-search">
        <Search size={14} />
        <input
          className="search-input"
          placeholder="Search commits"
          value={history.query}
          spellCheck={false}
          onChange={(event) => onSearch(event.target.value)}
        />
        {history.query ? (
          <button
            type="button"
            className="icon-button"
            aria-label="Clear search"
            onClick={() => onSearch('')}
          >
            <X size={12} />
          </button>
        ) : null}
      </label>
      <div
        ref={scrollRef}
        className="commit-list"
        role="listbox"
        tabIndex={0}
        aria-label="Commits"
        onKeyDown={onKeyDown}
      >
        {commits.length === 0 && !history.loading ? (
          <p className="empty-hint">
            {history.query ? 'No commit matches your search.' : 'No commits yet.'}
          </p>
        ) : null}
        <div style={{ blockSize: virtualizer.getTotalSize(), position: 'relative' }}>
          {items.map((item) => {
            const commit = commits[item.index]
            if (!commit) {
              return (
                <div
                  key="more"
                  className="commit-row loading"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <span className="spinner" />
                </div>
              )
            }
            return (
              <div
                key={commit.sha}
                role="option"
                tabIndex={-1}
                aria-selected={commit.sha === history.selectedSha}
                className="commit-row"
                style={{ transform: `translateY(${item.start}px)` }}
                onClick={() => void selectCommit(commit.sha)}
                onKeyDown={undefined}
                onContextMenu={contextMenu(() => commitMenu(commit, repo))}
              >
                <Avatar name={commit.authorName} />
                <div className="commit-main">
                  <span className="commit-summary">{commit.summary || '(no message)'}</span>
                  <span className="commit-meta">
                    {commit.authorName} · {timeAgo(commit.authorDate)}
                  </span>
                </div>
                <div className="commit-side">
                  {commit.refs
                    .filter((ref) => ref.startsWith('tag:'))
                    .slice(0, 2)
                    .map((ref) => (
                      <span key={ref} className="tag" title={ref.slice(4)}>
                        {ref.slice(4)}
                      </span>
                    ))}
                  {commit.unpushed ? (
                    <span className="unpushed" title="Not pushed yet">
                      <ArrowUp size={12} />
                    </span>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
