import { useEffect, useState } from 'react'
import type { ChangedFile, FileDiff } from '../../shared/model'
import { request } from '../lib/bridge'
import { highlightFile, type Token } from './highlighter'

export type DiffSource =
  | { kind: 'working'; file: ChangedFile }
  | { kind: 'commit'; sha: string; file: Pick<ChangedFile, 'path' | 'oldPath'> }
  | { kind: 'stash'; index: number; path: string }

export type DiffLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; diff: FileDiff }

export function sourcePath(source: DiffSource): string {
  return source.kind === 'stash' ? source.path : source.file.path
}

function sourceKey(source: DiffSource): string {
  switch (source.kind) {
    case 'working':
      return `w:${source.file.kind}:${source.file.oldPath ?? ''}:${source.file.path}`
    case 'commit':
      return `c:${source.sha}:${source.file.path}`
    case 'stash':
      return `s:${source.index}:${source.path}`
  }
}

function fetchDiff(source: DiffSource, ignoreWhitespace: boolean): Promise<FileDiff> {
  switch (source.kind) {
    case 'working':
      return request('diff.working', { file: source.file, ignoreWhitespace })
    case 'commit':
      return request('diff.commit', { sha: source.sha, file: source.file, ignoreWhitespace })
    case 'stash':
      return request('diff.stash', { index: source.index, path: source.path })
  }
}

/**
 * Loads a file's diff. `revision` reloads it when the working tree changed; the previous diff
 * stays on screen while the new one loads, so the view never flashes.
 */
export function useDiff(source: DiffSource, revision: number, ignoreWhitespace: boolean): DiffLoad {
  const key = sourceKey(source)
  const [state, setState] = useState<{ key: string; load: DiffLoad }>({
    key,
    load: { status: 'loading' }
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` identifies `source`
  useEffect(() => {
    let current = true
    fetchDiff(source, ignoreWhitespace).then(
      (diff) => {
        if (current) setState({ key, load: { status: 'ready', diff } })
      },
      (error: unknown) => {
        if (current) {
          setState({
            key,
            load: {
              status: 'error',
              message: error instanceof Error ? error.message : String(error)
            }
          })
        }
      }
    )
    return () => {
      current = false
    }
  }, [key, revision, ignoreWhitespace])

  return state.key === key ? state.load : { status: 'loading' }
}

export type Highlights = { old: Token[][] | null; new: Token[][] | null }

export function useHighlights(
  path: string,
  oldText: string | null,
  newText: string | null
): Highlights {
  const [highlights, setHighlights] = useState<Highlights>({ old: null, new: null })
  useEffect(() => {
    let current = true
    setHighlights({ old: null, new: null })
    Promise.all([
      oldText === null ? null : highlightFile(path, oldText),
      newText === null ? null : highlightFile(path, newText)
    ]).then(([oldLines, newLines]) => {
      if (current) setHighlights({ old: oldLines, new: newLines })
    })
    return () => {
      current = false
    }
  }, [path, oldText, newText])
  return highlights
}
