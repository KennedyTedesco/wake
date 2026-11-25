import { splitPath } from '../lib/format'

/** File name first, its folder after it in muted text: the name stays readable when space runs out. */
export function PathLabel({ path, oldPath }: { path: string; oldPath?: string | undefined }) {
  const { dir, name } = splitPath(path)
  return (
    <span className="path-label">
      <span className="path-name">{name}</span>
      {dir || oldPath ? (
        <span className="path-dir">{oldPath ? `from ${oldPath}` : dir.slice(0, -1)}</span>
      ) : null}
    </span>
  )
}
