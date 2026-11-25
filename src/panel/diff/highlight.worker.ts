// Syntax highlighting off the main thread: a large file never stalls scrolling or typing.
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import type { HighlightReply, HighlightRequest, Token } from './highlight-protocol'
import { LANGUAGE_LOADERS } from './languages'

const THEMES = { light: 'github-light-default', dark: 'github-dark-default' } as const

let highlighter: Promise<HighlighterCore> | null = null
const loaded = new Map<string, Promise<boolean>>()

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [
      import('shiki/themes/github-light-default.mjs'),
      import('shiki/themes/github-dark-default.mjs')
    ],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true })
  })
  return highlighter
}

function ensureLanguage(core: HighlighterCore, language: string): Promise<boolean> {
  let pending = loaded.get(language)
  if (!pending) {
    const loader = LANGUAGE_LOADERS[language]
    pending = loader
      ? loader().then(
          async (module) => {
            await core.loadLanguage(...module.default)
            return true
          },
          () => false
        )
      : Promise.resolve(false)
    loaded.set(language, pending)
  }
  return pending
}

async function highlight({ language, text }: HighlightRequest): Promise<Token[][] | null> {
  const core = await getHighlighter()
  if (!(await ensureLanguage(core, language))) return null
  const lines = core.codeToTokensWithThemes(text, { lang: language, themes: THEMES })
  return lines.map((line) =>
    line.map((token): Token => {
      const light = token.variants.light
      const dark = token.variants.dark
      return [token.content, light?.color ?? '', dark?.color ?? '', light?.fontStyle ?? 0]
    })
  )
}

self.onmessage = async (event: MessageEvent<HighlightRequest>) => {
  const request = event.data
  let lines: Token[][] | null = null
  try {
    lines = await highlight(request)
  } catch {
    lines = null
  }
  const reply: HighlightReply = { id: request.id, lines }
  self.postMessage(reply)
}
