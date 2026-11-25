import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  CloudUpload,
  Copy,
  ExternalLink,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  Maximize2,
  RefreshCw,
  SquareTerminal
} from 'lucide-react'
import { useRef, useState } from 'react'
import type { RepoSnapshot } from '../../shared/model'
import { openExternal, operation } from '../lib/bridge'
import { copyText } from '../lib/clipboard'
import { hostLabel, pullRequestUrl, timeAgo } from '../lib/format'
import { surface } from '../lib/surface'
import { openDialog, publish, refresh, showFailure, sync, toast, useStore } from '../state/store'
import { type MenuItem, openMenuBelow } from '../ui/Menu'
import { BranchMenu } from './BranchMenu'

export function Toolbar({ repo }: { repo: RepoSnapshot }) {
  const [branchesOpen, setBranchesOpen] = useState(false)
  const branchButton = useRef<HTMLButtonElement>(null)
  return (
    <header className="toolbar">
      <RepoButton repo={repo} />
      <button
        ref={branchButton}
        type="button"
        className="tool"
        data-open={branchesOpen || undefined}
        aria-expanded={branchesOpen}
        onClick={() => setBranchesOpen((open) => !open)}
      >
        <GitBranch size={16} className="tool-icon" />
        <span className="tool-text">
          <span className="tool-label">Current branch</span>
          <span className="tool-value">{headLabel(repo)}</span>
        </span>
        <ChevronDown size={14} className="tool-chevron" />
      </button>
      <SyncButton repo={repo} />
      <ViewSwitch />
      {branchesOpen ? (
        <BranchMenu
          repo={repo}
          anchorX={branchButton.current?.offsetLeft ?? 0}
          onClose={() => setBranchesOpen(false)}
        />
      ) : null}
    </header>
  )
}

/** In the sidebar: open the full-size tab. In the tab: go back to the terminal (also Escape). */
function ViewSwitch() {
  const inTab = surface === 'tab'
  const label = inTab ? 'Back to the terminal (Esc)' : 'Open Wake in a full-size tab (⌘⇧G)'
  return (
    <button
      type="button"
      className="tool tool-switch"
      title={label}
      aria-label={label}
      onClick={async () => {
        const result = await operation(inTab ? 'view.backToTerminal' : 'view.openTab', {})
        if (!result.ok)
          showFailure(inTab ? 'Could not show the terminal' : 'Could not open the tab', result)
      }}
    >
      {inTab ? <SquareTerminal size={17} /> : <Maximize2 size={16} />}
    </button>
  )
}

function headLabel(repo: RepoSnapshot): string {
  switch (repo.head.kind) {
    case 'branch':
    case 'unborn':
      return repo.head.name
    case 'detached':
      return `Detached at ${repo.head.sha.slice(0, 7)}`
  }
}

function RepoButton({ repo }: { repo: RepoSnapshot }) {
  const remote = repo.remote
  const branch = repo.head.kind === 'branch' ? repo.head.name : null
  const prUrl =
    remote && branch && repo.head.kind === 'branch' && repo.head.upstream
      ? pullRequestUrl(remote, branch)
      : null

  const items: MenuItem[] = [
    ...(remote?.webUrl
      ? [
          {
            label: `View on ${hostLabel(remote)}`,
            icon: ExternalLink,
            onSelect: () => void openExternal(remote.webUrl ?? '')
          }
        ]
      : []),
    ...(prUrl
      ? [
          {
            label: remote?.host === 'gitlab' ? 'Create merge request' : 'Create pull request',
            icon: GitPullRequest,
            onSelect: () => void openExternal(prUrl)
          }
        ]
      : []),
    {
      label: 'Copy repository path',
      icon: Copy,
      onSelect: () => copyText(repo.root) && toast('Path copied')
    },
    { separator: true },
    { label: 'Refresh', icon: RefreshCw, onSelect: () => void refresh() }
  ]

  return (
    <button
      type="button"
      className="tool tool-repo"
      title={repo.root}
      onClick={(event) => openMenuBelow(event.currentTarget, items)}
    >
      <FolderGit2 size={16} className="tool-icon" />
      <span className="tool-text">
        <span className="tool-label">Repository</span>
        <span className="tool-value">{repo.repoName}</span>
      </span>
      <ChevronDown size={14} className="tool-chevron" />
    </button>
  )
}

type SyncAction = {
  label: string
  detail: string
  icon: typeof RefreshCw
  ahead: number
  behind: number
  run: () => void
  disabled?: boolean
}

function primaryAction(repo: RepoSnapshot): SyncAction {
  const remoteName = repo.remote?.name ?? 'origin'
  const fetched = repo.lastFetchedAt
    ? `Last fetched ${timeAgo(repo.lastFetchedAt)}`
    : 'Never fetched'
  if (!repo.remote) {
    return {
      label: 'No remote',
      detail: 'Add a remote to sync',
      icon: CloudUpload,
      ahead: 0,
      behind: 0,
      run: () => {},
      disabled: true
    }
  }
  if (repo.head.kind === 'branch' && !repo.head.upstream) {
    return {
      label: 'Publish branch',
      detail: `Push it to ${remoteName}`,
      icon: CloudUpload,
      ahead: 0,
      behind: 0,
      run: () => void publish()
    }
  }
  const upstream = repo.head.kind === 'branch' ? repo.head.upstream : null
  const ahead = upstream?.ahead ?? 0
  const behind = upstream?.behind ?? 0
  if (behind > 0) {
    return {
      label: `Pull ${remoteName}`,
      detail: fetched,
      icon: ArrowDown,
      ahead,
      behind,
      run: () => void sync('pull')
    }
  }
  if (ahead > 0) {
    return {
      label: `Push ${remoteName}`,
      detail: fetched,
      icon: ArrowUp,
      ahead,
      behind,
      run: () => void sync('push')
    }
  }
  return {
    label: `Fetch ${remoteName}`,
    detail: fetched,
    icon: RefreshCw,
    ahead,
    behind,
    run: () => void sync('fetch')
  }
}

const RUNNING_LABEL = {
  fetch: 'Fetching',
  pull: 'Pulling',
  push: 'Pushing',
  publish: 'Publishing'
} as const

function SyncButton({ repo }: { repo: RepoSnapshot }) {
  const running = useStore((state) => state.sync)
  const action = primaryAction(repo)
  const Icon = action.icon
  const hasUpstream = repo.head.kind === 'branch' && repo.head.upstream !== null

  const more = (element: HTMLElement) =>
    openMenuBelow(element, [
      {
        label: 'Fetch',
        icon: RefreshCw,
        disabled: !repo.remote,
        onSelect: () => void sync('fetch')
      },
      { label: 'Pull', icon: ArrowDown, disabled: !hasUpstream, onSelect: () => void sync('pull') },
      { label: 'Push', icon: ArrowUp, disabled: !hasUpstream, onSelect: () => void sync('push') },
      { separator: true },
      {
        label: 'Force push…',
        destructive: true,
        disabled: !hasUpstream,
        onSelect: () =>
          openDialog({
            kind: 'confirm',
            title: 'Force push?',
            body: 'This replaces the branch on the remote with your local branch. Commits that only exist on the remote are lost. Orca uses --force-with-lease, so it stops if someone pushed since your last fetch.',
            confirmLabel: 'Force push',
            destructive: true,
            onConfirm: () => sync('push', true)
          })
      }
    ])

  return (
    <div className="tool-group">
      <button
        type="button"
        className="tool tool-sync"
        disabled={action.disabled || running !== null}
        onClick={action.run}
        title={action.detail}
      >
        {running ? (
          <span className="spinner tool-icon" />
        ) : (
          <Icon size={16} className="tool-icon" />
        )}
        <span className="tool-text">
          <span className="tool-value">
            {running ? `${RUNNING_LABEL[running.op]}…` : action.label}
          </span>
          <span className="tool-label">
            {running ? running.text || 'Talking to the remote' : action.detail}
          </span>
        </span>
        {!running && (action.behind > 0 || action.ahead > 0) ? (
          <span className="sync-counts">
            {action.behind > 0 ? (
              <span className="count">
                {action.behind}
                <ArrowDown size={11} />
              </span>
            ) : null}
            {action.ahead > 0 ? (
              <span className="count">
                {action.ahead}
                <ArrowUp size={11} />
              </span>
            ) : null}
          </span>
        ) : null}
        {running?.percent !== null && running?.percent !== undefined ? (
          <span className="tool-progress" style={{ inlineSize: `${running.percent}%` }} />
        ) : null}
      </button>
      <button
        type="button"
        className="tool tool-more"
        aria-label="More sync actions"
        disabled={running !== null}
        onClick={(event) => more(event.currentTarget)}
      >
        <ChevronDown size={14} />
      </button>
    </div>
  )
}
