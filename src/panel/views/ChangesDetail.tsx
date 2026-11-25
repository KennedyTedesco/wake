import {
  ArrowDown,
  ArrowUp,
  CloudUpload,
  ExternalLink,
  GitPullRequest,
  PartyPopper
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import type { ChangedFile, RepoSnapshot, Stash } from '../../shared/model'
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

function NoChanges({ repo }: { repo: RepoSnapshot }) {
  const upstream = repo.head.kind === 'branch' ? repo.head.upstream : null
  const branch = repo.head.kind === 'branch' ? repo.head.name : null
  const remote = repo.remote
  const prUrl = remote && branch && upstream ? pullRequestUrl(remote, branch) : null
  const remoteName = remote?.name ?? 'origin'
  const hasSuggestions =
    (upstream !== null && (upstream.ahead > 0 || upstream.behind > 0)) ||
    (remote !== null && branch !== null && upstream === null) ||
    prUrl !== null ||
    Boolean(remote?.webUrl)

  if (repo.files.length > 0) {
    return (
      <div className="no-changes">
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
