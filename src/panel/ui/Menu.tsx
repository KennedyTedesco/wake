import type { LucideIcon } from 'lucide-react'
import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { create } from 'zustand'

export type MenuItem =
  | {
      label: string
      icon?: LucideIcon
      hint?: string
      destructive?: boolean
      disabled?: boolean
      onSelect: () => void
    }
  | { separator: true }

type OpenMenu = { x: number; y: number; items: MenuItem[]; minWidth?: number }

const useMenuStore = create<{ menu: OpenMenu | null }>(() => ({ menu: null }))

export function openMenuAt(x: number, y: number, items: MenuItem[], minWidth?: number): void {
  useMenuStore.setState({ menu: { x, y, items, ...(minWidth ? { minWidth } : {}) } })
}

/** For `onContextMenu`: opens the menu at the pointer. */
export function contextMenu(items: MenuItem[] | (() => MenuItem[])) {
  return (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    openMenuAt(event.clientX, event.clientY, typeof items === 'function' ? items() : items)
  }
}

/** Opens the menu under an element, such as a button with a chevron. */
export function openMenuBelow(element: HTMLElement, items: MenuItem[]): void {
  const box = element.getBoundingClientRect()
  openMenuAt(box.left, box.bottom + 4, items, box.width)
}

function closeMenu() {
  useMenuStore.setState({ menu: null })
}

export function MenuHost() {
  const menu = useMenuStore((state) => state.menu)
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const [active, setActive] = useState(-1)

  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPosition(null)
      return
    }
    const box = ref.current.getBoundingClientRect()
    const left = Math.max(4, Math.min(menu.x, window.innerWidth - box.width - 4))
    const top =
      menu.y + box.height > window.innerHeight - 4 ? Math.max(4, menu.y - box.height) : menu.y
    setPosition({ left, top })
    setActive(-1)
    ref.current.focus()
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const close = () => closeMenu()
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  if (!menu) return null
  const selectable = menu.items.flatMap((item, index) =>
    'separator' in item || item.disabled ? [] : [index]
  )

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const at = selectable.indexOf(active)
      const step = event.key === 'ArrowDown' ? 1 : -1
      const next = selectable[(at + step + selectable.length) % selectable.length]
      if (next !== undefined) setActive(next)
    } else if (event.key === 'Enter' || event.key === ' ') {
      const item = menu.items[active]
      if (item && !('separator' in item)) {
        event.preventDefault()
        closeMenu()
        item.onSelect()
      }
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop only catches clicks outside; Escape closes the menu
    <div
      className="menu-backdrop"
      onMouseDown={closeMenu}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        ref={ref}
        className="menu"
        role="menu"
        tabIndex={-1}
        style={{
          left: position?.left ?? menu.x,
          top: position?.top ?? menu.y,
          minWidth: menu.minWidth,
          visibility: position ? 'visible' : 'hidden'
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {menu.items.map((item, index) => {
          if ('separator' in item)
            // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity but their position
            return <div key={`s${index}`} className="menu-separator" role="separator" />
          const Icon = item.icon
          return (
            <button
              type="button"
              key={item.label}
              role="menuitem"
              className="menu-item"
              data-active={index === active || undefined}
              data-destructive={item.destructive || undefined}
              disabled={item.disabled}
              onMouseEnter={() => setActive(index)}
              onClick={() => {
                closeMenu()
                item.onSelect()
              }}
            >
              <span className="menu-icon">{Icon ? <Icon size={14} /> : null}</span>
              <span className="menu-label">{item.label}</span>
              {item.hint ? <span className="menu-hint">{item.hint}</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
