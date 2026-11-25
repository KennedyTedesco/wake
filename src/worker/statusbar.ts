// The `branch` status bar item: the branch, what there is to push or pull, and how many files
// changed.
import type { RepoState } from '../shared/model'

export type StatusBarView = {
  text: string
  tooltip: string
  tone: 'neutral' | 'accent' | 'warning'
  visible: boolean
}

const OPEN = 'Open Wake'

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

export function statusBarView(state: RepoState): StatusBarView {
  if (state.kind !== 'ready') return { text: 'Git', tooltip: OPEN, tone: 'neutral', visible: false }
  const { head, files, operation } = state.repo
  const name = head.kind === 'detached' ? head.sha.slice(0, 7) : head.name
  const upstream = head.kind === 'branch' ? head.upstream : null
  const ahead = upstream?.ahead ?? 0
  const behind = upstream?.behind ?? 0
  const conflicts = files.filter((file) => file.kind === 'conflicted').length

  let text = name
  if (ahead) text += ` ↑${ahead}`
  if (behind) text += ` ↓${behind}`
  if (files.length) text += ` •${files.length}`

  const parts = [head.kind === 'detached' ? `Detached at ${name}` : name]
  if (operation) parts.push(`${operation} in progress`)
  if (conflicts) parts.push(plural(conflicts, 'conflict', 'conflicts'))
  if (ahead) parts.push(`${ahead} to push`)
  if (behind) parts.push(`${behind} to pull`)
  if (files.length) parts.push(plural(files.length, 'changed file', 'changed files'))

  const tone = operation || conflicts ? 'warning' : ahead || behind ? 'accent' : 'neutral'
  return { text, tooltip: `${parts.join(' · ')} — ${OPEN}`, tone, visible: true }
}
