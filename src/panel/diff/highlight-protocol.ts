/** `[text, light color, dark color, font style bits (1 italic, 2 bold, 4 underline)]`. */
export type Token = [string, string, string, number]

export type HighlightRequest = { id: number; language: string; text: string }
export type HighlightReply = { id: number; lines: Token[][] | null }
