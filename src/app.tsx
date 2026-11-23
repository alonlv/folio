import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import {
  AlignLeft, ArrowDown, ArrowDownToLine, ArrowDownUp, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, CheckCircle2,
  ChevronDown, ChevronRight, CircleHelp, Clipboard, Copy, FileImage, Files, FileStack, FileText, Grid2X2,
  Image, Layers2, LayoutGrid, List, LoaderCircle, LockKeyhole, Merge, Minimize2, MousePointer2, Plus,
  Redo2, RotateCw, ScanText, Scissors, Settings2, Stamp, Trash2, Type, Undo2, UploadCloud, X, Hash, type LucideIcon,
} from 'lucide-react'
import { MarkEditor, PageTile } from './pages'
import type { Sheet, Source } from './types'
import { usePreferences } from './preferences'
import type { TextDirection } from './bidi'

type View = 'workspace' | 'tools' | 'editor'
type ToolId = 'merge' | 'split' | 'compress' | 'organize' | 'pdf-word' | 'word-pdf' | 'image-pdf' |
  'pdf-image' | 'text' | 'numbers' | 'watermark' | 'edit' | 'ocr'
type Tool = { id: ToolId; title: string; description: string; icon: LucideIcon; tone: string }
const tools: Tool[] = [
  { id: 'merge', title: 'Merge PDF', description: 'Combine multiple PDFs into one file.', icon: Merge, tone: 'mint' },
  { id: 'split', title: 'Split PDF', description: 'Save a range of pages as a new PDF.', icon: Scissors, tone: 'peach' },
  { id: 'compress', title: 'Compress PDF', description: 'Shrink the file size for easier sharing.', icon: Minimize2, tone: 'blue' },
  { id: 'pdf-word', title: 'PDF to Word', description: 'Turn selectable text into an editable DOCX.', icon: FileText, tone: 'lilac' },
  { id: 'ocr', title: 'Scan to text (OCR)', description: 'Recognize Hebrew and English text in scanned pages.', icon: ScanText, tone: 'peach' },
  { id: 'organize', title: 'Organize pages', description: 'Reorder, rotate, duplicate, or delete pages.', icon: Layers2, tone: 'lilac' },
  { id: 'edit', title: 'Add text to PDF', description: 'Place new text anywhere on a PDF page.', icon: Type, tone: 'mint' },
  { id: 'word-pdf', title: 'Word to PDF', description: 'Convert a DOCX and keep its layout.', icon: ArrowDownUp, tone: 'blue' },
  { id: 'image-pdf', title: 'Images to PDF', description: 'Combine JPG and PNG images in one PDF.', icon: Image, tone: 'peach' },
  { id: 'pdf-image', title: 'PDF to PNG', description: 'Download a ZIP with an image of each page.', icon: FileImage, tone: 'mint' },
  { id: 'text', title: 'Extract text', description: 'Save selectable text as a plain text file.', icon: AlignLeft, tone: 'peach' },
  { id: 'numbers', title: 'Page numbers', description: 'Number the pages of a PDF in order.', icon: Hash, tone: 'lilac' },
  { id: 'watermark', title: 'Watermark PDF', description: 'Add a light text watermark on every page.', icon: Stamp, tone: 'blue' },
]
const getTool = (id: ToolId) => tools.find(tool => tool.id === id)!
const toolSuffix: Partial<Record<ToolId, string>> = {
  split: ' - selected pages', compress: ' - compressed', 'pdf-image': ' - images',
  numbers: ' - numbered', watermark: ' - watermarked',
}
const pdfEngine = () => import('./pdf')
const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MAX_PAGES = 300
const MAX_BYTES = 120 * 1024 * 1024
const MB = 1024 * 1024
const extensions = /\.(pdf|docx|png|jpe?g|txt|zip)$/i
const bareName = (value: string) => value.replace(extensions, '')
const filename = (value: string, extension: string) =>
  (bareName(value.trim()).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[ .]+$/g, '').slice(0, 120) || 'Folio document') + '.' + extension
const fileSize = (bytes: number) => bytes >= MB ? (bytes / MB).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB'

type Notice = { kind: 'error' | 'success' | 'info'; message: string }
type History = { past: Sheet[][]; pages: Sheet[]; future: Sheet[][] }

function download(data: Blob | Uint8Array<ArrayBuffer>, name: string, type = 'application/pdf') {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function pageRange(value: string, length: number, t: ReturnType<typeof usePreferences>['t']) {
  const positions = new Set<number>()
  for (const part of value.split(',')) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part.trim())
    if (!match) throw new Error('Enter a range like 1–3, 5 using a hyphen between page numbers.')
    const first = Number(match[1])
    const last = Number(match[2] ?? match[1])
    if (first < 1 || last < first || last > length) throw new Error(t('Choose pages between 1 and {count}.', { count: length }))
    for (let page = first; page <= last; page++) positions.add(page - 1)
  }
  return [...positions]
}

function Modal({ title, icon: Icon, children, onClose, wide = false, busy = false }: {
  title: string; icon: LucideIcon; children: ReactNode; onClose: () => void; wide?: boolean; busy?: boolean
}) {
  const { t } = usePreferences()
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current!
    node.showModal()
    return () => node.close()
  }, [])
  return <dialog className={'modal' + (wide ? ' wide' : '')} ref={dialog} aria-label={title}
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}
    onClick={event => {
      if (event.target !== event.currentTarget || busy) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
    }}>
    <div className="modal-header">
      <div className="modal-title"><span className="tool-icon mint"><Icon size={21} /></span><h2>{title}</h2></div>
      <button type="button" className="icon-button" aria-label={t('Close dialog')} onClick={onClose} disabled={busy}><X size={20} /></button>
    </div>
    {children}
  </dialog>
}

function Hero() {
  const { t } = usePreferences()
  return <section className="hero" aria-labelledby="hero-title">
    <div className="hero-content">
      <h1 id="hero-title">{t('Make PDFs')}<br /><em>{t('work for you.')}</em></h1>
      <p>{t('Merge, organize, and edit your documents in one simple workspace.')}</p>
    </div>
    <div className="hero-art" aria-hidden="true">
      <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
      <div className="art-sheet art-back"><i /><i /><i /></div>
      <div className="art-sheet art-middle"><i /><i /><i /><i /></div>
      <div className="art-sheet art-front">
        <span className="paper-fold" />
        <span className="paper-icon"><FileText size={28} strokeWidth={1.7} /></span>
        <span className="paper-label">PDF</span>
        <i /><i /><i />
      </div>
      <div className="art-float art-check"><CheckCircle2 size={25} strokeWidth={1.7} /></div>
      <div className="art-float art-cursor"><MousePointer2 size={23} strokeWidth={1.8} fill="currentColor" /></div>
      <span className="art-spark sparkle-one">✦</span><span className="art-spark sparkle-two">✧</span>
    </div>
  </section>
}

function ToolCards({ list, onTool }: { list: Tool[]; onTool: (id: ToolId) => void }) {
  const { t } = usePreferences()
  return <div className="tool-grid">
    {list.map(({ id, title, description, icon: Icon, tone }) => <button key={id} type="button" className="tool-card" onClick={() => onTool(id)}>
      <span className={'tool-icon ' + tone}><Icon size={22} strokeWidth={1.8} /></span>
      <ArrowUpRight className="direction-icon tool-arrow" size={17} />
      <strong>{t(title)}</strong><span className="tool-description">{t(description)}</span>
    </button>)}
  </div>
}

export function App() {
  const { language, setLanguage, theme, setTheme, t } = usePreferences()
  const [view, setView] = useState<View>('workspace')
  const [history, setHistory] = useState<History>({ past: [], pages: [], future: [] })
  const { pages, past, future } = history
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [pageView, setPageView] = useState<'grid' | 'list'>('grid')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const [clipboard, setClipboard] = useState<Sheet[]>([])
  const [name, setName] = useState('')
  const [dragging, setDragging] = useState<string>()
  const [dropTarget, setDropTarget] = useState<string>()
  const [fileHover, setFileHover] = useState(false)
  const hoverDepth = useRef(0)
  const [busy, setBusy] = useState('')
  const job = useRef(false)
  const [notice, setNotice] = useState<Notice>()
  const [help, setHelp] = useState(false)
  const [settings, setSettings] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [toolId, setToolId] = useState<ToolId>()
  const [editing, setEditing] = useState<Sheet>()
  const [toolFile, setToolFile] = useState<File>()
  const [toolHover, setToolHover] = useState(false)
  const [toolName, setToolName] = useState('')
  const [range, setRange] = useState('')
  const [level, setLevel] = useState('balanced')
  const [watermark, setWatermark] = useState('')
  const [editorText, setEditorText] = useState('')
  const [textDirection, setTextDirection] = useState<TextDirection>('auto')
  const [ocrLanguage, setOcrLanguage] = useState('both')
  const [editorName, setEditorName] = useState('')
  const sources = useRef(new Set<Source>())
  const filesInput = useRef<HTMLInputElement>(null)
  const imagesInput = useRef<HTMLInputElement>(null)
  const wordInput = useRef<HTMLInputElement>(null)
  const pdfInput = useRef<HTMLInputElement>(null)
  const library = new Set(pages.map(page => page.source))
  const pageGroups = pages.reduce<{ source: Source; items: { sheet: Sheet; index: number }[] }[]>((groups, sheet, index) => {
    let group = groups.at(-1)
    if (!group || group.source !== sheet.source) {
      group = { source: sheet.source, items: [] }
      groups.push(group)
    }
    group.items.push({ sheet, index })
    return groups
  }, [])
  const chosen = pages.filter(page => selected.has(page.id))
  const working = pages.length > 0 || past.length > 0 || future.length > 0 || clipboard.length > 0
  const tool = toolId ? getTool(toolId) : undefined
  const intoEditor = toolId === 'pdf-word' || toolId === 'ocr'
  const pageCount = (count: number) => t(count === 1 ? '{count} page' : '{count} pages', { count })
  const sourceCount = t(library.size === 1 ? '{count} source' : '{count} sources', { count: library.size })
  const toolExt = toolId === 'pdf-image' ? 'zip' : toolId === 'text' ? 'txt' : 'pdf'

  useEffect(() => {
    const referenced = new Set<Source>()
    for (const state of [...history.past, history.pages, ...history.future, clipboard]) {
      for (const page of state) referenced.add(page.source)
    }
    for (const source of sources.current) {
      if (referenced.has(source)) continue
      void source.dispose().catch(() => {})
      sources.current.delete(source)
    }
  }, [history, clipboard])

  function tell(message: string, kind: Notice['kind'] = 'info') {
    setNotice({ message: t(message), kind })
  }

  async function run(label: string, action: () => Promise<void>) {
    if (job.current) return
    job.current = true
    setBusy(t(label))
    setNotice(undefined)
    try {
      await action()
    } catch (error) {
      tell(error instanceof Error ? error.message : 'This operation could not be completed.', 'error')
    } finally {
      setBusy('')
      job.current = false
    }
  }

  function navigate(next: View) {
    setNotice(undefined)
    setView(next)
    window.scrollTo(0, 0)
  }

  function updatePages(next: Sheet[]) {
    setHistory(state => ({ past: [...state.past.slice(-23), state.pages], pages: next, future: [] }))
    const ids = new Set(next.map(page => page.id))
    setSelected(previous => new Set([...previous].filter(id => ids.has(id))))
  }

  function undo() {
    if (busy || !past.length) return
    setHistory({ past: past.slice(0, -1), pages: past[past.length - 1], future: [pages, ...future] })
    setSelected(new Set())
  }

  function redo() {
    if (busy || !future.length) return
    setHistory({ past: [...past, pages], pages: future[0], future: future.slice(1) })
    setSelected(new Set())
  }

  function append(next: Sheet[]) {
    if (next.length > MAX_PAGES) throw new Error('This workspace supports up to 300 pages.')
    const bytes = [...new Set(next.map(page => page.source))].reduce((total, source) => total + source.bytes.length, 0)
    if (bytes > MAX_BYTES) throw new Error('This workspace supports up to 120 MB of source files.')
    next.forEach(page => sources.current.add(page.source))
    updatePages(next)
  }

  function chooseFiles(images = false) {
    if (job.current) return
    navigate('workspace')
    if (images) imagesInput.current?.click()
    else filesInput.current?.click()
  }

  function upload(files: File[]) {
    if (!files.length || job.current) return
    navigate('workspace')
    return run('Opening files…', async () => {
      const engine = await pdfEngine()
      const additions: Sheet[] = []
      const failures: string[] = []
      let bytes = [...library].reduce((total, source) => total + source.bytes.length, 0)
      for (const file of files) {
        if (!/\.(pdf|png|jpe?g)$/i.test(file.name) && !['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) {
          failures.push(t('{name} — choose a PDF, JPG, or PNG.', { name: file.name }))
          continue
        }
        try {
          if (file.size + bytes > MAX_BYTES) throw new Error('The workspace has a 120 MB limit.')
          const source = await engine.sourceForFile(file)
          if (pages.length + additions.length + source.reader.numPages > MAX_PAGES || bytes + source.bytes.length > MAX_BYTES) {
            await source.dispose()
            throw new Error('This file exceeds the workspace limit of 300 pages or 120 MB.')
          }
          bytes += source.bytes.length
          additions.push(...engine.sheetsFor(source))
        } catch (error) {
          failures.push(file.name + ' — ' + t(error instanceof Error ? error.message : 'Could not open this file.'))
        }
      }
      if (additions.length) {
        append([...pages, ...additions])
        setName(current => current || (new Set(additions.map(page => page.source)).size > 1 ? t('Merged document') : bareName(additions[0].source.name)))
      }
      if (failures.length) tell(failures[0] + (failures.length > 1 ? ' ' + t('{count} more file(s) skipped.', { count: failures.length - 1 }) : ''), 'error')
      else tell(t(additions.length === 1 ? '{count} page added.' : '{count} pages added.', { count: additions.length }), 'success')
    })
  }

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    void upload(files)
  }

  function addSample() {
    void run('Opening sample…', async () => {
      if (pages.length > MAX_PAGES - 3) throw new Error('Free up three page slots to add the sample.')
      const engine = await pdfEngine()
      const source = await engine.sampleSource(t)
      try {
        append([...pages, ...engine.sheetsFor(source)])
      } catch (error) {
        await source.dispose()
        throw error
      }
      setName(current => current || t('Folio sample'))
      tell('Sample added. Try dragging a page to reorder it.', 'success')
    })
  }

  function addBlank() {
    void run('Adding blank page…', async () => {
      if (pages.length >= MAX_PAGES) throw new Error('This workspace supports up to 300 pages.')
      const engine = await pdfEngine()
      const source = await engine.blankSource(t('Blank page'))
      try {
        append([...pages, ...engine.sheetsFor(source)])
      } catch (error) {
        await source.dispose()
        throw error
      }
    })
  }

  function move(id: string, index: number) {
    if (busy) return
    const current = pages.findIndex(page => page.id === id)
    if (current < 0 || current === index || index < 0 || index >= pages.length) return
    const next = [...pages]
    const [page] = next.splice(current, 1)
    next.splice(index, 0, page)
    updatePages(next)
  }

  function moveGroup(items: { sheet: Sheet; index: number }[], delta: -1 | 1) {
    if (busy || !items.length) return
    const start = items[0].index
    const end = start + items.length
    if (delta === -1) {
      if (start === 0) return
      const previousSource = pages[start - 1].source
      let previousStart = start - 1
      while (previousStart > 0 && pages[previousStart - 1].source === previousSource) previousStart--
      updatePages([
        ...pages.slice(0, previousStart),
        ...pages.slice(start, end),
        ...pages.slice(previousStart, start),
        ...pages.slice(end),
      ])
      return
    }
    if (end === pages.length) return
    const nextSource = pages[end].source
    let nextEnd = end + 1
    while (nextEnd < pages.length && pages[nextEnd].source === nextSource) nextEnd++
    updatePages([
      ...pages.slice(0, start),
      ...pages.slice(end, nextEnd),
      ...pages.slice(start, end),
      ...pages.slice(nextEnd),
    ])
  }

  function changeSelection(id: string) {
    setSelected(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function copy(cut = false) {
    if (!chosen.length || busy) return
    setClipboard(chosen)
    if (cut) updatePages(pages.filter(page => !selected.has(page.id)))
    const messages = cut
      ? ['{count} page cut. Use Paste to insert them.', '{count} pages cut. Use Paste to insert them.']
      : ['{count} page copied. Use Paste to insert them.', '{count} pages copied. Use Paste to insert them.']
    tell(t(messages[chosen.length === 1 ? 0 : 1], { count: chosen.length }))
  }

  function paste(duplicate = false) {
    const incoming = duplicate ? chosen : clipboard
    if (!incoming.length || busy) return
    const next = [...pages]
    const last = chosen.length ? pages.indexOf(chosen[chosen.length - 1]) : -1
    const copies = incoming.map(page => ({ ...page, id: crypto.randomUUID() }))
    next.splice(last === -1 ? pages.length : last + 1, 0, ...copies)
    try {
      append(next)
      setSelected(new Set(copies.map(page => page.id)))
      const messages = duplicate
        ? ['{count} page duplicated.', '{count} pages duplicated.']
        : ['{count} page pasted.', '{count} pages pasted.']
      tell(t(messages[copies.length === 1 ? 0 : 1], { count: copies.length }), 'success')
    } catch (error) {
      tell((error as Error).message, 'error')
    }
  }

  async function savePdf(part = pages, suffix = '') {
    await run('Creating PDF…', async () => {
      const engine = await pdfEngine()
      const target = filename((bareName(name) || t('Folio document')) + t(suffix), 'pdf')
      download(await engine.assemble(part), target)
      tell(t('Downloaded {name}.', { name: target }), 'success')
    })
  }

  function openTool(id: ToolId) {
    if (busy) return
    if (id === 'image-pdf' || id === 'merge' || id === 'organize' || id === 'edit') {
      navigate('workspace')
      if (id === 'image-pdf' || !pages.length || id === 'merge') chooseFiles(id === 'image-pdf')
      if (id === 'organize' && pages.length) tell('Drag a page or use its arrow buttons to change the order.')
      if (id === 'edit' && pages.length) setEditing(pages[0])
      return
    }
    setNotice(undefined)
    setToolFile(undefined)
    setToolHover(false)
    setRange('')
    setWatermark('')
    setLevel('balanced')
    setToolName(id === 'word-pdf' ? '' : (bareName(name) || t('Folio document')) + t(toolSuffix[id] ?? ''))
    setToolId(id)
  }

  function useToolFile(file: File) {
    if (!toolId || busy) return
    const isWord = toolId === 'word-pdf'
    const supported = isWord
      ? /\.docx$/i.test(file.name) || file.type === docxMime
      : /\.pdf$/i.test(file.name) || file.type === 'application/pdf'
    if (!supported || file.size > (toolId === 'ocr' ? 20 : 60) * MB) {
      tell(toolId === 'ocr' ? 'OCR supports PDFs up to 12 pages and 20 MB.'
        : t('Choose a {format} file up to 60 MB.', { format: isWord ? 'DOCX' : 'PDF' }), 'error')
      return
    }
    setNotice(undefined)
    setToolFile(file)
    setToolName(bareName(file.name) + t(toolSuffix[toolId] ?? ''))
  }

  async function requestConversion(path: string, body: Blob | Uint8Array<ArrayBuffer>, type: string) {
    if ((body instanceof Blob ? body.size : body.length) > 60 * MB) throw new Error('Choose a document up to 60 MB for this tool.')
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': type }, body })
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.error || 'The document could not be processed.')
    }
    return response.blob()
  }

  function useTool() {
    if (!toolId) return
    void run(toolId === 'ocr' ? 'Recognizing scanned text…' : 'Processing document…', async () => {
      const engine = await pdfEngine()
      const target = filename(toolName || t('Folio document'), toolExt)
      let message = t('Downloaded {name}.', { name: target })
      if (toolId === 'word-pdf') {
        if (!toolFile) throw new Error('Choose a Word document to convert.')
        download(await requestConversion('/api/word-to-pdf', toolFile, docxMime), target)
      } else {
        let source: Source | undefined
        try {
          if (toolFile && toolFile.size > engine.maxInput) throw new Error('Choose a file under 60 MB.')
          const needsPages = toolId === 'split' || toolId === 'numbers' || toolId === 'watermark'
          if (toolFile && needsPages) source = await engine.loadSource(new Uint8Array(await toolFile.arrayBuffer()), toolFile.name)
          const inputPages = source ? engine.sheetsFor(source) : pages
          if (!toolFile && !inputPages.length) throw new Error('Choose a PDF or add pages to the workspace first.')
          if (needsPages && inputPages.length > MAX_PAGES) throw new Error('Choose a PDF with up to 300 pages.')
          if (toolId === 'split') {
            const indices = pageRange(range, inputPages.length, t)
            download(await engine.assemble(indices.map(index => inputPages[index])), target)
          } else if (toolId === 'numbers' || toolId === 'watermark') {
            if (toolId === 'watermark' && !watermark.trim()) throw new Error('Enter the watermark text first.')
            download(await engine.assemble(inputPages, { kind: toolId, text: watermark.trim() }), target)
          } else {
            const bytes = toolFile ? new Uint8Array(await toolFile.arrayBuffer()) : await engine.assemble(inputPages)
            if (toolId === 'compress') {
              const result = await requestConversion('/api/compress?level=' + level, bytes, 'application/pdf')
              download(result, target)
              message = result.size < bytes.length
                ? 'Downloaded ' + target + '. ' + fileSize(bytes.length) + ' → ' + fileSize(result.size) + '.'
                : 'This preset could not shrink the PDF. The download keeps the original size.'
            }
            if (toolId === 'ocr') {
              if (bytes.length > 20 * MB) throw new Error('OCR supports PDFs up to 12 pages and 20 MB.')
              const result = await requestConversion('/api/ocr?language=' + ocrLanguage, bytes, 'application/pdf')
              setEditorText(await result.text())
              setEditorName(bareName(toolName))
              setTextDirection('auto')
              setToolId(undefined)
              navigate('editor')
              tell('Scan text is ready to review and edit.', 'success')
              return
            }
            if (toolId === 'pdf-image') download(await engine.pngsFromPdf(bytes), target)
            if (toolId === 'text' || toolId === 'pdf-word') {
              const text = await engine.textFromPdf(bytes)
              if (toolId === 'pdf-word') {
                setEditorText(text)
                setTextDirection('auto')
                setEditorName(bareName(toolName))
                setToolId(undefined)
                navigate('editor')
                tell('Text imported. Edit it below or download it as a Word document.', 'success')
                return
              }
              download(new Blob([text], { type: 'text/plain;charset=UTF-8' }), target)
            }
          }
        } finally {
          await source?.dispose()
        }
      }
      setToolId(undefined)
      tell(message, 'success')
    })
  }

  function loadEditorFile(event: ChangeEvent<HTMLInputElement>, word: boolean) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    void run('Reading document text…', async () => {
      const engine = await pdfEngine()
      if (file.size > engine.maxInput) throw new Error('Choose a file under 60 MB.')
      const imported = word ? await engine.readWord(file) : await engine.textFromPdf(new Uint8Array(await file.arrayBuffer()))
      if (!imported.trim()) throw new Error('This document has no editable text.')
      setEditorText(imported)
      setTextDirection('auto')
      setEditorName(bareName(file.name))
      navigate('editor')
      tell(t('Text imported from {name}.', { name: file.name }), 'success')
    })
  }

  function exportEditor(format: 'docx' | 'pdf') {
    void run('Exporting document…', async () => {
      const engine = await pdfEngine()
      const target = filename(editorName || t('Folio document'), format)
      download(format === 'docx' ? await engine.wordBytes(editorText, textDirection) : await engine.textPdf(editorText, textDirection), target)
      tell(t('Downloaded {name}.', { name: target }), 'success')
    })
  }

  const nav = [
    { id: 'workspace', label: t('Workspace'), icon: LayoutGrid },
    { id: 'tools', label: t('All tools'), icon: Grid2X2 },
    { id: 'editor', label: t('Document editor'), icon: FileText },
  ] as const
  const showNotice = notice && <div className={'notice ' + notice.kind} role={notice.kind === 'error' ? 'alert' : 'status'}>
    {notice.kind === 'success' ? <CheckCircle2 size={18} /> : <CircleHelp size={18} />}
    <span>{notice.message}</span><button type="button" aria-label={t('Dismiss notification')} onClick={() => setNotice(undefined)}><X size={16} /></button>
  </div>
  const busyStatus = busy && <div className="notice info" role="status"><LoaderCircle size={18} className="spin" /><span>{busy}</span></div>

  return <div className="layout"
    onDragEnter={event => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      hoverDepth.current++
      if (!busy && !toolId && !editing && !help && !settings && !confirmClear) setFileHover(true)
    }}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
    onDragLeave={event => {
      if (!event.dataTransfer.types.includes('Files')) return
      hoverDepth.current = Math.max(0, hoverDepth.current - 1)
      if (!hoverDepth.current) setFileHover(false)
    }}
    onDrop={event => {
      if (!event.dataTransfer.types.includes('Files')) return
      event.preventDefault()
      hoverDepth.current = 0
      setFileHover(false)
      if (!toolId && !editing && !help && !settings && !confirmClear) void upload(Array.from(event.dataTransfer.files))
    }}>
    <input ref={filesInput} type="file" accept="application/pdf,.pdf,image/png,image/jpeg" multiple hidden onChange={onFiles} />
    <input ref={imagesInput} type="file" accept="image/png,image/jpeg" multiple hidden onChange={onFiles} />
    <input ref={wordInput} type="file" accept={docxMime + ',.docx'} hidden onChange={event => loadEditorFile(event, true)} />
    <input ref={pdfInput} type="file" accept="application/pdf,.pdf" hidden onChange={event => loadEditorFile(event, false)} />
    <aside className="sidebar">
      <button type="button" className="brand" onClick={() => navigate('workspace')} aria-label={t('Folio home')}>
        <span className="brand-icon"><Layers2 size={24} strokeWidth={2.1} /></span>
        <span dir="ltr">Folio<span className="brand-dot">.</span></span>
      </button>
      <nav aria-label={t('Main navigation')}>
        <span className="nav-label">{t('WORKSPACE')}</span>
        {nav.map(({ id, icon: Icon, label }) => <button className={'nav-item' + (view === id ? ' current' : '')}
          type="button" key={id} aria-current={view === id ? 'page' : undefined} onClick={() => navigate(id)}>
          <Icon size={19} strokeWidth={1.8} /><span>{label}</span>{view === id && <span className="nav-indicator" />}
        </button>)}
        <div className="nav-divider" />
        <div className="quick-nav">
          <span className="nav-label">{t('QUICK TOOLS')}</span>
          {(['merge', 'split', 'compress', 'pdf-word'] as const).map(id => {
            const { icon: Icon, title } = getTool(id)
            return <button type="button" className="nav-item" key={id} disabled={!!busy} onClick={() => openTool(id)}><Icon size={18} strokeWidth={1.8} /><span>{t(title)}</span></button>
          })}
        </div>
      </nav>
      <div className="sidebar-footer">
        <button className="privacy" type="button" onClick={() => setHelp(true)}>
          <LockKeyhole size={17} strokeWidth={1.8} /><span><strong>{t('Privacy by design')}</strong><small>{t('Most tools run in your browser')}</small></span><ChevronRight className="direction-icon" size={15} />
        </button>
      </div>
    </aside>

    <main>
      <header className="topbar">
        <div className="breadcrumbs"><span>Folio</span><ChevronRight className="direction-icon" size={15} /><strong>{nav.find(item => item.id === view)?.label}</strong></div>
        <div className="top-actions">
          <button type="button" className="icon-button settings-button" title={t('Settings')} aria-label={t('Settings')} onClick={() => setSettings(true)}><Settings2 size={19} strokeWidth={1.9} /></button>
          <button type="button" className="icon-button help-button" aria-label={t('Help and privacy')} title={t('Help and privacy')} onClick={() => setHelp(true)}><CircleHelp size={20} strokeWidth={1.85} /></button>
          <button type="button" className="button primary" onClick={() => chooseFiles()} disabled={!!busy}><Plus size={18} /> {t('Add files')}</button>
        </div>
      </header>
      <div className="content">
        {view === 'workspace' && !working && <Hero />}
        {!tool && !editing && (busyStatus || showNotice)}
        {view === 'workspace' && <>
          <section className="workspace">
            <div className="section-heading">
              <div>
                <h2>{t(working ? 'Your pages' : 'Your workspace')}</h2>
                {working && <p>{pageCount(pages.length)} · {sourceCount}</p>}
              </div>
              {!working ? <button type="button" className="text-button" onClick={addSample} disabled={!!busy}>{t('Try a sample')} <ArrowRight className="direction-icon" size={16} /></button>
                : <div className="heading-actions">
                  <button type="button" className="icon-button" title={t('Undo')} aria-label={t('Undo')} disabled={!!busy || !past.length} onClick={undo}><Undo2 className="direction-icon" size={19} /></button>
                  <button type="button" className="icon-button" title={t('Redo')} aria-label={t('Redo')} disabled={!!busy || !future.length} onClick={redo}><Redo2 className="direction-icon" size={19} /></button>
                  <button type="button" className="button secondary" disabled={!!busy} onClick={addBlank}><Plus size={16} /> {t('Blank page')}</button>
                  <button type="button" className="icon-button" disabled={!!busy} title={t('Clear workspace')} aria-label={t('Clear workspace')} onClick={() => setConfirmClear(true)}><Trash2 size={17} /></button>
                </div>}
            </div>
            {!working ? <button type="button" className={'drop-zone' + (fileHover ? ' file-hover' : '')} onClick={() => filesInput.current?.click()} disabled={!!busy}>
              <span className="upload-icon"><UploadCloud size={27} strokeWidth={1.65} /></span>
              <span className="drop-copy"><strong>{t('Drop your files here')}</strong><span>{t('PDF, JPG, or PNG · Up to 60 MB per file')}</span></span>
              <span className="button primary">{t('Browse files')} <ArrowUpRight className="direction-icon" size={16} /></span>
            </button> : <>
              <div className="workspace-panel">
                <div className="selection-toolbar">
                  <button type="button" className={'button subtle' + (chosen.length ? ' green-text' : '')}
                    disabled={!pages.length || !!busy} onClick={() => setSelected(chosen.length ? new Set() : new Set(pages.map(page => page.id)))}>
                    {chosen.length ? t('{count} selected', { count: chosen.length }) : t('Select all')}
                  </button>
                  <span className="toolbar-divider" />
                  <button type="button" className={'button subtle' + (pageView === 'grid' ? ' green-text' : '')}
                    aria-label={t('Grid view')} aria-pressed={pageView === 'grid'} onClick={() => setPageView('grid')}><LayoutGrid size={15} /> {t('Grid')}</button>
                  <button type="button" className={'button subtle' + (pageView === 'list' ? ' green-text' : '')}
                    aria-label={t('List view')} aria-pressed={pageView === 'list'} onClick={() => setPageView('list')}><List size={15} /> {t('List')}</button>
                  <span className="toolbar-divider" />
                  <button type="button" className="button subtle" disabled={!chosen.length || !!busy} onClick={() => copy(true)}><Scissors size={15} /> {t('Cut')}</button>
                  <button type="button" className="button subtle" disabled={!chosen.length || !!busy} onClick={() => copy()}><Copy size={15} /> {t('Copy')}</button>
                  <button type="button" className="button subtle" disabled={!clipboard.length || !!busy} onClick={() => paste()}><Clipboard size={15} /> {t('Paste')}{clipboard.length > 0 ? ' (' + clipboard.length + ')' : ''}</button>
                  <button type="button" className="button subtle" disabled={!chosen.length || !!busy} onClick={() => paste(true)}><Files size={15} /> {t('Duplicate')}</button>
                  <button type="button" className="button subtle" disabled={!chosen.length || !!busy} onClick={() => void savePdf(chosen, ' - extracted')}><ArrowDownToLine size={15} /> {t('Extract')}</button>
                  <button type="button" className="button subtle" disabled={!chosen.length || !!busy}
                    onClick={() => updatePages(pages.map(page => selected.has(page.id) ? { ...page, turn: (page.turn + 90) % 360 } : page))}><RotateCw size={15} /> {t('Rotate')}</button>
                  <button type="button" className="button subtle danger" disabled={!chosen.length || !!busy}
                    onClick={() => updatePages(pages.filter(page => !selected.has(page.id)))}><Trash2 size={15} /> {t('Delete')}</button>
                </div>
                <div className={'page-grid' + (fileHover ? ' file-hover' : '')}>
                  {pageGroups.map((group, groupIndex) => {
                    const allSelected = group.items.every(({ sheet }) => selected.has(sheet.id))
                    const groupId = group.items[0].sheet.id
                    const collapsed = collapsedGroups.has(groupId)
                    return <section className={'page-group' + (collapsed ? ' collapsed' : '')} key={groupId} aria-label={group.source.name}>
                      <div className="page-group-heading">
                        <button type="button" className="page-group-toggle" aria-expanded={!collapsed}
                          aria-label={t(collapsed ? 'Expand PDF set {name}' : 'Collapse PDF set {name}', { name: group.source.name })}
                          onClick={() => setCollapsedGroups(previous => {
                            const next = new Set(previous)
                            if (next.has(groupId)) next.delete(groupId)
                            else next.add(groupId)
                            return next
                          })}>
                          {collapsed ? <ChevronRight size={17} /> : <ChevronDown size={17} />}
                          <span dir="auto">{group.source.name}</span><small>{pageCount(group.items.length)}</small>
                        </button>
                        <div className="page-group-actions">
                          <button type="button" className={'button subtle group-select' + (allSelected ? ' green-text' : '')} disabled={!!busy} aria-pressed={allSelected}
                          aria-label={t('Select pages from {name}', { name: group.source.name })}
                          onClick={() => setSelected(previous => {
                            const next = new Set(previous)
                            for (const { sheet } of group.items) {
                              if (allSelected) next.delete(sheet.id)
                              else next.add(sheet.id)
                            }
                            return next
                          })}>{t(allSelected ? 'Deselect set' : 'Select set')}</button>
                          <button type="button" className="icon-button group-action" title={t('Move set earlier')} aria-label={t('Move set earlier')}
                            disabled={!!busy || groupIndex === 0} onClick={() => moveGroup(group.items, -1)}><ArrowUp size={15} /></button>
                          <button type="button" className="icon-button group-action" title={t('Move set later')} aria-label={t('Move set later')}
                            disabled={!!busy || groupIndex === pageGroups.length - 1} onClick={() => moveGroup(group.items, 1)}><ArrowDown size={15} /></button>
                          <button type="button" className="icon-button group-action" title={t('Rotate set')} aria-label={t('Rotate set')}
                            disabled={!!busy} onClick={() => {
                              const ids = new Set(group.items.map(({ sheet }) => sheet.id))
                              updatePages(pages.map(page => ids.has(page.id) ? { ...page, turn: (page.turn + 90) % 360 } : page))
                            }}><RotateCw size={15} /></button>
                          <button type="button" className="icon-button group-action danger" title={t('Delete set')} aria-label={t('Delete set')}
                            disabled={!!busy} onClick={() => {
                              const ids = new Set(group.items.map(({ sheet }) => sheet.id))
                              updatePages(pages.filter(page => !ids.has(page.id)))
                            }}><Trash2 size={15} /></button>
                        </div>
                      </div>
                      {!collapsed && <div className={'page-group-pages' + (pageView === 'list' ? ' page-list' : '')}>
                        {group.items.map(({ sheet, index }) => <PageTile key={sheet.id} sheet={sheet} index={index} count={pages.length}
                          selected={selected.has(sheet.id)} dragging={dragging === sheet.id} dropTarget={dropTarget === sheet.id && dragging !== sheet.id}
                          onSelect={() => !busy && changeSelection(sheet.id)} onRotate={() => !busy && updatePages(pages.map(page => page.id === sheet.id ? { ...page, turn: (page.turn + 90) % 360 } : page))}
                          onRemove={() => !busy && updatePages(pages.filter(page => page.id !== sheet.id))} onMove={delta => move(sheet.id, index + delta)}
                          onOpen={() => !busy && setEditing(sheet)}
                          onDrag={() => setDragging(sheet.id)} onDragEnd={() => { setDragging(undefined); setDropTarget(undefined) }}
                          onHover={() => setDropTarget(sheet.id)} onDrop={() => { if (dragging) move(dragging, index); setDragging(undefined); setDropTarget(undefined) }} />)}
                      </div>}
                    </section>
                  })}
                  <button className="add-tile" type="button" onClick={() => chooseFiles()} disabled={!!busy}><Plus size={23} /><strong>{t('Add more files')}</strong><span>{t('or drop them here')}</span></button>
                </div>
                <div className="export-bar">
                  <label className="field">{t('Output filename')}<div className="filename-input">
                    <input dir="auto" value={name} onChange={event => setName(event.target.value)} placeholder={t('Folio document')} maxLength={120} /><span dir="ltr">.pdf</span>
                  </div></label>
                  <button type="button" className="button primary" onClick={() => void savePdf()} disabled={!pages.length || !!busy}><ArrowDownToLine size={18} /> {t('Download PDF')}</button>
                </div>
              </div>
            </>}
          </section>
          <section className="tools-section">
            <div className="section-heading"><h2>{t('Popular tools')}</h2><button type="button" className="text-button" onClick={() => navigate('tools')}>{t('View all tools')} <ArrowRight className="direction-icon" size={16} /></button></div>
            <ToolCards list={tools.slice(0, 4)} onTool={openTool} />
          </section>
        </>}

        {view === 'tools' && <section>
          <div className="view-heading"><button className="text-button" type="button" onClick={() => navigate('workspace')}><ArrowLeft className="direction-icon" size={16} /> {t('Workspace')}</button>
            <h1>{t('All tools')}</h1><p>{t('Work with a file directly or use the pages in your workspace.')}</p>
          </div>
          <ToolCards list={tools} onTool={openTool} />
        </section>}

        {view === 'editor' && <section>
          <div className="view-heading"><h1>{t('Document editor')}</h1><p>{t('Write from scratch or import editable text from a PDF or Word document.')}</p></div>
          <div className="editor-panel">
            <div className="editor-toolbar">
              <button type="button" className="button secondary" disabled={!!busy} onClick={() => pdfInput.current?.click()}><FileText size={17} /> {t('Import PDF text')}</button>
              <button type="button" className="button secondary" disabled={!!busy} onClick={() => wordInput.current?.click()}><UploadCloud size={17} /> {t('Import Word text')}</button>
              {pages.length > 0 && <button type="button" className="button subtle" disabled={!!busy} onClick={() => openTool('pdf-word')}><FileStack size={17} /> {t('Use workspace')}</button>}
              <button type="button" className="button subtle" disabled={!!busy} onClick={() => openTool('ocr')}><ScanText size={17} /> {t('Scan to text (OCR)')}</button>
              <label className="field direction-picker">{t('Text direction')}<select value={textDirection} onChange={event => {
                const value = event.target.value
                setTextDirection(value === 'rtl' || value === 'ltr' ? value : 'auto')
              }}>
                <option value="auto">{t('Automatic')}</option><option value="rtl">{t('Right to left')}</option><option value="ltr">{t('Left to right')}</option>
              </select></label>
            </div>
            <label className="editor-paper"><span className="sr-only">{t('Document text')}</span><textarea dir={textDirection} value={editorText} onChange={event => setEditorText(event.target.value)}
              placeholder={t('Start typing here…')} spellCheck maxLength={500000} /></label>
            <div className="editor-hint">{t('Text imports use a simple editable layout. For a layout-preserving Word conversion, use Word to PDF.')}</div>
            <div className="export-bar editor-export">
              <label className="field">{t('Output filename')}<input dir="auto" placeholder={t('Folio document')} value={editorName} onChange={event => setEditorName(event.target.value)} maxLength={120} /></label>
              <div className="heading-actions">
                <button type="button" className="button secondary" disabled={!!busy || !editorText.trim()} onClick={() => exportEditor('pdf')}><ArrowDownToLine size={17} /> {t('Download PDF')}</button>
                <button type="button" className="button primary" disabled={!!busy || !editorText.trim()} onClick={() => exportEditor('docx')}><ArrowDownToLine size={17} /> {t('Download Word')}</button>
              </div>
            </div>
          </div>
        </section>}

        <footer className="footer"><span>{t('Folio PDF workspace')}</span><button type="button" onClick={() => setHelp(true)}><LockKeyhole size={14} /> {t('File privacy')}</button></footer>
      </div>
    </main>

    {settings && <Modal title={t('Settings')} icon={Settings2} onClose={() => setSettings(false)}>
      <div className="modal-body tool-form">
        <fieldset className="language-field">
          <legend className="field-label">{t('Language')}</legend>
          <div className="language-options">
            <button type="button" className={'button secondary language-option' + (language === 'en' ? ' green-text' : '')}
              aria-label={t('English')} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>
              <span aria-hidden="true">🇺🇸</span>{t('English')}
            </button>
            <button type="button" className={'button secondary language-option' + (language === 'he' ? ' green-text' : '')}
              aria-label={t('Hebrew')} aria-pressed={language === 'he'} onClick={() => setLanguage('he')}>
              <span aria-hidden="true">🇮🇱</span>{t('Hebrew')}
            </button>
          </div>
        </fieldset>
        <label className="field">{t('Appearance')}<select value={theme} onChange={event => {
          const value = event.target.value
          setTheme(value === 'light' || value === 'dark' ? value : 'system')
        }}>
          <option value="system">{t('System')}</option><option value="light">{t('Light')}</option><option value="dark">{t('Dark')}</option>
        </select></label>
      </div>
      <div className="modal-actions"><button type="button" className="button primary" onClick={() => setSettings(false)}>{t('Done')}</button></div>
    </Modal>}

    {help && <Modal title={t('Help & privacy')} icon={LockKeyhole} onClose={() => setHelp(false)}>
      <div className="modal-body help-content">
        <h3>{t('Work with pages')}</h3><p>{t('Drop in PDFs or images. Drag pages or use their arrow buttons to rearrange them. Select pages to cut, copy, duplicate, or extract. Paste inserts after the last selected page, or at the end.')}</p>
        <h3>{t('Edit a document')}</h3><p>{t('Open any page to add text over its original content. Use the document editor to rewrite selectable text and export a new Word or PDF file.')}</p>
        <h3>{t('Where files are processed')}</h3><p>{t('Most tools process files in your browser. Compression, Word to PDF, and OCR use this Folio server and remove temporary files after processing. Workspace changes are held in memory until you download them.')}</p>
      </div>
    </Modal>}

    {confirmClear && <Modal title={t('Clear workspace?')} icon={Trash2} onClose={() => setConfirmClear(false)}>
      <div className="modal-body"><p>{t('This will remove all workspace pages, page edits, and copied pages. Download a copy first if you want to keep your work.')}</p></div>
      <div className="modal-actions">
        <button className="button secondary" type="button" onClick={() => setConfirmClear(false)}>{t('Cancel')}</button>
        <button className="button primary" type="button" onClick={() => {
          setHistory({ past: [], pages: [], future: [] })
          setSelected(new Set())
          setClipboard([])
          setName('')
          setConfirmClear(false)
          tell('Workspace cleared.', 'success')
        }}>{t('Clear pages')}</button>
      </div>
    </Modal>}

    {editing && <Modal title={t('Edit page {number}', { number: pages.findIndex(page => page.id === editing.id) + 1 })} icon={Type} wide onClose={() => setEditing(undefined)}>
      <MarkEditor key={editing.id} sheet={editing} onChange={marks => setEditing({ ...editing, marks })} />
      <div className="modal-actions"><button className="button secondary" type="button" onClick={() => setEditing(undefined)}>{t('Cancel')}</button>
        <button className="button primary" type="button" onClick={() => {
          const cleaned = editing.marks.filter(mark => mark.text.trim())
          updatePages(pages.map(page => page.id === editing.id ? { ...editing, marks: cleaned } : page))
          setEditing(undefined)
        }}>{t('Apply text edits')}</button></div>
    </Modal>}

    {tool && <Modal title={t(tool.title)} icon={tool.icon} onClose={() => { setToolId(undefined); setNotice(undefined) }} busy={!!busy}>
      <form onSubmit={event => { event.preventDefault(); useTool() }}>
        <div className="modal-body tool-form">
          <p>{t(tool.description)}</p>
          {toolId !== 'word-pdf' && pages.length > 0 && !toolFile && <div className="tool-source"><FileStack size={17} /> {t('Using workspace · {pages}', { pages: pageCount(pages.length) })}</div>}
          <div className="field">
            <span>{t(toolId === 'word-pdf' ? 'Word file' : pages.length ? 'Or choose a PDF' : 'PDF file')}</span>
            <label className={'file-picker' + (toolHover ? ' over' : '')} onDragOver={event => {
              if (busy || !event.dataTransfer.types.includes('Files')) return
              event.preventDefault()
              setToolHover(true)
            }} onDragLeave={() => setToolHover(false)} onDrop={event => {
              event.preventDefault()
              setToolHover(false)
              const [file] = event.dataTransfer.files
              if (file) useToolFile(file)
            }}>
              <input type="file" className="sr-only" accept={toolId === 'word-pdf' ? docxMime + ',.docx' : 'application/pdf,.pdf'}
                disabled={!!busy} onChange={event => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) useToolFile(file)
                }} />
              <UploadCloud size={18} /> {t(toolFile ? 'Replace file' : 'Drop a file here or browse')}
            </label>
          </div>
          {toolFile && <div className="tool-source"><FileText size={16} /><bdi>{toolFile.name}</bdi>
            <button type="button" className="text-button" disabled={!!busy} onClick={() => setToolFile(undefined)}>{t('Remove')}</button></div>}
          {toolId === 'split' && <label className="field">{t('Page range')}<input dir="ltr" value={range} required placeholder="1-3, 5" onChange={event => setRange(event.target.value)} />
            <small>{t('Enter single pages and ranges in the order you want them.')}</small></label>}
          {toolId === 'compress' && <label className="field">{t('Compression level')}<select value={level} onChange={event => setLevel(event.target.value)}>
            <option value="light">{t('Light · higher quality')}</option><option value="balanced">{t('Balanced · everyday use')}</option><option value="strong">{t('Strong · smallest file')}</option>
          </select><small>{t('Compression can reduce image quality. Compare the result before sharing.')}</small></label>}
          {toolId === 'ocr' && <label className="field">{t('OCR language')}<select value={ocrLanguage} onChange={event => setOcrLanguage(event.target.value)}>
            <option value="both">{t('Hebrew and English')}</option><option value="he" lang="he">עברית</option><option value="en" lang="en">English</option>
          </select><small>{t('Up to 12 pages and 20 MB. Add JPG or PNG scans to the workspace to use them here.')}</small></label>}
          {toolId === 'watermark' && <label className="field">{t('Watermark text')}<input dir="auto" value={watermark} required placeholder={t('DRAFT')} maxLength={120} onChange={event => setWatermark(event.target.value)} /></label>}
          {intoEditor ? <label className="field">{t('Document name')}<input dir="auto" value={toolName} onChange={event => setToolName(event.target.value)} maxLength={120} />
            <small>{t(toolId === 'ocr' ? 'Recognition can take a moment. Review the results before exporting.' : 'Selectable text opens in the editor for DOCX or PDF export.')}</small></label>
            : <label className="field">{t('Output filename')}<div className="filename-input"><input dir="auto" value={toolName} onChange={event => setToolName(event.target.value)} placeholder={t('Folio document')} maxLength={120} /><span dir="ltr">.{toolExt}</span></div></label>}
          {busyStatus || showNotice}
        </div>
        <div className="modal-actions"><button type="button" className="button secondary" disabled={!!busy} onClick={() => { setToolId(undefined); setNotice(undefined) }}>{t('Cancel')}</button>
          <button type="submit" className="button primary" disabled={!!busy || (!toolFile && (toolId === 'word-pdf' || !pages.length))}>
            {toolId === 'ocr' ? <><ScanText size={16} /> {t('Recognize text')}</>
              : toolId === 'pdf-word' ? <><Type size={16} /> {t('Open in editor')}</>
              : <><ArrowDownToLine size={17} /> {t('Download {format}', { format: toolExt.toUpperCase() })}</>}</button>
        </div>
      </form>
    </Modal>}
  </div>
}
