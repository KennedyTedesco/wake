// Turns a flat list of changed files into folders, the way GitHub's file tree shows a pull
// request: folders first, names in order, and a chain of single folders folded into one row.
import type { ChangedFile } from '../../shared/model'

export type TreeNode<F extends ChangedFile> =
  | { kind: 'dir'; name: string; path: string; children: TreeNode<F>[] }
  | { kind: 'file'; name: string; file: F }

type MutableDir<F extends ChangedFile> = {
  name: string
  path: string
  dirs: Map<string, MutableDir<F>>
  files: F[]
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

function freeze<F extends ChangedFile>(dir: MutableDir<F>): TreeNode<F>[] {
  const dirs = [...dir.dirs.values()]
    .sort((a, b) => collator.compare(a.name, b.name))
    .map((child) => {
      // A folder whose only content is one folder reads as one path: `src/panel/diff`.
      let current = child
      let name = child.name
      while (current.files.length === 0 && current.dirs.size === 1) {
        const only = [...current.dirs.values()][0]
        if (!only) break
        name = `${name}/${only.name}`
        current = only
      }
      return { kind: 'dir' as const, name, path: current.path, children: freeze(current) }
    })
  const files = [...dir.files]
    .sort((a, b) => collator.compare(a.path, b.path))
    .map((file) => ({
      kind: 'file' as const,
      name: file.path.slice(file.path.lastIndexOf('/') + 1),
      file
    }))
  return [...dirs, ...files]
}

export function buildTree<F extends ChangedFile>(files: readonly F[]): TreeNode<F>[] {
  const root: MutableDir<F> = { name: '', path: '', dirs: new Map(), files: [] }
  for (const file of files) {
    const parts = file.path.split('/')
    parts.pop()
    let dir = root
    for (const part of parts) {
      let next = dir.dirs.get(part)
      if (!next) {
        next = {
          name: part,
          path: dir.path ? `${dir.path}/${part}` : part,
          dirs: new Map(),
          files: []
        }
        dir.dirs.set(part, next)
      }
      dir = next
    }
    dir.files.push(file)
  }
  return freeze(root)
}

/** The files in the order the tree shows them, so the diffs read top to bottom like the tree. */
export function treeOrder<F extends ChangedFile>(nodes: readonly TreeNode<F>[]): F[] {
  return nodes.flatMap((node) => (node.kind === 'file' ? [node.file] : treeOrder(node.children)))
}

/** One line of a tree drawn as a list: a folder with every file under it, or a file. */
export type TreeRow<F extends ChangedFile> =
  | { kind: 'dir'; name: string; path: string; depth: number; files: F[]; open: boolean }
  | { kind: 'file'; name: string; file: F; depth: number }

/** The rows a tree shows with some folders closed, top to bottom, for a virtualized list. */
export function visibleRows<F extends ChangedFile>(
  nodes: readonly TreeNode<F>[],
  closed: ReadonlySet<string>,
  depth = 0
): TreeRow<F>[] {
  return nodes.flatMap((node): TreeRow<F>[] => {
    if (node.kind === 'file') return [{ kind: 'file', name: node.name, file: node.file, depth }]
    const open = !closed.has(node.path)
    const row: TreeRow<F> = {
      kind: 'dir',
      name: node.name,
      path: node.path,
      depth,
      files: treeOrder(node.children),
      open
    }
    return open ? [row, ...visibleRows(node.children, closed, depth + 1)] : [row]
  })
}

/** Files whose path holds every word of the query, in any case. */
export function filterFiles<F extends ChangedFile>(files: readonly F[], query: string): F[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...files]
  return files.filter((file) => {
    const path = `${file.oldPath ?? ''} ${file.path}`.toLowerCase()
    return words.every((word) => path.includes(word))
  })
}
