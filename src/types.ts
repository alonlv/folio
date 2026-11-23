import type { PDFDocumentProxy } from 'pdfjs-dist'

export type Source = { name: string; bytes: Uint8Array<ArrayBuffer>; reader: PDFDocumentProxy; dispose: () => Promise<void> }
export type Mark = { id: string; text: string; x: number; y: number; size: number; angle: number; color: string }
export type Sheet = {
  id: string
  source: Source
  index: number
  turn: number
  marks: Mark[]
}
