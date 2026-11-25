import type { FileChangeKind } from '../../shared/model'

const BADGE: Record<FileChangeKind, { letter: string; label: string }> = {
  modified: { letter: 'M', label: 'Modified' },
  added: { letter: 'A', label: 'Added' },
  untracked: { letter: 'U', label: 'New, untracked' },
  deleted: { letter: 'D', label: 'Deleted' },
  renamed: { letter: 'R', label: 'Renamed' },
  copied: { letter: 'C', label: 'Copied' },
  conflicted: { letter: '!', label: 'Conflicted' },
  typechange: { letter: 'T', label: 'Type changed' }
}

export function FileStatus({ kind }: { kind: FileChangeKind }) {
  const badge = BADGE[kind]
  return (
    <span
      className="status"
      data-kind={kind}
      title={badge.label}
      role="img"
      aria-label={badge.label}
    >
      {badge.letter}
    </span>
  )
}
