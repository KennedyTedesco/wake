import { describe, expect, it } from 'vitest'
import type { ChangedFile } from '../../shared/model'
import { buildTree, filterFiles, type TreeNode, treeOrder, visibleRows } from './fileTree'

const file = (path: string, kind: ChangedFile['kind'] = 'modified'): ChangedFile => ({ path, kind })

function outline(nodes: TreeNode<ChangedFile>[], depth = 0): string[] {
  return nodes.flatMap((node) =>
    node.kind === 'file'
      ? [`${'  '.repeat(depth)}${node.name}`]
      : [`${'  '.repeat(depth)}${node.name}/`, ...outline(node.children, depth + 1)]
  )
}

describe('buildTree', () => {
  it('puts folders first and folds single-folder chains', () => {
    const tree = buildTree([
      file('README.md'),
      file('src/panel/diff/rows.ts'),
      file('src/panel/diff/align.ts'),
      file('src/worker/main.ts'),
      file('docs/guide/setup/intro.md')
    ])
    expect(outline(tree)).toEqual([
      'docs/guide/setup/',
      '  intro.md',
      'src/',
      '  panel/diff/',
      '    align.ts',
      '    rows.ts',
      '  worker/',
      '    main.ts',
      'README.md'
    ])
  })

  it('orders files as the tree shows them', () => {
    const order = treeOrder(buildTree([file('z.ts'), file('a/b.ts'), file('a/a.ts')])).map(
      (f) => f.path
    )
    expect(order).toEqual(['a/a.ts', 'a/b.ts', 'z.ts'])
  })
})

describe('visibleRows', () => {
  it('hides the contents of a closed folder and keeps its files for the folder checkbox', () => {
    const tree = buildTree([file('src/a.ts'), file('src/b.ts'), file('README.md')])
    const rows = visibleRows(tree, new Set(['src']))
    expect(rows.map((row) => (row.kind === 'dir' ? `${row.name}/` : row.name))).toEqual([
      'src/',
      'README.md'
    ])
    const folder = rows[0]
    expect(folder?.kind === 'dir' && folder.files.map((f) => f.path)).toEqual([
      'src/a.ts',
      'src/b.ts'
    ])
  })
})

describe('filterFiles', () => {
  it('keeps files that match every word', () => {
    const files = [
      file('src/panel/App.tsx'),
      file('src/worker/main.ts'),
      file('test/worker/sync.test.ts')
    ]
    expect(filterFiles(files, 'worker ts').map((f) => f.path)).toEqual([
      'src/worker/main.ts',
      'test/worker/sync.test.ts'
    ])
    expect(filterFiles(files, '  ')).toHaveLength(3)
  })
})
