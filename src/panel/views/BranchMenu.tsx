import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  GitBranch,
  GitBranchPlus,
  GitMerge,
  Globe,
  Pencil,
  Search,
  Trash2
} from 'lucide-react'
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { Branch, BranchList, RepoSnapshot } from '../../shared/model'
import { operation, request } from '../lib/bridge'
import { copyText } from '../lib/clipboard'
import { timeAgo } from '../lib/format'
import { refNameError, sanitizeRefName } from '../lib/refName'
import { openDialog, refresh, run, showFailure, toast } from '../state/store'
import { contextMenu, type MenuItem } from '../ui/Menu'

/** `anchorX`: the left edge of the button that opened the menu, in toolbar pixels. */
type Props = { repo: RepoSnapshot; anchorX: number; onClose: () => void }

type Section = { title: string; branches: Branch[] }

function sections(list: BranchList, filter: string): Section[] {
  const query = filter.trim().toLowerCase()
  const matches = (branch: Branch) => !query || branch.name.toLowerCase().includes(query)
  const local = list.local.filter(matches)
  const byName = new Map(local.map((branch) => [branch.name, branch]))
  const used = new Set<string>()
  const take = (names: (string | null)[]) =>
    names.flatMap((name) => {
      const branch = name ? byName.get(name) : undefined
      if (!branch || used.has(branch.name)) return []
      used.add(branch.name)
      return [branch]
    })

  const result: Section[] = []
  if (!query) {
    const defaults = take([list.defaultBranch])
    if (defaults.length) result.push({ title: 'Default branch', branches: defaults })
    const recent = take(list.recent)
    if (recent.length) result.push({ title: 'Recent branches', branches: recent })
  }
  const others = local
    .filter((branch) => !used.has(branch.name))
    .sort((a, b) => b.lastCommitDate - a.lastCommitDate)
  if (others.length) result.push({ title: query ? 'Branches' : 'Other branches', branches: others })

  const localNames = new Set(list.local.map((branch) => branch.name))
  const remote = list.remote.filter(
    (branch) =>
      matches(branch) && !localNames.has(branch.name.slice((branch.remote?.length ?? -1) + 1))
  )
  if (remote.length) result.push({ title: 'Remote branches', branches: remote })
  return result
}

export function BranchMenu({ repo, anchorX, onClose }: Props) {
  const [list, setList] = useState<BranchList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    request('branch.list', {}).then(setList, (reason: unknown) =>
      setError(reason instanceof Error ? reason.message : String(reason))
    )
  }, [])

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (root.current && event.target instanceof Node && !root.current.contains(event.target)) {
        if (!(event.target instanceof Element && event.target.closest('.menu-backdrop, .dialog')))
          onClose()
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [onClose])

  const groups = useMemo(() => (list ? sections(list, filter) : []), [list, filter])
  const flat = groups.flatMap((group) => group.branches)
  const current = list?.current ?? (repo.head.kind === 'branch' ? repo.head.name : null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: the highlighted row changes with `active`
  useEffect(() => {
    listRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const checkout = async (branch: Branch) => {
    if (branch.name === current) return onClose()
    if (branch.worktreePath) {
      toast(`${branch.name} is checked out in another worktree: ${branch.worktreePath}`, 'error')
      return
    }
    onClose()
    const isRemote = branch.remote !== null
    const result = await operation('branch.checkout', { name: branch.name, remote: isRemote })
    if (result.ok) {
      toast(
        `Switched to ${isRemote ? branch.name.slice((branch.remote?.length ?? 0) + 1) : branch.name}`,
        'success'
      )
    } else if (result.kind === 'dirty') {
      openDialog({
        kind: 'confirm',
        title: 'Stash your changes and switch?',
        body: `Your changes would be overwritten by ${branch.name}. Stash them first? You can restore them later from Stashed changes.`,
        confirmLabel: 'Stash and switch',
        onConfirm: async () => {
          const stashed = await operation('stash.push', {
            message: `Changes left on ${current ?? 'HEAD'}`
          })
          if (!stashed.ok) return showFailure('Could not stash your changes', stashed)
          await run(
            'branch.checkout',
            { name: branch.name, remote: isRemote },
            { title: 'Could not switch branches', success: `Switched to ${branch.name}` }
          )
        }
      })
    } else {
      showFailure('Could not switch branches', result)
    }
    await refresh()
  }

  const existing = list?.local.map((branch) => branch.name) ?? []

  const createBranch = (startPoint?: string) => {
    onClose()
    openDialog({
      kind: 'prompt',
      title: startPoint ? `New branch from ${startPoint}` : 'New branch',
      label: 'Name',
      initial: filter.trim() ? sanitizeRefName(filter) : '',
      placeholder: 'feature/my-change',
      hint: `Created from ${startPoint ?? current ?? 'HEAD'}, with your changes carried along.`,
      confirmLabel: 'Create branch',
      validate: (value) => refNameError(value, existing),
      preview: (value) => {
        const clean = sanitizeRefName(value)
        return clean && clean !== value.trim() ? `Will be created as ${clean}` : null
      },
      onSubmit: (value) =>
        run(
          'branch.create',
          { name: sanitizeRefName(value), ...(startPoint ? { startPoint } : {}) },
          {
            title: 'Could not create the branch',
            success: `Created and switched to ${sanitizeRefName(value)}`
          }
        )
    })
  }

  const branchMenu = (branch: Branch): MenuItem[] => {
    const isLocal = branch.remote === null
    const isCurrent = branch.name === current
    return [
      {
        label: 'Switch to branch',
        icon: GitBranch,
        disabled: isCurrent,
        onSelect: () => void checkout(branch)
      },
      {
        label: `Merge into ${current ?? 'current branch'}`,
        icon: GitMerge,
        disabled: isCurrent || !current,
        onSelect: () => {
          onClose()
          void run(
            'branch.merge',
            { name: branch.name },
            {
              title: `Could not merge ${branch.name}`,
              success: `Merged ${branch.name} into ${current}`
            }
          )
        }
      },
      {
        label: 'New branch from here…',
        icon: GitBranchPlus,
        onSelect: () => createBranch(branch.name)
      },
      { separator: true },
      {
        label: 'Rename…',
        icon: Pencil,
        disabled: !isLocal,
        onSelect: () => {
          onClose()
          openDialog({
            kind: 'prompt',
            title: `Rename ${branch.name}`,
            label: 'New name',
            initial: branch.name,
            confirmLabel: 'Rename',
            validate: (value) =>
              sanitizeRefName(value) === branch.name
                ? 'Enter a different name.'
                : refNameError(value, existing),
            onSubmit: (value) =>
              run(
                'branch.rename',
                { from: branch.name, to: sanitizeRefName(value) },
                { title: 'Could not rename the branch', success: 'Branch renamed' }
              )
          })
        }
      },
      {
        label: 'Copy branch name',
        icon: Copy,
        onSelect: () => copyText(branch.name) && toast('Branch name copied')
      },
      { separator: true },
      {
        label: 'Delete…',
        icon: Trash2,
        destructive: true,
        disabled: !isLocal || isCurrent || branch.worktreePath !== null,
        onSelect: () => {
          onClose()
          openDialog({
            kind: 'confirm',
            title: `Delete ${branch.name}?`,
            body: branch.upstream
              ? `This deletes the local branch and ${branch.upstream} on the remote. Commits that are on no other branch can only be found through the reflog.`
              : 'Commits that are on no other branch can only be found through the reflog.',
            confirmLabel: 'Delete branch',
            destructive: true,
            onConfirm: async () => {
              await run(
                'branch.delete',
                { name: branch.name, force: true, deleteRemote: branch.upstream !== null },
                { title: 'Could not delete the branch', success: `Deleted ${branch.name}` }
              )
            }
          })
        }
      }
    ]
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(flat.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(0, index - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const branch = flat[active]
      if (branch) void checkout(branch)
      else if (filter.trim()) createBranch()
    }
  }

  let index = -1
  return (
    <div
      className="branch-menu"
      style={{ '--menu-x': `${anchorX}px` } as React.CSSProperties}
      ref={root}
      role="dialog"
      aria-label="Branches"
      onKeyDown={onKeyDown}
    >
      <div className="branch-menu-top">
        <label className="search">
          <Search size={14} />
          <input
            className="search-input"
            placeholder="Filter branches"
            value={filter}
            spellCheck={false}
            // biome-ignore lint/a11y/noAutofocus: opening the menu is asking to pick a branch
            autoFocus
            onChange={(event) => {
              setFilter(event.target.value)
              setActive(0)
            }}
          />
        </label>
        <button
          type="button"
          className="button"
          data-variant="primary"
          onClick={() => createBranch()}
        >
          <GitBranchPlus size={14} /> New branch
        </button>
      </div>
      <div className="branch-list" ref={listRef} role="listbox">
        {error ? <p className="empty-hint">{error}</p> : null}
        {!list && !error ? (
          <div className="empty-hint">
            <span className="spinner" />
          </div>
        ) : null}
        {list && flat.length === 0 ? (
          <div className="empty-hint">
            <p>No branch matches “{filter}”.</p>
            <button type="button" className="button" onClick={() => createBranch()}>
              Create “{sanitizeRefName(filter)}”
            </button>
          </div>
        ) : null}
        {groups.map((group) => (
          <div key={group.title} className="branch-group">
            <div className="branch-group-title">{group.title}</div>
            {group.branches.map((branch) => {
              index++
              const position = index
              const isCurrent = branch.name === current
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox handles arrows and Enter for its rows
                <div
                  key={branch.ref}
                  role="option"
                  tabIndex={-1}
                  aria-selected={isCurrent}
                  className="branch-row"
                  data-active={position === active || undefined}
                  data-blocked={branch.worktreePath ? true : undefined}
                  onMouseEnter={() => setActive(position)}
                  onClick={() => void checkout(branch)}
                  onContextMenu={contextMenu(() => branchMenu(branch))}
                  title={
                    branch.worktreePath
                      ? `Checked out in ${branch.worktreePath}`
                      : branch.lastCommitSummary
                  }
                >
                  <span className="branch-icon">
                    {isCurrent ? (
                      <Check size={14} />
                    ) : branch.remote ? (
                      <Globe size={14} />
                    ) : (
                      <GitBranch size={14} />
                    )}
                  </span>
                  <span className="branch-name">{branch.name}</span>
                  {branch.worktreePath ? <span className="tag">worktree</span> : null}
                  {branch.behind > 0 ? (
                    <span className="count">
                      {branch.behind}
                      <ArrowDown size={10} />
                    </span>
                  ) : null}
                  {branch.ahead > 0 ? (
                    <span className="count">
                      {branch.ahead}
                      <ArrowUp size={10} />
                    </span>
                  ) : null}
                  <span className="branch-time">
                    {branch.lastCommitDate ? timeAgo(branch.lastCommitDate) : ''}
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <div className="branch-menu-foot muted">
        ↑↓ to move · Enter to switch · right-click for more
      </div>
    </div>
  )
}
