import type { HighlightReply, HighlightRequest, Token } from './highlight-protocol'
import { languageOf } from './languages'

export type { Token }

// Past this size a file is shown without colors: tokenizing it would cost more than it helps.
const MAX_HIGHLIGHT_BYTES = 512 * 1024

let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, (lines: Token[][] | null) => void>()
const cache = new Map<string, Promise<Token[][] | null>>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<HighlightReply>) => {
      pending.get(event.data.id)?.(event.data.lines)
      pending.delete(event.data.id)
    }
  }
  return worker
}

/** Highlighted lines of a whole file, or null when its language is unknown or it is too big. */
export function highlightFile(path: string, text: string): Promise<Token[][] | null> {
  const language = languageOf(path)
  if (!language || text.length > MAX_HIGHLIGHT_BYTES) return Promise.resolve(null)
  const key = `${language}\u0000${text}`
  let result = cache.get(key)
  if (!result) {
    const { promise, resolve } = Promise.withResolvers<Token[][] | null>()
    const id = nextId++
    pending.set(id, resolve)
    const request: HighlightRequest = { id, language, text }
    getWorker().postMessage(request)
    result = promise
    cache.set(key, result)
    // A handful of files is enough: the person moves between a few at a time.
    if (cache.size > 24) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
  }
  return result
}
