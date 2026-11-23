import makeBidi from 'bidi-js'

export type TextDirection = 'auto' | 'ltr' | 'rtl'
const bidi = makeBidi()
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const controls = /\p{Bidi_Control}/gu
const hasRtl = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\u200f\u202b\u202e\u2067]/u

export function textRuns(text: string, direction: TextDirection = 'auto') {
  if (direction !== 'rtl' && !hasRtl.test(text)) {
    const runs = [{ text: text.replace(controls, ''), rtl: false, rendered: text.replace(controls, '') }]
    return { rtl: false, runs, order: [0] }
  }

  const embedding = bidi.getEmbeddingLevels(text, direction)
  const rtl = (embedding.paragraphs[0]?.level ?? (direction === 'rtl' ? 1 : 0)) % 2 === 1
  const mirrors = bidi.getMirroredCharactersMap(text, embedding.levels)
  const runs: { text: string; rtl: boolean; rendered: string }[] = []
  const runByIndex: number[] = []
  let start = 0
  while (start < text.length) {
    const level = embedding.levels[start]
    let end = start + 1
    while (end < text.length && embedding.levels[end] === level) end++
    const content = text.slice(start, end).replace(controls, '')
    const rightToLeft = level % 2 === 1
    let rendered = ''
    for (let i = start; i < end; i++) {
      runByIndex[i] = runs.length
      rendered += mirrors.get(i) ?? text[i]
    }
    rendered = rendered.replace(controls, '')
    // Fontkit shapes Hebrew runs in visual order. A run made entirely of
    // neutrals has no script to detect, so reverse those graphemes here.
    if (rightToLeft && !hasRtl.test(rendered)) {
      rendered = [...graphemes.segment(rendered)].reverse().map(item => item.segment).join('')
    }
    runs.push({ text: content, rtl: rightToLeft, rendered })
    start = end
  }

  const order = [...new Set(bidi.getReorderedIndices(text, embedding).map(index => runByIndex[index]))]
  return { rtl, runs, order }
}
