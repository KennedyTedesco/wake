import type { RemoteInfo } from '../../shared/model'

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60]
]

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' })

export function timeAgo(epochMs: number, now = Date.now()): string {
  const seconds = Math.round((epochMs - now) / 1000)
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

const absolute = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

export function fullDate(epochMs: number): string {
  return absolute.format(epochMs)
}

export function splitPath(path: string): { dir: string; name: string } {
  const slash = path.lastIndexOf('/')
  return slash < 0
    ? { dir: '', name: path }
    : { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) }
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? '?'
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}

/** A stable hue for a name, so one author keeps one avatar color. */
export function hueOf(text: string): number {
  let hash = 0
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0
  return Math.abs(hash) % 360
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function commitUrl(remote: RemoteInfo, sha: string): string | null {
  if (!remote.webUrl) return null
  return remote.host === 'bitbucket'
    ? `${remote.webUrl}/commits/${sha}`
    : remote.host === 'gitlab'
      ? `${remote.webUrl}/-/commit/${sha}`
      : `${remote.webUrl}/commit/${sha}`
}

/** Where to open a pull (or merge) request for `branch`, or null for an unknown host. */
export function pullRequestUrl(remote: RemoteInfo, branch: string): string | null {
  if (!remote.webUrl) return null
  const name = encodeURIComponent(branch)
  switch (remote.host) {
    case 'github':
      return `${remote.webUrl}/compare/${name}?expand=1`
    case 'gitlab':
      return `${remote.webUrl}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${name}`
    case 'bitbucket':
      return `${remote.webUrl}/pull-requests/new?source=${name}`
    case 'other':
      return null
  }
}

export function hostLabel(remote: RemoteInfo): string {
  switch (remote.host) {
    case 'github':
      return 'GitHub'
    case 'gitlab':
      return 'GitLab'
    case 'bitbucket':
      return 'Bitbucket'
    case 'other':
      return remote.name
  }
}
