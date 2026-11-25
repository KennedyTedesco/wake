import { hueOf, initials } from '../lib/format'

/** Initials on a color picked from the name: plugin frames cannot load remote avatars. */
export function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar" style={{ '--hue': hueOf(name) } as React.CSSProperties} aria-hidden>
      {initials(name)}
    </span>
  )
}
