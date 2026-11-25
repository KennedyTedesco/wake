import { Copy, MoreHorizontal } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import type { RepoSnapshot } from '../../shared/model'
import { copyText } from '../lib/clipboard'
import { fullDate, plural, timeAgo } from '../lib/format'
import { toast, useStore } from '../state/store'
import { Avatar } from '../ui/Avatar'
import { openMenuBelow } from '../ui/Menu'
import { commitMenu } from './HistoryList'
import { MultiFileDiff } from './MultiFileDiff'

// Trailers such as Co-authored-by already show as names under the title.
const TRAILER = /^[A-Za-z][\w-]*: .+$/

function messageBody(body: string): string {
  const lines = body.trim().split('\n')
  while (lines.length > 0 && TRAILER.test(lines.at(-1) ?? '')) lines.pop()
  return lines.join('\n').trim()
}

export function CommitView({ repo, leading }: { repo: RepoSnapshot; leading: ReactNode }) {
  const history = useStore((state) => state.history)
  const [expanded, setExpanded] = useState(false)
  const details = history.details?.commit.sha === history.selectedSha ? history.details : null

  if (!history.selectedSha) {
    return (
      <div className="no-changes">
        <p className="muted">
          {history.loading ? 'Loading history…' : 'Select a commit to see its changes.'}
        </p>
      </div>
    )
  }
  if (!details) {
    return (
      <div className="browser">
        <div className="detail-head">{leading}</div>
        <div className="diff-message">
          <span className="spinner" />
        </div>
      </div>
    )
  }

  const { commit, files, coAuthors } = details
  const body = messageBody(commit.body)

  const header = (
    <div className="commit-head">
      <div className="commit-head-top">
        {leading}
        <h2 className="commit-title">{commit.summary || '(no message)'}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Commit actions"
          onClick={(event) => openMenuBelow(event.currentTarget, commitMenu(commit, repo))}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
      {body ? (
        <div className="commit-body" data-expanded={expanded || undefined}>
          <pre>{body}</pre>
          {body.split('\n').length > 4 ? (
            <button
              type="button"
              className="link-button"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="commit-facts">
        <span className="commit-author">
          <Avatar name={commit.authorName} />
          <span>
            <strong>{commit.authorName}</strong>
            {coAuthors.length > 0 ? ` and ${plural(coAuthors.length, 'co-author')}` : ''}
          </span>
        </span>
        <span title={fullDate(commit.authorDate)}>{timeAgo(commit.authorDate)}</span>
        <button
          type="button"
          className="sha"
          title="Copy the full SHA"
          onClick={() => copyText(commit.sha) && toast('SHA copied')}
        >
          {commit.shortSha}
          <Copy size={11} />
        </button>
        {commit.parents.length > 1 ? <span className="tag">merge</span> : null}
        {commit.unpushed ? (
          <span className="tag" data-tone="accent">
            not pushed
          </span>
        ) : null}
      </div>
    </div>
  )

  return (
    <MultiFileDiff
      key={commit.sha}
      files={files}
      sourceFor={(file) => ({
        kind: 'commit',
        sha: commit.sha,
        file: { path: file.path, ...(file.oldPath ? { oldPath: file.oldPath } : {}) }
      })}
      header={header}
    />
  )
}
