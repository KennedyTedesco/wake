import {
  ArrowDown,
  ArrowUp,
  CircleCheck,
  CircleDot,
  CircleX,
  CloudUpload,
  ExternalLink,
  GitPullRequest,
  PartyPopper
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import type { ChangedFile, PullRequest, RepoSnapshot, Stash } from '../../shared/model'
import { DiffPane } from '../diff/DiffPane'
import { openExternal, request } from '../lib/bridge'
import { hostLabel, plural, pullRequestUrl, timeAgo } from '../lib/format'
import { focusChanges, openDialog, publish, run, sync, useStore } from '../state/store'
import { MultiFileDiff } from './MultiFileDiff'

export function ChangesDetail({ repo, leading }: { repo: RepoSnapshot; leading: ReactNode }) {
  const focus = useStore((state) => state.changesFocus)
  if (focus?.kind === 'stash') return <StashView repo={repo} leading={leading} />
  const file =
    focus?.kind === 'file' ? repo.files.find((item) => item.path === focus.path) : undefined
  if (file) return <DiffPane source={{ kind: 'working', file }} selectable leading={leading} />
  return <NoChanges repo={repo} />
}

function Suggestion({
  icon,
  title,
  body,
  action
}: {
  icon: ReactNode
  title: string
  body: string
  action: ReactNode
}) {
  return (
    <div className="suggestion">
      <span className="suggestion-icon">{icon}</span>
      <div className="suggestion-text">
        <strong>{title}</strong>
        <span className="muted">{body}</span>
      </div>
      {action}
    </div>
  )
}

/** The open pull request of the branch, asked again after a push changes what it holds. */
function usePullRequest(repo: RepoSnapshot): PullRequest | null {
  const branch = repo.head.kind === 'branch' ? repo.head.name : null
  const upstream = repo.head.kind === 'branch' ? repo.head.upstream : null
  const onGitHub = repo.remote?.host === 'github' && upstream !== null
  const ahead = upstream?.ahead ?? 0
  const [found, setFound] = useState<{ branch: string; pr: PullRequest | null } | null>(null)
  const [lastAhead, setLastAhead] = useState(ahead)
  // A drop in commits ahead means a push landed: the checks and the title may have changed.
  const pushed = ahead < lastAhead
  if (ahead !== lastAhead) setLastAhead(ahead)

  useEffect(() => {
    if (!branch || !onGitHub) return
    let live = true
    request('pr.current', { refresh: pushed }).then(
      (pr) => live && setFound({ branch, pr }),
      () => live && setFound({ branch, pr: null })
    )
    return () => {
      live = false
    }
  }, [branch, onGitHub, pushed])

  return found && found.branch === branch && onGitHub ? found.pr : null
}

const CHECKS = {
  passing: { label: 'Checks passing', icon: <CircleCheck size={13} /> },
  failing: { label: 'Checks failing', icon: <CircleX size={13} /> },
  pending: { label: 'Checks running', icon: <CircleDot size={13} /> }
} as const

const REVIEWS = {
  approved: 'Approved',
  'changes-requested': 'Changes requested',
  'review-required': 'Review required'
} as const

/** The branch's open pull request, first and big: the place most people go next. */
function PullRequestCard({ pr }: { pr: PullRequest }) {
  return (
    <section className="pr-card" aria-label={`Pull request #${pr.number}`}>
      <span className="pr-card-icon" data-draft={pr.draft || undefined}>
        <GitPullRequest size={20} />
      </span>
      <div className="pr-card-text">
        <span className="pr-card-kicker">
          {pr.draft ? 'Draft pull request' : 'Pull request open'} · <strong>#{pr.number}</strong>
        </span>
        <strong className="pr-card-title">{pr.title}</strong>
        <span className="pr-card-chips">
          {pr.checks ? (
            <span className="pr-chip" data-tone={pr.checks}>
              {CHECKS[pr.checks].icon}
              {CHECKS[pr.checks].label}
            </span>
          ) : null}
          {pr.review ? (
            <span className="pr-chip" data-tone={pr.review}>
              {REVIEWS[pr.review]}
            </span>
          ) : null}
        </span>
      </div>
      <button
        type="button"
        className="button"
        data-variant="primary"
        onClick={() => void openExternal(pr.url)}
      >
        Open #{pr.number}
        <ExternalLink size={13} />
      </button>
    </section>
  )
}

function NoChanges({ repo }: { repo: RepoSnapshot }) {
  const upstream = repo.head.kind === 'branch' ? repo.head.upstream : null
  const branch = repo.head.kind === 'branch' ? repo.head.name : null
  const remote = repo.remote
  const pr = usePullRequest(repo)
  const prUrl = remote && branch && upstream && !pr ? pullRequestUrl(remote, branch) : null
  const remoteName = remote?.name ?? 'origin'
  const hasSuggestions =
    (upstream !== null && (upstream.ahead > 0 || upstream.behind > 0)) ||
    (remote !== null && branch !== null && upstream === null) ||
    prUrl !== null ||
    Boolean(remote?.webUrl)

  if (repo.files.length > 0) {
    return (
      <div className="no-changes">
        {pr ? <PullRequestCard pr={pr} /> : null}
        <p className="muted">Select a file to see its changes.</p>
      </div>
    )
  }

  return (
    <div className="no-changes">
      <div className="no-changes-head">
        <PartyPopper size={28} />
        <h2>No local changes</h2>
        <p className="muted">
          Everything in <strong>{repo.repoName}</strong> is committed.
          {hasSuggestions ? ' Here are a few things you can do next.' : ''}
        </p>
      </div>
      {pr ? <PullRequestCard pr={pr} /> : null}
      <div className="suggestions">
        {upstream && upstream.behind > 0 ? (
          <Suggestion
            icon={<ArrowDown size={18} />}
            title={`Pull ${plural(upstream.behind, 'commit')} from ${remoteName}`}
            body={`${upstream.name} has commits that ${branch} does not have yet.`}
            action={
              <button
                type="button"
                className="button"
                data-variant="primary"
                onClick={() => void sync('pull')}
              >
                Pull
              </button>
            }
          />
        ) : null}
        {upstream && upstream.ahead > 0 ? (
          <Suggestion
            icon={<ArrowUp size={18} />}
            title={`Push ${plural(upstream.ahead, 'commit')} to ${remoteName}`}
            body="Your local commits are not on the remote yet."
            action={
              <button
                type="button"
                className="button"
                data-variant="primary"
                onClick={() => void sync('push')}
              >
                Push
              </button>
            }
          />
        ) : null}
        {remote && branch && !upstream ? (
          <Suggestion
            icon={<CloudUpload size={18} />}
            title="Publish your branch"
            body={`${branch} only exists on this computer. Publish it to share it and open a pull request.`}
            action={
              <button
                type="button"
                className="button"
                data-variant="primary"
                onClick={() => void publish()}
              >
                Publish
              </button>
            }
          />
        ) : null}
        {prUrl && remote ? (
          <Suggestion
            icon={<GitPullRequest size={18} />}
            title={remote.host === 'gitlab' ? 'Create a merge request' : 'Create a pull request'}
            body={`Ask for a review of ${branch} on ${hostLabel(remote)}.`}
            action={
              <button type="button" className="button" onClick={() => void openExternal(prUrl)}>
                Open
              </button>
            }
          />
        ) : null}
        {remote?.webUrl ? (
          <Suggestion
            icon={<ExternalLink size={18} />}
            title={`View on ${hostLabel(remote)}`}
            body="Open the repository in your browser."
            action={
              <button
                type="button"
                className="button"
                onClick={() => void openExternal(remote.webUrl ?? '')}
              >
                Open
              </button>
            }
          />
        ) : null}
      </div>
    </div>
  )
}

function StashView({ repo, leading }: { repo: RepoSnapshot; leading: ReactNode }) {
  const focus = useStore((state) => state.changesFocus)
  const revision = useStore((state) => state.revision)
  const index = focus?.kind === 'stash' ? focus.index : 0
  const [stashes, setStashes] = useState<Stash[]>([])
  const [files, setFiles] = useState<ChangedFile[] | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` reloads after any change
  useEffect(() => {
    request('stash.list', {}).then(setStashes, () => setStashes([]))
  }, [revision, repo.stashCount])

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new stash list means a stash moved under `index`
  useEffect(() => {
    let current = true
    setFiles(null)
    request('stash.files', { index }).then(
      (list) => {
        if (current) setFiles(list)
      },
      () => {
        if (current) setFiles([])
      }
    )
    return () => {
      current = false
    }
  }, [index, stashes])

  const stash = stashes.find((item) => item.index === index) ?? null
  const header = (
    <div className="detail-head">
      {leading}
      <div className="detail-title">
        <select
          className="select"
          aria-label="Stash"
          value={index}
          onChange={(event) => focusChanges({ kind: 'stash', index: Number(event.target.value) })}
        >
          {stashes.map((item) => (
            <option key={item.ref} value={item.index}>
              {item.message || item.ref}
            </option>
          ))}
        </select>
        {stash ? (
          <span className="muted">
            {stash.branch ? `On ${stash.branch} · ` : ''}
            {timeAgo(stash.date)}
          </span>
        ) : null}
      </div>
      <div className="detail-actions">
        <button
          type="button"
          className="button"
          onClick={() =>
            openDialog({
              kind: 'confirm',
              title: 'Discard this stash?',
              body: 'Its changes are deleted. This cannot be undone.',
              confirmLabel: 'Discard stash',
              destructive: true,
              onConfirm: async () => {
                const done = await run(
                  'stash.drop',
                  { index },
                  { title: 'Could not discard the stash', success: 'Stash discarded' }
                )
                if (done) focusChanges(null)
              }
            })
          }
        >
          Discard
        </button>
        <button
          type="button"
          className="button"
          onClick={() =>
            void run(
              'stash.apply',
              { index, drop: false },
              { title: 'Could not apply the stash', success: 'Stash applied' }
            )
          }
        >
          Apply
        </button>
        <button
          type="button"
          className="button"
          data-variant="primary"
          title="Apply the changes and remove the stash"
          onClick={async () => {
            const done = await run(
              'stash.apply',
              { index, drop: true },
              { title: 'Could not restore the stash', success: 'Stash restored' }
            )
            if (done) focusChanges(null)
          }}
        >
          Restore
        </button>
      </div>
    </div>
  )

  if (files === null) {
    return (
      <div className="browser">
        {header}
        <div className="diff-message">
          <span className="spinner" />
        </div>
      </div>
    )
  }
  return (
    <MultiFileDiff
      key={`${index}:${stash?.ref ?? ''}`}
      files={files}
      sourceFor={(file) => ({ kind: 'stash', index, path: file.path })}
      header={header}
    />
  )
}
