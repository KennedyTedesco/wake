// Stands in for Orca's frame API when the panel runs in `pnpm preview`: requests go to the real
// worker that scripts/browser-host.ts runs inside the dev server. Never part of the plugin build.
const API = '/__wake'

type Listener = (payload: unknown) => void
const listeners = new Map<string, Set<Listener>>()

new EventSource(`${API}/events`).onmessage = (message) => {
  const { event, payload } = JSON.parse(message.data)
  for (const listener of listeners.get(event) ?? []) listener(payload)
}

// Orca's own dark defaults, so the preview looks like the panel inside Orca; light uses the
// stylesheet's fallbacks.
const THEMES: Record<'dark' | 'light', Record<string, string>> = {
  dark: {
    '--orca-background': '#0a0a0a',
    '--orca-foreground': '#ededed',
    '--orca-card': '#111111',
    '--orca-popover': '#161616',
    '--orca-popover-foreground': '#ededed',
    '--orca-muted-foreground': '#8f8f8f',
    '--orca-border': '#262626',
    '--orca-input': '#2e2e2e',
    '--orca-primary': '#ededed',
    '--orca-primary-foreground': '#0a0a0a'
  },
  light: {}
}

const dark = matchMedia('(prefers-color-scheme: dark)')
const applyScheme = () => {
  const root = document.documentElement
  root.classList.toggle('dark', dark.matches)
  root.classList.toggle('light', !dark.matches)
  for (const name of Object.keys(THEMES.dark)) root.style.removeProperty(name)
  for (const [name, value] of Object.entries(dark.matches ? THEMES.dark : THEMES.light)) {
    root.style.setProperty(name, value)
  }
}
applyScheme()
dark.addEventListener('change', applyScheme)
const preview = {
  api: { major: 1, minor: 10 },
  locale: navigator.language,
  plugin: {
    async request(name: string, input?: unknown) {
      const response = await fetch(`${API}/request`, {
        method: 'POST',
        body: JSON.stringify({ name, input: input ?? {} })
      })
      const body = await response.json()
      if (!response.ok) throw Object.assign(new Error(body.message), { code: body.code })
      return body.output
    },
    on(event: string, listener: Listener) {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
      return { dispose: () => set.delete(listener) }
    }
  },
  on: () => ({ dispose() {} }),
  shell: {
    async openExternal(url: string) {
      window.open(url, '_blank', 'noopener')
      return { opened: true }
    }
  }
}

Object.assign(globalThis, { orca: preview })

export {}
