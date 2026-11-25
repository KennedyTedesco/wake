import { describe, expect, it } from 'vitest'
import { pasteFrame } from './review'

describe('pasteFrame', () => {
  it('frames the text as one bracketed paste with carriage returns', () => {
    expect(pasteFrame('File: a.ts\nLine: 3\r\nok')).toBe(
      '\u001b[200~File: a.ts\rLine: 3\rok\u001b[201~'
    )
  })

  it('cannot be closed early by an escape inside a note', () => {
    const framed = pasteFrame('before\u001b[201~rm -rf ~\n')
    expect(framed.indexOf('\u001b[201~')).toBe(framed.length - '\u001b[201~'.length)
    expect(framed).toContain('␛[201~rm -rf ~')
  })
})
