import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { PageViewport, RenderTask } from 'pdfjs-dist'
import { ArrowLeft, ArrowRight, Check, GripVertical, Maximize2, Plus, RotateCw, Trash2, Type } from 'lucide-react'
import type { Mark, Sheet } from './types'
import { usePreferences } from './preferences'

type Geometry = { viewport: PageViewport; scale: number }

export function PageCanvas({ sheet, width, eager = false, onGeometry }: {
  sheet: Sheet; width: number; eager?: boolean; onGeometry?: (geometry: Geometry) => void
}) {
  const { t } = usePreferences()
  const target = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(eager)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (visible || !target.current) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '200px' })
    observer.observe(target.current)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    const canvas = target.current
    if (!canvas || !visible) return
    let active = true
    let render: RenderTask | undefined
    setFailed(false)
    void (async () => {
      try {
        const page = await sheet.source.reader.getPage(sheet.index + 1)
        if (!active) return
        const angle = ((page.rotate + sheet.turn) % 360 + 360) % 360
        const original = page.getViewport({ scale: 1, rotation: angle })
        const viewScale = Math.min(width / original.width, width * 1.45 / original.height)
        const viewport = page.getViewport({ scale: viewScale, rotation: angle })
        const pixelRatio = Math.min(2, window.devicePixelRatio || 1)
        canvas.width = Math.ceil(viewport.width * pixelRatio)
        canvas.height = Math.ceil(viewport.height * pixelRatio)
        canvas.style.aspectRatio = viewport.width + ' / ' + viewport.height
        canvas.style.width = viewport.width + 'px'
        render = page.render({ canvas, viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] })
        await render.promise
        if (active) onGeometry?.({ viewport, scale: viewScale * page.userUnit })
      } catch {
        if (active) setFailed(true)
      }
    })()
    return () => {
      active = false
      render?.cancel()
    }
  }, [sheet.source, sheet.index, sheet.turn, width, visible, onGeometry])

  return <>
    <canvas ref={target} className="pdf-canvas" aria-hidden="true" hidden={failed} />
    {failed && <span className="canvas-error">{t('Preview unavailable')}</span>}
  </>
}

export function PageTile({ sheet, index, count, selected, dragging, dropTarget, onSelect, onRotate, onRemove,
  onMove, onOpen, onDrag, onDragEnd, onHover, onDrop }: {
  sheet: Sheet; index: number; count: number; selected: boolean; dragging: boolean; dropTarget: boolean
  onSelect: () => void; onRotate: () => void; onRemove: () => void; onMove: (delta: number) => void; onOpen: () => void
  onDrag: () => void; onDragEnd: () => void; onHover: () => void; onDrop: () => void
}) {
  const { t } = usePreferences()
  const number = index + 1
  return <article className={['page-tile', selected && 'selected', dragging && 'dragging', dropTarget && 'drop-target'].filter(Boolean).join(' ')}
    draggable onDragStart={event => {
      event.dataTransfer.setData('text/x-folio-page', sheet.id)
      event.dataTransfer.effectAllowed = 'move'
      onDrag()
    }} onDragEnd={onDragEnd}
    onDragOver={event => {
      if (!event.dataTransfer.types.includes('text/x-folio-page')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      onHover()
    }}
    onDrop={event => {
      if (!event.dataTransfer.types.includes('text/x-folio-page')) return
      event.preventDefault()
      onDrop()
    }}>
    <div className="tile-top">
      <button className="page-check" type="button" aria-pressed={selected} aria-label={t('Select page {number}', { number })} onClick={onSelect}>{selected && <Check size={13} />}</button>
      <span className="tile-grip" title={t('Drag to reorder')}><GripVertical size={17} /></span>
    </div>
    <button className="tile-preview" type="button" onClick={onOpen} aria-label={t('Open page {number}', { number })}>
      <PageCanvas sheet={sheet} width={142} />
      <span className="tile-expand"><Maximize2 size={15} /></span>
    </button>
    <div className="tile-details">
      <strong>{t('Page {number}', { number })}{sheet.marks.length > 0 && <Type size={13} aria-label={t('Has text edits')} />}</strong>
      <span dir="auto" title={sheet.source.name}>{sheet.source.name}</span>
    </div>
    <div className="tile-actions">
      <button type="button" title={t('Move earlier')} aria-label={t('Move page {number} earlier', { number })} onClick={() => onMove(-1)} disabled={index === 0}><ArrowLeft className="direction-icon" size={15} /></button>
      <button type="button" title={t('Move later')} aria-label={t('Move page {number} later', { number })} onClick={() => onMove(1)} disabled={index === count - 1}><ArrowRight className="direction-icon" size={15} /></button>
      <button type="button" title={t('Rotate clockwise')} aria-label={t('Rotate page {number}', { number })} onClick={onRotate}><RotateCw size={15} /></button>
      <button type="button" title={t('Remove page')} aria-label={t('Remove page {number}', { number })} onClick={onRemove}><Trash2 size={15} /></button>
    </div>
  </article>
}

export function MarkEditor({ sheet, onChange }: { sheet: Sheet; onChange: (marks: Mark[]) => void }) {
  const { t, language } = usePreferences()
  const [geometry, setGeometry] = useState<Geometry>()
  const [activeId, setActiveId] = useState<string>()
  const [placing, setPlacing] = useState(false)
  const mark = sheet.marks.find(item => item.id === activeId)

  function update(changes: Partial<Mark>) {
    onChange(sheet.marks.map(item => item.id === activeId ? { ...item, ...changes } : item))
  }

  function placeAt(relativeX: number, relativeY: number) {
    if (!geometry) return
    const { viewport, scale } = geometry
    const [x, y] = viewport.convertToPdfPoint(relativeX * viewport.width, relativeY * viewport.height)
    const id = crypto.randomUUID()
    onChange([...sheet.marks, { id, text: t('New text'), x, y, angle: viewport.rotation, size: 16 * viewport.scale / scale, color: '#16362a' }])
    setActiveId(id)
    setPlacing(false)
  }

  return <div className="mark-editor">
    <div className="mark-stage">
      <div className={'mark-paper' + (placing ? ' placing' : '')} style={{ width: geometry?.viewport.width ?? 490 }} onClick={event => {
        if (!placing) return
        const bounds = event.currentTarget.getBoundingClientRect()
        placeAt((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height)
      }}>
        <PageCanvas sheet={sheet} width={490} eager onGeometry={setGeometry} />
        {geometry && sheet.marks.map(item => {
          const { viewport, scale } = geometry
          const [x, y] = viewport.convertToViewportPoint(item.x, item.y)
          return <button dir="auto" type="button" key={item.id} className={'canvas-mark' + (item.id === activeId ? ' active' : '')}
            style={{
              left: 100 * x / viewport.width + '%', top: 100 * y / viewport.height + '%',
              '--mark-font': item.size * scale / viewport.width * 100 + 'cqw', color: item.color,
              '--mark-angle': (viewport.rotation - item.angle) + 'deg',
            } as CSSProperties} onClick={event => {
              event.stopPropagation()
              setActiveId(item.id)
              setPlacing(false)
            }}>{item.text || '⋯'}</button>
        })}
      </div>
    </div>
    <div className="mark-controls">
      <button type="button" className="button primary" disabled={!geometry} onClick={() => setPlacing(value => !value)}><Plus size={16} /> {t(placing ? 'Cancel placement' : 'Add text')}</button>
      <p>{t(placing ? 'Click or tap where the text should start.' : 'Add a new text box or select one on the page to edit it.')}</p>
      {placing && <button className="button secondary" type="button" onClick={() => placeAt(language === 'he' ? .7 : .2, .5)}>{t('Place on page')}</button>}
      {mark && <>
        <label className="field">{t('Text')}<input dir="auto" autoFocus key={mark.id} maxLength={300} value={mark.text}
          onFocus={event => event.currentTarget.select()} onChange={event => update({ text: event.target.value })} /></label>
        <div className="two-fields">
          <label className="field">{t('Size')}<input type="number" min="6" max="96" value={Math.round(mark.size)}
            onChange={event => update({ size: Math.min(96, Math.max(6, Number(event.target.value))) })} /></label>
          <label className="field">{t('Color')}<input type="color" value={mark.color} onChange={event => update({ color: event.target.value })} /></label>
        </div>
        <button type="button" className="button subtle" onClick={() => onChange(sheet.marks.filter(item => item.id !== mark.id))}><Trash2 size={15} /> {t('Remove text')}</button>
      </>}
    </div>
  </div>
}
