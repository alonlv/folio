import { getDocument, GlobalWorkerOptions, type PDFPageProxy } from 'pdfjs-dist'
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  PDFArray, PDFDocument, PDFHexString, PDFName, PDFOperator, PDFOperatorNames, PDFRawStream, decodePDFRawStream,
  degrees, drawText, endMarkedContent, rgb, type Color, type PDFPage, type PDFFont,
} from 'pdf-lib'
import type { Mark, Sheet, Source } from './types'
import { textRuns, type TextDirection } from './bidi'

GlobalWorkerOptions.workerSrc = worker
const base = import.meta.env.BASE_URL
const assets = base + 'pdfjs/'
export const maxInput = 60 * 1024 * 1024

export async function loadSource(bytes: Uint8Array<ArrayBuffer>, name: string): Promise<Source> {
  return (await readSource(bytes, name)).source
}

async function readSource(bytes: Uint8Array<ArrayBuffer>, name: string) {
  const task = getDocument({
    data: bytes.slice(),
    cMapUrl: assets + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: assets + 'standard_fonts/',
    wasmUrl: assets + 'wasm/',
    iccUrl: assets + 'iccs/',
    enableXfa: false,
  })
  try {
    const reader = await task.promise
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    const source = { name, bytes, reader, dispose: () => task.destroy() }
    return { source, doc }
  } catch (error) {
    await task.destroy()
    if (error instanceof Error && /password|encrypted/i.test(error.message)) {
      throw new Error('Unlock this password-protected PDF before adding it.')
    }
    throw new Error('This PDF could not be read. Check that it opens in a PDF reader.')
  }
}

export function sheetsFor(source: Source): Sheet[] {
  return Array.from({ length: source.reader.numPages }, (_, index) => ({
    id: crypto.randomUUID(), source, index, turn: 0, marks: [],
  }))
}

export async function sourceForFile(file: File): Promise<Source> {
  if (file.size > maxInput) throw new Error('Choose a file under 60 MB.')
  const data = new Uint8Array(await file.arrayBuffer())
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return loadSource(data, file.name)
  const pdf = await PDFDocument.create()
  const image = /\.png$/i.test(file.name) || file.type === 'image/png'
    ? await pdf.embedPng(data)
    : await pdf.embedJpg(data)
  const scale = Math.min(1, 1200 / Math.max(image.width, image.height))
  const width = image.width * scale
  const height = image.height * scale
  pdf.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height })
  return loadSource(new Uint8Array(await pdf.save()), file.name)
}

let fontData: Promise<ArrayBuffer> | undefined

async function getFont(pdf: PDFDocument) {
  fontData ??= fetch(base + 'pdf-text.ttf').then(response => {
    if (!response.ok) throw new Error('The PDF export font could not be loaded.')
    return response.arrayBuffer()
  }).catch(error => {
    fontData = undefined
    throw error
  })
  const [{ default: fontkit }, bytes] = await Promise.all([import('@pdf-lib/fontkit'), fontData])
  pdf.registerFontkit(fontkit)
  return pdf.embedFont(bytes, { subset: true })
}

export const angleOf = (angle: number) => ((angle % 360) + 360) % 360

function ink(hex: string) {
  const [red, green, blue] = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255)
  return rgb(red, green, blue)
}

type LineOptions = {
  x: number; y: number; size: number; font: PDFFont; angle?: number; color?: Color; opacity?: number; endOfLine?: boolean
}
type LineLayout = ReturnType<typeof textRuns>
const textSpan = 'FolioText'
const lineSpan = 'FolioLine'

function measureLine(layout: LineLayout, font: PDFFont, size: number) {
  return layout.runs.reduce((total, run) => total + font.widthOfTextAtSize(run.rendered, size), 0)
}

function drawLine(page: PDFPage, layout: LineLayout, options: LineOptions, alignment: 'start' | 'center' = 'start') {
  const { x, y, font, size, angle = 0, color = rgb(0, 0, 0), opacity, endOfLine } = options
  const width = measureLine(layout, font, size)
  const offset = alignment === 'center' ? -width / 2 : layout.rtl ? -width : 0
  const radians = angle * Math.PI / 180
  const origin = { x: x + Math.cos(radians) * offset, y: y + Math.sin(radians) * offset }
  if (!layout.rtl && layout.runs.length === 1) {
    page.drawText(layout.runs[0].rendered, { ...origin, size, font, color, opacity, rotate: degrees(angle) })
    return
  }

  // Emit one continuous glyph sequence in visual order and retain the
  // original logical text as the PDF replacement text for this span.
  const glyphs = layout.order.map(index => font.encodeText(layout.runs[index].rendered).asString()).join('')
  const logicalText = layout.runs.map(run => run.text).join('')
  const { context } = page.doc
  const resource = page.node.newFontDictionary(font.name, font.ref)
  const graphicsState = opacity === undefined ? undefined
    : page.node.newExtGState('GS', context.obj({ Type: 'ExtGState', ca: opacity }))
  page.pushOperators(
    PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
      PDFName.of(endOfLine ? lineSpan : textSpan), context.obj({ ActualText: PDFHexString.fromText(logicalText) }).toString(),
    ]),
    ...drawText(PDFHexString.of(glyphs), {
      ...origin, size, font: resource, rotate: degrees(angle), xSkew: degrees(0), ySkew: degrees(0),
      color, graphicsState,
    }),
    endMarkedContent(),
  )
}

function drawMark(page: PDFPage, mark: Mark, font: PDFFont) {
  drawLine(page, textRuns(mark.text), {
    x: mark.x, y: mark.y, size: mark.size, angle: mark.angle,
    color: ink(mark.color), font,
  })
}

type Stamp = { kind: 'numbers' | 'watermark'; text?: string }

export async function assemble(sheets: Sheet[], stamp?: Stamp) {
  if (!sheets.length) throw new Error('Add a page before exporting.')
  const original = sheets[0].source
  if (!stamp && sheets.length === original.reader.numPages &&
      sheets.every((sheet, index) => sheet.source === original && sheet.index === index && !sheet.turn && !sheet.marks.length)) {
    return original.bytes
  }

  const result = await PDFDocument.create()
  const font = stamp || sheets.some(sheet => sheet.marks.length) ? await getFont(result) : undefined
  const groups = new Map<Source, number[]>()
  sheets.forEach((sheet, index) => {
    if (!groups.has(sheet.source)) groups.set(sheet.source, [])
    groups.get(sheet.source)!.push(index)
  })
  const ordered: PDFPage[] = []
  for (const [source, positions] of groups) {
    const template = await PDFDocument.load(source.bytes, { updateMetadata: false })
    const copies = await result.copyPages(template, positions.map(index => sheets[index].index))
    copies.forEach((page, index) => { ordered[positions[index]] = page })
  }
  for (const [index, page] of ordered.entries()) {
    const sheet = sheets[index]
    const angle = angleOf(page.getRotation().angle + sheet.turn)
    page.setRotation(degrees(angle))
    result.addPage(page)
    if (!font) continue
    sheet.marks.forEach(mark => drawMark(page, mark, font))
    if (!stamp) continue
    const proxy = await sheet.source.reader.getPage(sheet.index + 1)
    const viewport = proxy.getViewport({ scale: 1, rotation: angle })
    const text = stamp.kind === 'numbers' ? String(index + 1) : stamp.text!.replace(/[\r\n]/g, ' ')
    const layout = textRuns(text)
    const idealSize = stamp.kind === 'numbers' ? 11 : 34
    const size = Math.min(idealSize, idealSize * viewport.width * 0.85 / (measureLine(layout, font, idealSize) || 1))
    const [x, y] = viewport.convertToPdfPoint(viewport.width / 2,
      stamp.kind === 'numbers' ? viewport.height - Math.min(24, viewport.height / 8) : viewport.height / 2)
    drawLine(page, layout, {
      x, y, size: size / proxy.userUnit, angle, font,
      color: rgb(0.19, 0.30, 0.25), opacity: stamp.kind === 'numbers' ? 1 : 0.32,
    }, 'center')
  }
  return new Uint8Array(await result.save())
}

export async function blankSource(name: string) {
  const pdf = await PDFDocument.create()
  pdf.addPage([595.28, 841.89])
  return loadSource(new Uint8Array(await pdf.save()), name)
}

export async function sampleSource(t: (message: string) => string) {
  const pdf = await PDFDocument.create()
  const font = await getFont(pdf)
  const titles = ['The field guide', 'Project notes', 'Next steps']
  const subtitles = ['A sample document for your Folio workspace', 'Good ideas start on paper.', 'Make this document your own.']
  for (const [index, title] of titles.entries()) {
    const page = pdf.addPage([595.28, 841.89])
    page.drawRectangle({ x: 0, y: 607, width: 595.28, height: 235, color: rgb(0.87, 0.94, 0.90) })
    const sampleLine = (message: string, y: number, size: number, color: ReturnType<typeof rgb>) => {
      const layout = textRuns(t(message))
      drawLine(page, layout, { x: layout.rtl ? 543 : 52, y, size, color, font })
    }
    sampleLine('FOLIO STUDIO   /   SAMPLE PDF', 783, 11, rgb(0.13, 0.34, 0.26))
    sampleLine(title, 688, 45, rgb(0.09, 0.18, 0.14))
    sampleLine(subtitles[index], 647, 15, rgb(0.20, 0.38, 0.30))
    const instructions = ['Drag a page to change its order.', 'Select pages to copy, cut, or extract them.', 'Open a page to place new text anywhere.']
    sampleLine(instructions[index], 550, 15, rgb(0.13, 0.26, 0.20))
    for (let row = 0; row < 8; row++) {
      page.drawRectangle({ x: 54, y: 500 - 31 * row, width: 440 - (row % 3) * 60, height: 1, color: rgb(0.84, 0.89, 0.86) })
    }
    page.drawText(String(index + 1), { x: 54, y: 45, size: 12, font })
  }
  return loadSource(new Uint8Array(await pdf.save()), t('Folio sample') + '.pdf')
}

function exportedText(page: PDFPage, expected: number) {
  if (!expected) return []
  try {
    const contents = page.node.Contents()
    const streams = contents instanceof PDFArray ? contents.asArray().map(item => page.doc.context.lookup(item)) : [contents]
    const decoder = new TextDecoder('latin1')
    const markers = /\/Folio(?:Text|Line)\s*<<\s*\/ActualText\s*<([0-9a-f]+)>\s*>>\s*BDC/gi
    const text = streams.flatMap(stream => stream instanceof PDFRawStream
      ? [...decoder.decode(decodePDFRawStream(stream).decode()).matchAll(markers)].map(match => PDFHexString.of(match[1]).decodeText())
      : [])
    return text.length === expected ? text : []
  } catch {
    return []
  }
}

type TextItems = Awaited<ReturnType<PDFPageProxy['getTextContent']>>['items']

function extractPageText(items: TextItems, page: PDFPage) {
  const isFolioSpan = (item: TextItems[number]) =>
    !('str' in item) && 'tag' in item && (item.tag === textSpan || item.tag === lineSpan)
  const replacements = exportedText(page, items.filter(isFolioSpan).length)
  let replacement = 0
  let inSpan = false
  let endOfLine = false
  const parts: string[] = []
  const append = (text: string, newline: boolean) => {
    if (text || !parts.at(-1)?.endsWith('\n')) parts.push(text + (newline ? '\n' : ' '))
  }
  for (const item of items) {
    if (replacements.length && isFolioSpan(item)) {
      inSpan = true
      endOfLine = 'tag' in item && item.tag === lineSpan
    } else if ('str' in item) {
      if (inSpan) endOfLine ||= item.hasEOL
      else append(item.str, item.hasEOL)
    } else if (inSpan && item.type === 'endMarkedContent') {
      append(replacements[replacement++], endOfLine)
      inSpan = false
    }
  }
  return parts.join('').replace(/[ \t]+(?=\n)/g, '').trim()
}

export async function textFromPdf(bytes: Uint8Array<ArrayBuffer>) {
  const { source, doc } = await readSource(bytes, 'Text export.pdf')
  try {
    const pages = []
    for (let index = 1; index <= source.reader.numPages; index++) {
      const page = await source.reader.getPage(index)
      const { items } = await page.getTextContent({ includeMarkedContent: true })
      pages.push(extractPageText(items, doc.getPage(index - 1)))
    }
    const content = pages.filter(Boolean).join('\n\n')
    if (!content) throw new Error('This PDF has no selectable text. Scanned pages need OCR before text can be exported.')
    return content
  } finally {
    await source.dispose()
  }
}

export async function pngsFromPdf(bytes: Uint8Array<ArrayBuffer>) {
  const { default: JSZip } = await import('jszip')
  const source = await loadSource(bytes, 'Image export.pdf')
  try {
    if (source.reader.numPages > 100) throw new Error('Export up to 100 pages at a time as images.')
    const zip = new JSZip()
    for (let index = 1; index <= source.reader.numPages; index++) {
      const page = await source.reader.getPage(index)
      const full = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(2, 1800 / Math.max(full.width, full.height)) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvas, viewport }).promise
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(result => result ? resolve(result) : reject(new Error('Could not create a page image.')), 'image/png')
      })
      zip.file('page-' + String(index).padStart(3, '0') + '.png', blob)
      canvas.width = canvas.height = 0
      page.cleanup()
    }
    return zip.generateAsync({ type: 'blob' })
  } finally {
    await source.dispose()
  }
}

export async function readWord(file: File) {
  if (file.size > maxInput) throw new Error('Choose a file under 60 MB.')
  const { extractRawText } = await import('mammoth')
  const result = await extractRawText({ arrayBuffer: await file.arrayBuffer() })
  return result.value.trim()
}

const lines = (text: string) => text.replace(/\r\n?/g, '\n').split('\n')

export async function wordBytes(text: string, direction: TextDirection) {
  const { Document, Packer, Paragraph, TextRun } = await import('docx')
  const paragraphs = lines(text).map(line => {
    const layout = textRuns(line, direction)
    return new Paragraph({
      bidirectional: layout.rtl,
      children: layout.runs.map(run => new TextRun({
        text: run.text, rightToLeft: run.rtl || undefined,
        language: run.rtl ? { bidirectional: 'he-IL' } : undefined,
      })),
    })
  })
  return Packer.toBlob(new Document({ sections: [{ children: paragraphs }] }))
}

export async function textPdf(text: string, direction: TextDirection) {
  const doc = await PDFDocument.create()
  const font = await getFont(doc)
  const size = 12
  const width = 595.28
  const height = 841.89
  const margin = 56
  const maxWidth = width - 2 * margin
  let page = doc.addPage([width, height])
  let y = height - margin
  const putLine = (line: string, baseDirection: 'ltr' | 'rtl') => {
    if (y < margin) {
      page = doc.addPage([width, height])
      y = height - margin
    }
    if (line) {
      const layout = textRuns(line, baseDirection)
      drawLine(page, layout, { x: layout.rtl ? width - margin : margin, y, size, font, endOfLine: true })
    }
    y -= 18
  }
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  for (const original of lines(text)) {
    const baseDirection = textRuns(original, direction).rtl ? 'rtl' : 'ltr'
    let current = ''
    for (const word of original.match(/\S+\s*|\s+/g) ?? []) {
      if (current && font.widthOfTextAtSize(current + word, size) > maxWidth) {
        putLine(current.trimEnd(), baseDirection)
        current = ''
      }
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        for (const { segment: letter } of segmenter.segment(word)) {
          if (font.widthOfTextAtSize(current + letter, size) > maxWidth) {
            putLine(current, baseDirection)
            current = ''
          }
          current += letter
        }
      } else current += word
    }
    putLine(current.trimEnd(), baseDirection)
  }
  return new Uint8Array(await doc.save())
}
