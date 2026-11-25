import { type CSSProperties, memo } from 'react'
import type { Token } from './highlighter'
import type { Range } from './intraline'

type Props = {
  text: string
  tokens: Token[] | undefined
  /** Changed words, drawn stronger than the rest of the line. */
  ranges: Range[] | undefined
}

type Segment = { text: string; token: Token | null; changed: boolean }

/** Tokens are only trusted when they spell the same text: `-w` diffs and CRLF files can differ. */
function matchingTokens(text: string, tokens: Token[] | undefined): Token[] | null {
  if (!tokens) return null
  let joined = ''
  for (const token of tokens) joined += token[0]
  return joined === text || `${joined}\r` === text ? tokens : null
}

function segments(text: string, tokens: Token[] | null, ranges: Range[]): Segment[] {
  const base: { text: string; token: Token | null }[] = tokens
    ? tokens.map((token) => ({ text: token[0], token }))
    : [{ text, token: null }]
  if (ranges.length === 0) return base.map((part) => ({ ...part, changed: false }))

  // Cut the tokens at every range edge, then mark the pieces inside a range.
  const out: Segment[] = []
  let at = 0
  let range = 0
  for (const part of base) {
    let offset = 0
    while (offset < part.text.length) {
      const position = at + offset
      while (range < ranges.length && (ranges[range]?.[1] ?? 0) <= position) range++
      const current = ranges[range]
      const inside = current !== undefined && current[0] <= position
      const edge =
        current === undefined ? Number.POSITIVE_INFINITY : inside ? current[1] : current[0]
      const end = Math.min(part.text.length, edge - at)
      out.push({ text: part.text.slice(offset, end), token: part.token, changed: inside })
      offset = end
    }
    at += part.text.length
  }
  return out
}

function tokenStyle(token: Token): CSSProperties {
  const style: Record<string, string> = { '--l': token[1], '--d': token[2] }
  if (token[3] & 1) style.fontStyle = 'italic'
  if (token[3] & 2) style.fontWeight = '600'
  if (token[3] & 4) style.textDecoration = 'underline'
  return style
}

export const Code = memo(function Code({ text, tokens, ranges }: Props) {
  if (text.length === 0) return <span className="code"> </span>
  const parts = segments(text, matchingTokens(text, tokens), ranges ?? [])
  return (
    <span className="code">
      {parts.map((part, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
          key={index}
          className={
            part.token
              ? part.changed
                ? 'tok changed'
                : 'tok'
              : part.changed
                ? 'changed'
                : undefined
          }
          style={part.token ? tokenStyle(part.token) : undefined}
        >
          {part.text}
        </span>
      ))}
    </span>
  )
})
