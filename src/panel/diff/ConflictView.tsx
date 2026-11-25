import { Check, ExternalLink, GitMerge } from 'lucide-react'
import type { FileDiff } from '../../shared/model'
import { run } from '../state/store'
import { splitLines } from './rows'

type Props = { path: string; diff: Extract<FileDiff, { kind: 'conflicted' }> }

type Region = 'plain' | 'ours' | 'base' | 'theirs' | 'marker'

/** Which side of a conflict each line belongs to, read from the markers git wrote. */
function regions(lines: string[]): Region[] {
  let region: Region = 'plain'
  return lines.map((line) => {
    if (line.startsWith('<<<<<<<')) {
      region = 'ours'
      return 'marker'
    }
    if (line.startsWith('|||||||') && region === 'ours') {
      region = 'base'
      return 'marker'
    }
    if (line.startsWith('=======') && region !== 'plain') {
      region = 'theirs'
      return 'marker'
    }
    if (line.startsWith('>>>>>>>') && region === 'theirs') {
      region = 'plain'
      return 'marker'
    }
    return region
  })
}

export function ConflictView({ path, diff }: Props) {
  const lines = diff.text === null ? [] : splitLines(diff.text).slice(0, 5000)
  const marks = regions(lines)
  const conflicts = lines.filter((line) => line.startsWith('<<<<<<<')).length
  const resolve = (using: 'ours' | 'theirs' | 'working') =>
    run(
      'conflict.resolve',
      { path, using },
      { title: 'Could not resolve the conflict', success: `${path} resolved` }
    )

  return (
    <div className="conflict">
      <div className="conflict-bar">
        <GitMerge size={16} />
        <div className="conflict-summary">
          <strong>
            {conflicts > 0
              ? `${conflicts} conflict${conflicts === 1 ? '' : 's'} in this file`
              : 'No conflict markers left'}
          </strong>
          <span className="muted">Keep one side, or edit the file and mark it resolved.</span>
        </div>
        <div className="conflict-actions">
          <button type="button" className="button" onClick={() => void resolve('ours')}>
            Use {diff.ours}
          </button>
          <button type="button" className="button" onClick={() => void resolve('theirs')}>
            Use {diff.theirs}
          </button>
          <button
            type="button"
            className="button"
            onClick={() =>
              void run('workspace.openFile', { path }, { title: 'Could not open the file' })
            }
          >
            <ExternalLink size={13} /> Open in editor
          </button>
          <button
            type="button"
            className="button"
            data-variant="primary"
            onClick={() => void resolve('working')}
          >
            <Check size={13} /> Mark as resolved
          </button>
        </div>
      </div>
      {diff.text === null ? (
        <p className="diff-message">
          The file is missing from the working tree or too large to show.
        </p>
      ) : (
        <div className="conflict-text">
          {lines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines of one file, in order
            <div key={index} className="cl" data-region={marks[index]}>
              <span className="ln">{index + 1}</span>
              <span className="code">{line || ' '}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
