import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlignCenter, AlignLeft, AlignRight, Bold, Bot, ChevronLeft, Code, Download, FileText, Grid3X3, HelpCircle, Highlighter, History, IndentDecrease, IndentIncrease, Italic, Link2, List, ListOrdered, MessageSquare, Minus, Plus, Presentation, Redo2, RemoveFormatting, Save, Search, Send, Share2, Sparkles, Strikethrough, Table2, Trash2, Underline, Undo2, Upload, X } from 'lucide-react'
import { Card } from './ui/card.jsx'
import { readJsonResponse } from '../lib/workspace-format.js'

const headers = id => ({ 'X-Workspace-Id': String(id) })
const AI_PROVIDERS = [['openai', 'OpenAI'], ['claude', 'Claude'], ['kimi', 'Kimi'], ['deepseek', 'DeepSeek']]
async function csrf(extra = {}) {
  await fetch('/api/auth/csrf/', { credentials: 'include' })
  const token = document.cookie.split('; ').find(value => value.startsWith('csrftoken='))?.split('=')[1] || ''
  return { ...extra, 'X-CSRFToken': token }
}

// Schemes a link or image may use. Anything else - javascript:, vbscript:,
// data: with a non-image type - can run script when a reader clicks it.
const SAFE_URL = /^(?:https?:\/\/|mailto:|tel:|\/|#|\.\/|\.\.\/)/i
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i

export function safeUrl(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  // Browsers ignore control characters, so "java\tscript:alert(1)" still runs.
  const [head, ...rest] = trimmed.split('/')
  const candidate = [head.replace(/[\x00-\x20]/g, ''), ...rest].join('/')
  return SAFE_DATA_IMAGE.test(candidate) || SAFE_URL.test(candidate) ? candidate : ''
}

function cleanHtml(value) {
  if (typeof window === 'undefined') return value || ''
  const doc = new DOMParser().parseFromString(value || '', 'text/html')
  doc.querySelectorAll('script,style,iframe,object,embed,noscript,svg,math').forEach(node => node.remove())
  doc.querySelectorAll('*').forEach(node => [...node.attributes].forEach(attribute => { if (attribute.name.toLowerCase().startsWith('on')) node.removeAttribute(attribute.name) }))
  doc.querySelectorAll('[href],[src]').forEach(node => ['href', 'src'].forEach(attribute => {
    if (!node.hasAttribute(attribute)) return
    const url = safeUrl(node.getAttribute(attribute))
    if (url) node.setAttribute(attribute, url)
    else node.removeAttribute(attribute)
  }))
  doc.querySelectorAll('a[href]').forEach(node => node.setAttribute('rel', 'noopener noreferrer'))
  return doc.body.innerHTML
}

function RichEditor({ value, onChange, compact = false, readOnly = false, hideToolbar = false }) {
  const editorRef = useRef(null)
  // What we last handed to onChange. cleanHtml normalizes markup, so the value
  // coming back from the parent rarely matches innerHTML byte for byte; without
  // this guard the effect rewrites the DOM mid-keystroke and the caret jumps to
  // the start of the document.
  const lastEmitted = useRef(null)
  const emit = html => { lastEmitted.current = html; onChange(html) }
  useEffect(() => {
    if (!editorRef.current || value === lastEmitted.current) return
    if (editorRef.current.innerHTML !== value) editorRef.current.innerHTML = cleanHtml(value)
  }, [value])
  const command = (name, argument = null) => { editorRef.current?.focus(); document.execCommand(name, false, argument); emit(editorRef.current?.innerHTML || '') }
  const insertTable = () => {
    editorRef.current?.focus()
    document.execCommand('insertHTML', false, '<table><tbody><tr><td>Cell</td><td>Cell</td></tr><tr><td>Cell</td><td>Cell</td></tr></tbody></table><p><br></p>')
    emit(editorRef.current?.innerHTML || '')
  }
  const addLink = () => {
    const entered = window.prompt('Link URL')
    if (entered === null) return
    const url = safeUrl(entered)
    if (url) command('createLink', url)
    else window.alert('Links must start with http://, https://, mailto:, tel:, or /.')
  }
  const toolbarButton = (label, icon, action) => <button type="button" className="rich-toolbar-button" onMouseDown={event => event.preventDefault()} onClick={action} aria-label={label} title={label}>{icon}</button>
  return <div className={`rich-editor ${compact ? 'is-compact' : ''}`}>
    {!readOnly && !hideToolbar && <div className="rich-toolbar" role="toolbar" aria-label="Text formatting">
      <div className="rich-toolbar-row">
        <div className="rich-toolbar-group"><span>Edit</span>{toolbarButton('Undo', <Undo2 size={15} />, () => command('undo'))}{toolbarButton('Redo', <Redo2 size={15} />, () => command('redo'))}</div>
        <div className="rich-toolbar-group rich-toolbar-font"><span>Font</span><select onChange={event => command('fontName', event.target.value)} defaultValue="Arial" aria-label="Font family"><option>Arial</option><option>Calibri</option><option>Georgia</option><option>Times New Roman</option><option>Verdana</option></select><select onChange={event => command('fontSize', event.target.value)} defaultValue="3" aria-label="Font size"><option value="1">10</option><option value="2">12</option><option value="3">14</option><option value="4">18</option><option value="5">24</option><option value="6">32</option><option value="7">48</option></select></div>
        <div className="rich-toolbar-group"><span>Style</span>{toolbarButton('Bold', <Bold size={15} />, () => command('bold'))}{toolbarButton('Italic', <Italic size={15} />, () => command('italic'))}{toolbarButton('Underline', <Underline size={15} />, () => command('underline'))}{toolbarButton('Strikethrough', <Strikethrough size={15} />, () => command('strikeThrough'))}<label className="rich-color-control" title="Text color"><input type="color" defaultValue="#172033" onChange={event => command('foreColor', event.target.value)} /><span>A</span></label><label className="rich-color-control" title="Highlight color"><input type="color" defaultValue="#fff2a8" onChange={event => command('hiliteColor', event.target.value)} /><Highlighter size={15} /></label></div>
      </div>
      <div className="rich-toolbar-row">
        <div className="rich-toolbar-group"><span>Paragraph</span><select onChange={event => command('formatBlock', event.target.value)} defaultValue="p" aria-label="Paragraph style"><option value="p">Paragraph</option><option value="h1">Title</option><option value="h2">Heading 1</option><option value="h3">Heading 2</option><option value="blockquote">Quote</option><option value="pre">Code</option></select>{toolbarButton('Bulleted list', <List size={15} />, () => command('insertUnorderedList'))}{toolbarButton('Numbered list', <ListOrdered size={15} />, () => command('insertOrderedList'))}{toolbarButton('Decrease indent', <IndentDecrease size={15} />, () => command('outdent'))}{toolbarButton('Increase indent', <IndentIncrease size={15} />, () => command('indent'))}</div>
        <div className="rich-toolbar-group"><span>Align</span>{toolbarButton('Align left', <AlignLeft size={15} />, () => command('justifyLeft'))}{toolbarButton('Align center', <AlignCenter size={15} />, () => command('justifyCenter'))}{toolbarButton('Align right', <AlignRight size={15} />, () => command('justifyRight'))}</div>
        <div className="rich-toolbar-group"><span>Insert</span>{toolbarButton('Add link', <Link2 size={15} />, addLink)}{toolbarButton('Insert table', <Table2 size={15} />, insertTable)}{toolbarButton('Horizontal line', <Minus size={15} />, () => command('insertHorizontalRule'))}{toolbarButton('Code block', <Code size={15} />, () => command('formatBlock', 'pre'))}{toolbarButton('Clear formatting', <RemoveFormatting size={15} />, () => command('removeFormat'))}</div>
      </div>
    </div>}
    <div ref={editorRef} contentEditable={!readOnly} suppressContentEditableWarning onInput={event => emit(cleanHtml(event.currentTarget.innerHTML))} className="rich-editor-surface" data-placeholder="Start writing..." />
  </div>
}

function DocumentEditorSurface({ value, onChange, readOnly = false }) {
  return <div className="document-page-wrap"><div className="document-ruler" aria-hidden="true"><span>0</span><span>2</span><span>4</span><span>6</span><span>8</span><span>10</span><span>12</span><span>14</span><span>16</span><span>18</span></div><RichEditor value={value} onChange={onChange} readOnly={readOnly} /></div>
}

function spreadsheetDisplayValue(value, rows) {
  if (typeof value !== 'string' || !value.startsWith('=')) return value || ''
  const match = value.match(/^=(SUM|AVERAGE)\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$/i)
  if (!match || match[2] !== match[4]) return value
  const column = match[2].toUpperCase().charCodeAt(0) - 65
  const start = Number(match[3]) - 1
  const end = Number(match[5]) - 1
  const numbers = rows.slice(start, end + 1).map(row => Number(row[column])).filter(Number.isFinite)
  if (!numbers.length) return '0'
  const total = numbers.reduce((sum, number) => sum + number, 0)
  return String(match[1].toUpperCase() === 'AVERAGE' ? total / numbers.length : total)
}

function SpreadsheetEditor({ value, onChange, readOnly = false, workspaceId, documentId, onImport }) {
  const sheets = value?.sheets?.length ? value.sheets : [{ name: 'Sheet 1', rows: [['', '', ''], ['', '', ''], ['', '', '']] }]
  const [activeSheet, setActiveSheet] = useState(0)
  const [selectedCell, setSelectedCell] = useState({ row: 0, column: 0 })
  const sheet = sheets[Math.min(activeSheet, sheets.length - 1)]
  const updateCell = (rowIndex, columnIndex, cellValue) => onChange({ sheets: sheets.map((item, index) => index === activeSheet ? { ...item, rows: item.rows.map((row, r) => r === rowIndex ? row.map((cell, c) => c === columnIndex ? cellValue : cell) : row) } : item) })
  const addRow = () => onChange({ sheets: sheets.map((item, index) => index === activeSheet ? { ...item, rows: [...item.rows, Array(item.rows[0]?.length || 3).fill('')] } : item) })
  const addColumn = () => onChange({ sheets: sheets.map((item, index) => index === activeSheet ? { ...item, rows: item.rows.map(row => [...row, '']) } : item) })
  const addSheet = () => { const next = [...sheets, { name: `Sheet ${sheets.length + 1}`, rows: [['', '', ''], ['', '', ''], ['', '', '']] }]; onChange({ sheets: next }); setActiveSheet(next.length - 1) }
  const toggleCellStyle = (key, style) => onChange({ sheets: sheets.map((item, index) => index === activeSheet ? { ...item, cell_styles: { ...(item.cell_styles || {}), [key]: { ...(item.cell_styles?.[key] || {}), ...style } } } : item) })
  const exportCsv = () => { const csv = sheet.rows.map(row => row.map(cell => `"${String(cell || '').replaceAll('"', '""')}"`).join(',')).join('\n'); const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const link = document.createElement('a'); link.href = url; link.download = `${sheet.name}.csv`; link.click(); URL.revokeObjectURL(url) }
  const exportXlsx = async () => { const response = await fetch(`/api/workspaces/${workspaceId}/documents/${documentId}/export/`, { credentials: 'include', headers: headers(workspaceId) }); if (!response.ok) throw new Error('Spreadsheet export failed.'); const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = 'spreadsheet.xlsx'; link.click(); URL.revokeObjectURL(url) }
  const importFile = async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file || !workspaceId) return; const form = new FormData(); form.append('file', file); const response = await fetch(`/api/workspaces/${workspaceId}/spreadsheets/import/`, { method: 'POST', credentials: 'include', headers: await csrf(headers(workspaceId)), body: form }); const data = await readJsonResponse(response, 'Spreadsheet import failed.'); if (!response.ok) throw new Error(data.error || 'Spreadsheet import failed.'); onImport(data) }
  return <div className="spreadsheet-editor"><div className="spreadsheet-tabs">{sheets.map((item, index) => <button type="button" className={index === activeSheet ? "active" : ""} onClick={() => setActiveSheet(index)} key={item.name + index}>{item.name}</button>)}</div><div className="spreadsheet-toolbar"><strong>{sheet.name}</strong><button type="button" className="secondary-button" onClick={addSheet} disabled={readOnly}>Add sheet</button><button type="button" className="secondary-button" onClick={addRow} disabled={readOnly}>Add row</button><button type="button" className="secondary-button" onClick={addColumn} disabled={readOnly}>Add column</button><button type="button" className="secondary-button" onClick={() => toggleCellStyle(selectedCell.row + ":" + selectedCell.column, { bold: true })} disabled={readOnly}>Bold cell</button><button type="button" className="secondary-button" onClick={exportCsv}>Export CSV</button><button type="button" className="secondary-button" onClick={() => exportXlsx().catch(error => console.error('Spreadsheet export failed', error))}>Export XLSX</button><label className="secondary-button">Import CSV/XLSX<input type="file" accept=".csv,.xlsx" hidden onChange={event => importFile(event).catch(error => console.error('Spreadsheet import failed', error))} /></label><span>Enter formulas such as =SUM(A1:A3)</span></div><div className="spreadsheet-scroll"><table><tbody>{sheet.rows.map((row, rowIndex) => <tr key={rowIndex}><th>{rowIndex + 1}</th>{row.map((cell, columnIndex) => <td key={columnIndex} style={sheet.cell_styles?.[rowIndex + ':' + columnIndex]}><input value={cell || ''} onFocus={() => setSelectedCell({ row: rowIndex, column: columnIndex })} onChange={event => updateCell(rowIndex, columnIndex, event.target.value)} readOnly={readOnly} aria-label={`Row ${rowIndex + 1}, column ${columnIndex + 1}`} />{typeof cell === 'string' && cell.startsWith('=') && <small className="spreadsheet-formula-result">{spreadsheetDisplayValue(cell, sheet.rows)}</small>}</td>)}</tr>)}</tbody></table></div></div>
}

function FileDeleteDialog({ target, onCancel, onConfirm }) {
  if (!target) return null
  const name = target.type === 'file' ? target.item.original_name : target.item.title
  return <div className="modal-backdrop" onMouseDown={onCancel}><form className="modal file-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="file-delete-title" onSubmit={event => { event.preventDefault(); onConfirm() }} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Files</p><h2 id="file-delete-title">Delete this item?</h2></div><button type="button" className="close-button" onClick={onCancel} aria-label="Close delete dialog"><X size={18} /></button></div><p className="file-delete-copy"><strong>{name}</strong> will be removed from the workspace. This action cannot be undone.</p><div className="file-delete-actions"><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button><button type="submit" className="file-delete-confirm">Delete</button></div></form></div>
}

function FileRestoreDialog({ target, onCancel, onConfirm }) {
  if (!target) return null
  return <div className="modal-backdrop" onMouseDown={onCancel}><form className="modal file-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="file-restore-title" onSubmit={event => { event.preventDefault(); onConfirm() }} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Files</p><h2 id="file-restore-title">Restore this version?</h2></div><button type="button" className="close-button" onClick={onCancel} aria-label="Close restore dialog"><X size={18} /></button></div><p className="file-delete-copy">The version from {new Date(target.created_at).toLocaleString()} will become the current document. The current version remains in history.</p><div className="file-delete-actions"><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button><button type="submit" className="primary-button">Restore</button></div></form></div>
}

function PresentationToolbar({ readOnly, onAddTextBox, onAddColorBox, onAddImage, onAddTitle, onAddIcon, onResizeSlide }) {
  const format = command => { document.execCommand(command, false, null) }
  const button = (label, command) => <button type="button" className="presentation-tool-button" onMouseDown={event => event.preventDefault()} onClick={() => format(command)} disabled={readOnly}>{label}</button>
  return <div className="presentation-toolbar" role="toolbar" aria-label="Presentation tools"><span className="presentation-toolbar-label">Slide tools</span><button type="button" className="presentation-tool-button presentation-add-text" onClick={onAddTextBox} disabled={readOnly}>Add text box</button><button type="button" className="presentation-tool-button" onClick={onAddTitle} disabled={readOnly}>Add title</button><button type="button" className="presentation-tool-button" onClick={onAddColorBox} disabled={readOnly}>Color box</button><button type="button" className="presentation-tool-button" onClick={onAddImage} disabled={readOnly}>Add image</button><button type="button" className="presentation-tool-button" onClick={onAddIcon} disabled={readOnly}>Add icon</button><button type="button" className="presentation-tool-button" onClick={onResizeSlide} disabled={readOnly}>Resize slide</button>{button('Bold', 'bold')}{button('Italic', 'italic')}{button('Underline', 'underline')}{button('Bullets', 'insertUnorderedList')}{button('Align left', 'justifyLeft')}{button('Center', 'justifyCenter')}{button('Align right', 'justifyRight')}</div>
}

function promptForImage(label) {
  const entered = window.prompt(label)
  if (entered === null) return ''
  const url = safeUrl(entered)
  if (!url) window.alert('Image links must start with http://, https://, or / .')
  return url
}

// Keys are the block-address prefix; "title" and "body" are deliberately absent
// because those two live in slide.layout rather than in a collection.
const SLIDE_COLLECTIONS = { text: 'text_boxes', color: 'color_boxes', image: 'images', icon: 'icons' }

function PresentationSlideEditor({ slide, onChange, readOnly = false }) {
  const canvasRef = useRef(null)
  const dragState = useRef(null)
  const layout = {
    title: { x: 7, y: 7, width: 86, height: 18 },
    body: { x: 7, y: 29, width: 86, height: 62 },
    ...(slide.layout || {}),
  }
  const textBoxes = slide.text_boxes || []
  const colorBoxes = slide.color_boxes || []
  const images = slide.images || []

  const icons = slide.icons || []
  // Every placed element is addressed as "<prefix>-<index>" so one set of drag,
  // resize, and delete handlers covers text boxes, color boxes, images, and
  // icons alike. The built-in title and body live in slide.layout instead.
  const collectionOf = block => SLIDE_COLLECTIONS[block.split('-')[0]]
  const blockLayoutFor = block => {
    const collection = collectionOf(block)
    return collection ? (slide[collection] || [])[Number(block.split('-')[1])] : layout[block]
  }
  const updateLayout = (block, values) => {
    const collection = collectionOf(block)
    if (collection) {
      const index = Number(block.split('-')[1])
      onChange({ ...slide, [collection]: (slide[collection] || []).map((item, itemIndex) => itemIndex === index ? { ...item, ...values } : item) })
      return
    }
    onChange({ ...slide, layout: { ...layout, [block]: { ...layout[block], ...values } } })
  }
  const removeBlock = block => {
    const collection = collectionOf(block)
    if (!collection) return
    const index = Number(block.split('-')[1])
    onChange({ ...slide, [collection]: (slide[collection] || []).filter((item, itemIndex) => itemIndex !== index) })
  }
  const startDrag = (event, block) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const blockLayout = blockLayoutFor(block)
    dragState.current = { block, startX: event.clientX, startY: event.clientY, x: blockLayout.x, y: blockLayout.y }
  }
  const moveDrag = event => {
    const drag = dragState.current
    const canvas = canvasRef.current
    if (!drag || !canvas) return
    const bounds = canvas.getBoundingClientRect()
    const blockLayout = blockLayoutFor(drag.block)
    const x = Math.max(0, Math.min(100 - blockLayout.width, drag.x + ((event.clientX - drag.startX) / bounds.width) * 100))
    const y = Math.max(0, Math.min(100 - blockLayout.height, drag.y + ((event.clientY - drag.startY) / bounds.height) * 100))
    updateLayout(drag.block, { x, y })
  }
  const finishDrag = () => { dragState.current = null }
  const captureSize = (event, block) => {
    if (dragState.current || !canvasRef.current) return
    const bounds = canvasRef.current.getBoundingClientRect()
    const elementBounds = event.currentTarget.getBoundingClientRect()
    const blockLayout = blockLayoutFor(block)
    updateLayout(block, { width: Math.min(100 - blockLayout.x, (elementBounds.width / bounds.width) * 100), height: Math.min(100 - blockLayout.y, (elementBounds.height / bounds.height) * 100) })
  }
  const blockStyle = block => ({ left: `${layout[block].x}%`, top: `${layout[block].y}%`, width: `${layout[block].width}%`, height: `${layout[block].height}%` })
  const dragHandle = (block, label) => <button type="button" className="slide-drag-handle" onPointerDown={event => startDrag(event, block)} onPointerMove={moveDrag} onPointerUp={finishDrag} disabled={readOnly}>{label}</button>
  const blockControls = (block, label) => readOnly ? null : <>{dragHandle(block, label)}<button type="button" className="slide-delete-handle" onClick={() => removeBlock(block)} aria-label={`Delete ${label.replace('Drag ', '')}`} title="Delete"><X size={12} /></button></>

  const addTextBox = () => onChange({ ...slide, text_boxes: [...textBoxes, { id: `text-${Date.now()}`, text: 'New text box', x: 12, y: 18 + (textBoxes.length * 8) % 60, width: 34, height: 16 }] })
  const addTitle = () => onChange({ ...slide, text_boxes: [...textBoxes, { id: `title-${Date.now()}`, text: 'New title', x: 12, y: 8, width: 60, height: 14 }] })
  const addColorBox = () => onChange({ ...slide, color_boxes: [...colorBoxes, { id: `color-${Date.now()}`, x: 50, y: 20 + (colorBoxes.length * 8) % 60, width: 22, height: 18, color: '#dbeafe' }] })
  const addImage = () => { const url = promptForImage('Image URL'); if (url) onChange({ ...slide, images: [...images, { id: `image-${Date.now()}`, url, x: 42, y: 20, width: 28, height: 28 }] }) }
  const addIcon = () => { const url = promptForImage('Icon image URL'); if (url) onChange({ ...slide, icons: [...icons, { id: `icon-${Date.now()}`, url, x: 75, y: 10, width: 10, height: 10 }] }) }
  const resizeSlide = () => onChange({ ...slide, aspect_ratio: slide.aspect_ratio === '4/3' ? '16/9' : '4/3' })
  return <div className="presentation-slide-shell"><PresentationToolbar readOnly={readOnly} onAddTextBox={addTextBox} onAddTitle={addTitle} onAddColorBox={addColorBox} onAddImage={addImage} onAddIcon={addIcon} onResizeSlide={resizeSlide} /><div className="presentation-slide" style={{ aspectRatio: slide.aspect_ratio || '16/9' }} ref={canvasRef}>
    <section className="slide-editable-block slide-title-block" style={blockStyle('title')} onPointerUp={event => captureSize(event, 'title')}>
      {!readOnly && dragHandle('title', 'Drag title')}
      <input value={slide.title || ''} onChange={event => onChange({ ...slide, title: event.target.value })} placeholder="Slide title" readOnly={readOnly} />
    </section>
    <section className="slide-editable-block slide-body-block" style={blockStyle('body')} onPointerUp={event => captureSize(event, 'body')}>
      {!readOnly && dragHandle('body', 'Drag text')}
      <RichEditor value={slide.body || ''} onChange={body => onChange({ ...slide, body })} compact hideToolbar readOnly={readOnly} />
    </section>
    {textBoxes.map((box, index) => <section key={box.id || index} className="slide-editable-block slide-text-box" style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%` }} onPointerUp={event => captureSize(event, `text-${index}`)}>{blockControls(`text-${index}`, 'Drag text')}<RichEditor value={box.text || ''} onChange={text => onChange({ ...slide, text_boxes: textBoxes.map((item, itemIndex) => itemIndex === index ? { ...item, text } : item) })} compact hideToolbar readOnly={readOnly} /></section>)}
    {colorBoxes.map((box, index) => <section key={box.id || index} className="slide-editable-block slide-color-box" style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%`, background: box.color }} onPointerUp={event => captureSize(event, `color-${index}`)}>{blockControls(`color-${index}`, 'Drag box')}{!readOnly && <input type="color" className="slide-color-input" value={box.color || '#dbeafe'} onChange={event => updateLayout(`color-${index}`, { color: event.target.value })} aria-label="Box color" />}</section>)}
    {images.map((image, index) => <section key={image.id || index} className="slide-editable-block slide-image-box" style={{ left: `${image.x}%`, top: `${image.y}%`, width: `${image.width}%`, height: `${image.height}%` }} onPointerUp={event => captureSize(event, `image-${index}`)}>{blockControls(`image-${index}`, 'Drag image')}<img src={image.url} alt={image.alt || ''} /></section>)}
    {icons.map((icon, index) => <section key={icon.id || index} className="slide-editable-block slide-icon-box" style={{ left: `${icon.x}%`, top: `${icon.y}%`, width: `${icon.width}%`, height: `${icon.height}%` }} onPointerUp={event => captureSize(event, `icon-${index}`)}>{blockControls(`icon-${index}`, 'Drag icon')}<img src={icon.url} alt="" /></section>)}
  </div></div>
}

export function FilesWorkspaceView({ workspaceId }) {
  const [documents, setDocuments] = useState([])
  const [files, setFiles] = useState([])
  const [members, setMembers] = useState([])
  const [selected, setSelected] = useState(null)
  const [documentHtml, setDocumentHtml] = useState('')
  const [slides, setSlides] = useState([])
  const [spreadsheetData, setSpreadsheetData] = useState({ sheets: [] })
  const [activeSlide, setActiveSlide] = useState(0)
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('workspace-files-view') || 'grid')
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [comments, setComments] = useState([])
  const [shares, setShares] = useState([])
  const [commentDraft, setCommentDraft] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [conflict, setConflict] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [revisions, setRevisions] = useState([])
  const [shareUserId, setShareUserId] = useState('')
  const [sharePermission, setSharePermission] = useState('comment')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [restoreTarget, setRestoreTarget] = useState(null)
  const draggedSlideIndex = useRef(null)

  const load = useCallback(async () => {
    const [documentResponse, fileResponse, memberResponse] = await Promise.all([
      fetch(`/api/workspaces/${workspaceId}/documents/`, { credentials: 'include', headers: headers(workspaceId) }),
      fetch(`/api/workspaces/${workspaceId}/files/`, { credentials: 'include', headers: headers(workspaceId) }),
      fetch(`/api/workspaces/${workspaceId}/members/`, { credentials: 'include', headers: headers(workspaceId) }),
    ])
    const [documentData, fileData, memberData] = await Promise.all([
      readJsonResponse(documentResponse, 'Documents could not be loaded.'),
      readJsonResponse(fileResponse, 'Uploads could not be loaded.'),
      readJsonResponse(memberResponse, 'Team members could not be loaded.'),
    ])
    if (!documentResponse.ok) throw new Error(documentData.error || 'Documents could not be loaded.')
    if (!fileResponse.ok) throw new Error(fileData.error || 'Uploads could not be loaded.')
    if (!memberResponse.ok) throw new Error(memberData.error || 'Team members could not be loaded.')
    setDocuments(documentData.documents || [])
    setFiles(fileData.files || [])
    setMembers(memberData.members || [])
  }, [workspaceId])

  useEffect(() => { load().catch(() => setStatus('Could not load workspace files.')) }, [load])
  useEffect(() => { localStorage.setItem('workspace-files-view', viewMode) }, [viewMode])

  const openDocument = async document => {
    setSelected(document)
    setDocumentHtml(document.content?.html || document.content?.text || '')
    setSlides(document.content?.slides?.length ? document.content.slides : [{ title: 'New slide', body: '' }])
    setSpreadsheetData(document.content || { sheets: [] })
    setActiveSlide(0)
    setDirty(false)
    setStatus('Saved')
    setCommentsOpen(false)
    setShareOpen(false)
    try {
      const [commentResponse, shareResponse] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/documents/${document.id}/comments/`, { credentials: 'include', headers: headers(workspaceId) }),
        fetch(`/api/workspaces/${workspaceId}/documents/${document.id}/shares/`, { credentials: 'include', headers: headers(workspaceId) }),
      ])
      const commentData = await readJsonResponse(commentResponse, 'Comments could not be loaded.')
      const shareData = await readJsonResponse(shareResponse, 'Sharing details could not be loaded.')
      if (!commentResponse.ok) throw new Error(commentData.error || 'Comments could not be loaded.')
      if (!shareResponse.ok) throw new Error(shareData.error || 'Sharing details could not be loaded.')
      setComments(commentData.comments || [])
      setShares(shareData.shares || [])
    } catch (error) { setStatus(error.message || 'Document opened, but collaboration details could not be loaded.') }
  }

  const saveDocument = useCallback(async () => {
    if (!selected || busy) return
    setBusy(true)
    setStatus('Saving…')
    const content = selected.kind === 'presentation' ? { ...selected.content, slides } : selected.kind === 'spreadsheet' ? { ...selected.content, sheets: spreadsheetData.sheets } : { ...selected.content, html: cleanHtml(documentHtml), text: cleanHtml(documentHtml).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/documents/${selected.id}/`, { method: 'PATCH', credentials: 'include', headers: await csrf({ ...headers(workspaceId), 'Content-Type': 'application/json' }), body: JSON.stringify({ title: selected.title, content, base_updated_at: selected.updated_at }) })
      const data = await readJsonResponse(response, 'Changes could not be saved.')
      if (response.status === 409) {
        // Someone else saved first. Keep the local edits on screen and let the
        // author decide, rather than silently overwriting their colleague.
        setConflict(data.document || null)
        setStatus(data.error || 'Someone else saved this document while you were editing.')
        return
      }
      if (!response.ok) throw new Error(data.error || 'Could not save changes.')
      setSelected(data.document)
      setDocuments(current => current.map(item => item.id === data.document.id ? data.document : item))
      setDirty(false)
      setConflict(null)
      setStatus('Saved')
    } catch (error) { setStatus(error.message || 'Save failed.') } finally { setBusy(false) }
  }, [busy, documentHtml, selected, slides, spreadsheetData, workspaceId])

  useEffect(() => {
    if (!dirty || !selected || conflict) return undefined
    setStatus('Unsaved changes')
    const timer = window.setTimeout(saveDocument, 1200)
    return () => window.clearTimeout(timer)
  }, [dirty, documentHtml, slides, spreadsheetData, selected?.title, conflict, saveDocument])

  const createDocument = async kind => {
    setBusy(true)
    try {
      const content = kind === 'presentation' ? { slides: [{ title: 'New slide', body: '' }] } : kind === 'spreadsheet' ? { sheets: [{ name: 'Sheet 1', rows: [['', '', ''], ['', '', ''], ['', '', '']] }] } : { html: '', text: '' }
      const title = kind === 'presentation' ? 'Untitled presentation' : kind === 'spreadsheet' ? 'Untitled spreadsheet' : 'Untitled document'
      const response = await fetch(`/api/workspaces/${workspaceId}/documents/`, { method: 'POST', credentials: 'include', headers: await csrf({ ...headers(workspaceId), 'Content-Type': 'application/json' }), body: JSON.stringify({ title, kind, content }) })
      const data = await readJsonResponse(response, 'The item could not be created.')
      if (!response.ok) throw new Error(data.error || 'Could not create item.')
      setDocuments(current => [data.document, ...current])
      await openDocument(data.document)
    } catch (error) { setStatus(error.message) } finally { setBusy(false) }
  }

  const uploadFiles = async fileList => {
    const chosen = [...(fileList || [])]
    if (!chosen.length) return
    setBusy(true)
    const failures = []
    try {
      for (const [index, file] of chosen.entries()) {
        setStatus(chosen.length > 1 ? `Uploading ${index + 1} of ${chosen.length}...` : 'Uploading...')
        const body = new FormData(); body.append('file', file)
        const response = await fetch(`/api/workspaces/${workspaceId}/files/`, { method: 'POST', credentials: 'include', headers: await csrf(headers(workspaceId)), body })
        const data = await readJsonResponse(response, 'The file could not be uploaded.')
        if (!response.ok) { failures.push(`${file.name}: ${data.error || 'upload failed'}`); continue }
        setFiles(current => [data.file, ...current])
      }
      const uploaded = chosen.length - failures.length
      setStatus(failures.length ? `${uploaded} of ${chosen.length} uploaded. ${failures.join('; ')}` : `${uploaded} file${uploaded === 1 ? '' : 's'} uploaded.`)
    } catch (error) { setStatus(error.message || 'Upload failed.') } finally { setBusy(false) }
  }

  const upload = async event => {
    const chosen = event.target.files
    const list = chosen ? [...chosen] : []
    event.target.value = ''
    await uploadFiles(list)
  }

  const removeFile = async item => {
    setDeleteTarget({ type: 'file', item })
  }

  const openHistory = async () => {
    setHistoryOpen(current => !current)
    if (historyOpen || !selected) return
    const response = await fetch(`/api/workspaces/${workspaceId}/documents/${selected.id}/revisions/`, { credentials: 'include', headers: headers(workspaceId) })
    const data = await readJsonResponse(response, 'Version history could not be loaded.')
    if (!response.ok) return setStatus(data.error || 'Version history could not be loaded.')
    setRevisions(data.revisions || [])
  }

  const restoreRevision = async revision => {
    setRestoreTarget(revision)
  }
  const confirmRestoreRevision = async () => {
    const revision = restoreTarget
    setRestoreTarget(null)
    if (!revision) return
    const response = await fetch(`/api/workspaces/${workspaceId}/documents/${selected.id}/revisions/${revision.id}/restore/`, { method: 'POST', credentials: 'include', headers: await csrf(headers(workspaceId)) })
    const data = await readJsonResponse(response, 'The version could not be restored.')
    if (!response.ok) return setStatus(data.error || 'Could not restore that version.')
    await openDocument(data.document)
    setStatus('Version restored.')
  }

  const discardConflict = async () => {
    if (!conflict) return
    setConflict(null)
    await openDocument(conflict)
    setStatus('Reloaded the newer version.')
  }

  const overwriteConflict = () => {
    // Drop the base stamp so the next save is unconditional.
    setSelected(current => ({ ...current, updated_at: conflict?.updated_at || current.updated_at }))
    setConflict(null)
    setDirty(true)
    setStatus('Your version will overwrite theirs on the next save.')
  }

  const addComment = async event => {
    event.preventDefault()
    if (!commentDraft.trim()) return
    const response = await fetch(`/api/workspaces/${workspaceId}/documents/${selected.id}/comments/`, { method: 'POST', credentials: 'include', headers: await csrf({ ...headers(workspaceId), 'Content-Type': 'application/json' }), body: JSON.stringify({ body: commentDraft.trim(), anchor: selected.kind === 'presentation' ? { slide: activeSlide + 1 } : {} }) })
    const data = await readJsonResponse(response, 'The comment could not be posted.')
    if (!response.ok) return setStatus(data.error || 'Comment could not be posted.')
    setComments(current => [...current, data.comment]); setCommentDraft(''); setStatus('Comment posted.')
  }

  const resolveComment = async comment => {
    const response = await fetch(`/api/workspaces/${workspaceId}/documents/${selected.id}/comments/${comment.id}/`, { method: 'PATCH', credentials: 'include', headers: await csrf({ ...headers(workspaceId), 'Content-Type': 'application/json' }), body: JSON.stringify({ resolved: !comment.resolved }) })
    const data = await readJsonResponse(response, 'The comment could not be updated.')
    if (response.ok) setComments(current => current.map(item => item.id === comment.id ? data.comment : item))
  }

  const shareDocument = async event => {
    event.preventDefault()
    if (!shareUserId) return
    const response = await fetch(`/api/workspaces/${workspaceId}/documents/${selected.id}/shares/`, { method: 'POST', credentials: 'include', headers: await csrf({ ...headers(workspaceId), 'Content-Type': 'application/json' }), body: JSON.stringify({ user_id: Number(shareUserId), permission: sharePermission }) })
    const data = await readJsonResponse(response, 'The document could not be shared.')
    if (!response.ok) return setStatus(data.error || 'Document could not be shared.')
    setShares(current => [...current.filter(item => item.user_id !== data.share.user_id), data.share]); setShareUserId(''); setStatus('Shared with team member.')
  }

  const removeDocument = async () => {
    if (!selected) return
    setDeleteTarget({ type: 'document', item: selected })
  }

  const confirmDelete = async () => {
    const target = deleteTarget
    setDeleteTarget(null)
    if (!target) return
    if (target.type === 'file') return removeFileConfirmed(target.item)
    return removeDocumentConfirmed(target.item)
  }
  const removeFileConfirmed = async item => {
    const response = await fetch(`/api/workspaces/${workspaceId}/files/${item.id}/`, { method: 'DELETE', credentials: 'include', headers: await csrf(headers(workspaceId)) })
    const data = await readJsonResponse(response, 'The file could not be deleted.')
    if (!response.ok) return setStatus(data.error || 'Could not delete file.')
    setFiles(current => current.filter(entry => entry.id !== item.id)); setStatus('File deleted.')
  }
  const removeDocumentConfirmed = async item => {
    const response = await fetch(`/api/workspaces/${workspaceId}/documents/${item.id}/`, { method: 'DELETE', credentials: 'include', headers: await csrf(headers(workspaceId)) })
    if (!response.ok) return setStatus('Could not delete item.')
    setDocuments(current => current.filter(entry => entry.id !== item.id)); setSelected(null); setStatus('Item deleted.')
  }

  const items = [
    ...documents.map(item => ({ ...item, itemType: item.kind, owner: members.find(member => member.id === item.created_by), modified: item.updated_at })),
    ...files.map(item => ({ ...item, title: item.original_name, itemType: 'file', modified: item.created_at, owner: { first_name: item.uploaded_by } })),
  ].filter(item => (category === 'all' || item.itemType === category) && item.title.toLowerCase().includes(query.toLowerCase()))

  if (selected) {
    const canEdit = selected.permission === 'edit'
    const canComment = ['comment', 'edit'].includes(selected.permission)
    const updateSlide = patch => { setSlides(current => current.map((slide, index) => index === activeSlide ? { ...slide, ...patch } : slide)); setDirty(true) }
    return <section className="workspace-view file-editor-view">{deleteTarget && <FileDeleteDialog target={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={() => confirmDelete().catch(error => setStatus(error.message || 'Delete failed.'))} />}{restoreTarget && <FileRestoreDialog target={restoreTarget} onCancel={() => setRestoreTarget(null)} onConfirm={() => confirmRestoreRevision().catch(error => setStatus(error.message || 'Restore failed.'))} />}
      <div className="file-editor-commandbar"><button type="button" className="secondary-button" onClick={() => setSelected(null)}><ChevronLeft size={15} /> Files</button><input className="file-editor-title" value={selected.title} onChange={event => { setSelected(current => ({ ...current, title: event.target.value })); setDirty(true) }} readOnly={!canEdit} /><span className={`file-save-status ${dirty ? 'is-dirty' : ''}`} role="status">{canEdit ? (status || 'Saved') : `Read only (${selected.permission || 'view'})`}</span><button type="button" className="secondary-button" onClick={() => setCommentsOpen(current => !current)}><MessageSquare size={15} /> Comments ({comments.filter(item => !item.resolved).length})</button><button type="button" className="secondary-button" onClick={() => openHistory().catch(() => setStatus('Version history could not be loaded.'))}><History size={15} /> History</button>{canEdit && <><button type="button" className="primary-button" onClick={() => setShareOpen(current => !current)}><Share2 size={15} /> Share</button><button type="button" className="secondary-button" onClick={saveDocument} disabled={busy}><Save size={15} /> Save</button><button type="button" className="file-delete-button" onClick={removeDocument} aria-label="Delete"><Trash2 size={16} /></button></>}</div>
      {conflict && <div className="document-conflict-banner" role="alert"><strong>This document changed while you were editing.</strong><span>{conflict.title} was saved by someone else. Autosave is paused so your work is not lost.</span><button type="button" className="secondary-button" onClick={() => discardConflict().catch(() => setStatus('Could not reload the document.'))}>Discard mine and reload</button><button type="button" className="primary-button" onClick={overwriteConflict}>Keep mine and overwrite</button></div>}
      <div className={`file-editor-layout ${(commentsOpen || shareOpen || historyOpen) ? 'has-review-panel' : ''}`}>
        {selected.kind === 'presentation' && <aside className="slide-rail">{canEdit && <button type="button" className="secondary-button" onClick={() => { setSlides(current => [...current, { title: `Slide ${current.length + 1}`, body: '' }]); setActiveSlide(slides.length); setDirty(true) }}><Plus size={14} /> Slide</button>}{slides.map((slide, index) => <button type="button" draggable={canEdit} className={index === activeSlide ? 'active' : ''} onClick={() => setActiveSlide(index)} onDragStart={() => { draggedSlideIndex.current = index }} onDragOver={event => { if (canEdit) event.preventDefault() }} onDrop={() => { const source = draggedSlideIndex.current; if (!canEdit || source === null || source === index) return; setSlides(current => { const reordered = [...current]; const [moved] = reordered.splice(source, 1); reordered.splice(index, 0, moved); return reordered }); setActiveSlide(index); setDirty(true); draggedSlideIndex.current = null }} key={index}><span>{index + 1}</span><strong>{slide.title || `Slide ${index + 1}`}</strong></button>)}</aside>}
        <main className={selected.kind === 'presentation' ? 'presentation-canvas' : selected.kind === 'spreadsheet' ? 'spreadsheet-canvas' : 'document-canvas'}>{selected.kind === 'presentation' ? <PresentationSlideEditor slide={slides[activeSlide] || { title: '', body: '' }} onChange={nextSlide => updateSlide(nextSlide)} readOnly={!canEdit} /> : selected.kind === 'spreadsheet' ? <SpreadsheetEditor workspaceId={workspaceId} documentId={selected.id} value={spreadsheetData} onChange={value => { setSpreadsheetData(value); setDirty(true) }} onImport={value => { setSpreadsheetData(value); setDirty(true) }} readOnly={!canEdit} /> : <DocumentEditorSurface value={documentHtml} onChange={value => { setDocumentHtml(value); setDirty(true) }} readOnly={!canEdit} />}</main>
        {(commentsOpen || shareOpen || historyOpen) && <aside className="document-review-panel">{historyOpen && <><h3>Version history</h3><div className="document-revision-list">{revisions.map(revision => <article key={revision.id}><strong>{new Date(revision.created_at).toLocaleString()}</strong><span>{revision.created_by}</span>{canEdit && <button type="button" onClick={() => restoreRevision(revision).catch(() => setStatus('Could not restore that version.'))}>Restore</button>}</article>)}</div>{!revisions.length && <p className="workspace-inline-status">No earlier versions yet.</p>}</>}{shareOpen && <><h3>Share</h3><form onSubmit={shareDocument}><select value={shareUserId} onChange={event => setShareUserId(event.target.value)} required><option value="">Choose a team member</option>{members.map(member => <option key={member.id} value={member.id}>{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}</option>)}</select><select value={sharePermission} onChange={event => setSharePermission(event.target.value)}><option value="view">Can view</option><option value="comment">Can comment</option><option value="edit">Can edit</option></select><button className="primary-button">Share</button></form>{shares.map(share => <div className="document-share-row" key={share.id}><strong>{share.user_name}</strong><span>{share.permission}</span></div>)}</>}{commentsOpen && <><h3>Review comments</h3><div className="document-comment-list">{comments.map(comment => <article className={comment.resolved ? 'resolved' : ''} key={comment.id}><strong>{comment.author_name}</strong><span>{new Date(comment.created_at).toLocaleString()}{comment.anchor?.slide ? `, Slide ${comment.anchor.slide}` : ''}</span><p>{comment.body}</p>{canComment && <button type="button" onClick={() => resolveComment(comment)}>{comment.resolved ? 'Reopen' : 'Resolve'}</button>}</article>)}</div>{canComment ? <form onSubmit={addComment}><textarea value={commentDraft} onChange={event => setCommentDraft(event.target.value)} placeholder="Add a review comment..." /><button className="primary-button">Comment</button></form> : <p className="workspace-inline-status">View-only access does not allow comments.</p>}</>}</aside>}
      </div>
    </section>
  }

  const typeLabel = itemType => itemType === 'presentation' ? 'Presentation' : itemType === 'document' ? 'Document' : itemType === 'spreadsheet' ? 'Spreadsheet' : 'Uploaded file'
  const openItem = item => item.itemType === 'file' ? window.open(item.url, '_blank', 'noopener') : openDocument(item)
  return <section
    className={`workspace-view files-browser-view ${dragActive ? 'is-drop-target' : ''}`}
    onDragOver={event => { event.preventDefault(); setDragActive(true) }}
    onDragLeave={event => { if (event.currentTarget === event.target) setDragActive(false) }}
    onDrop={event => { event.preventDefault(); setDragActive(false); uploadFiles(event.dataTransfer?.files) }}
  >{deleteTarget && <FileDeleteDialog target={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={() => confirmDelete().catch(error => setStatus(error.message || "Delete failed."))} />}<div className="files-browser-heading"><div><p className="eyebrow">Workspace resources</p><h2>Files</h2><p>Browse documents, presentations, and uploads.</p></div><div className="files-create-actions"><button type="button" className="secondary-button" onClick={() => createDocument('document')}><FileText size={15} /> New document</button><button type="button" className="secondary-button" onClick={() => createDocument('presentation')}><Presentation size={15} /> New presentation</button><button type="button" className="secondary-button" onClick={() => createDocument('spreadsheet')}><Table2 size={15} /> New spreadsheet</button><label className="primary-button"><Upload size={15} /> Upload<input type="file" hidden multiple onChange={upload} /></label></div></div>{status && <p className="workspace-inline-status" role="status">{status}</p>}<div className="files-browser-toolbar"><div className="files-categories">{[['all', 'All'], ['document', 'Documents'], ['presentation', 'Presentations'], ['spreadsheet', 'Spreadsheets'], ['file', 'Uploads']].map(([value, label]) => <button type="button" className={category === value ? 'active' : ''} onClick={() => setCategory(value)} key={value}>{label}</button>)}</div><label className="files-search"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search files" /></label><div className="files-view-switch"><button type="button" className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')} aria-label="Thumbnail view"><Grid3X3 size={16} /></button><button type="button" className={viewMode === 'table' ? 'active' : ''} onClick={() => setViewMode('table')} aria-label="Table view"><Table2 size={16} /></button></div></div>{viewMode === 'grid' ? <div className="files-thumbnail-grid">{items.map(item => <div className="files-thumbnail-tile" key={`${item.itemType}-${item.id}`}><button type="button" onClick={() => openItem(item)}><span className={`file-thumbnail file-thumbnail-${item.itemType}`}>{item.itemType === 'presentation' ? <Presentation size={38} /> : item.itemType === 'spreadsheet' ? <Table2 size={38} /> : <FileText size={38} />}</span><strong>{item.title}</strong><small>{typeLabel(item.itemType)} · {new Date(item.modified).toLocaleDateString()}</small></button>{item.itemType === 'file' && <button type="button" className="files-tile-delete" onClick={() => removeFile(item)} aria-label={`Delete ${item.title}`} title="Delete"><Trash2 size={14} /></button>}</div>)}</div> : <div className="files-table-wrap"><table className="files-table"><thead><tr><th>Name</th><th>Type</th><th>Owner</th><th>Modified</th><th>Size</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>{items.map(item => <tr key={`${item.itemType}-${item.id}`} tabIndex={0} role="button" aria-label={`Open ${item.title}`} onClick={() => openItem(item)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openItem(item) } }}><td><span>{item.itemType === 'presentation' ? <Presentation size={17} /> : item.itemType === 'spreadsheet' ? <Table2 size={17} /> : <FileText size={17} />}</span>{item.title}</td><td>{typeLabel(item.itemType)}</td><td>{item.owner ? [item.owner.first_name, item.owner.last_name].filter(Boolean).join(' ') || item.owner.email : '-'}</td><td>{new Date(item.modified).toLocaleString()}</td><td>{item.size ? `${Math.ceil(item.size / 1024)} KB` : '-'}</td><td>{item.itemType === 'file' && <button type="button" className="files-row-delete" onClick={event => { event.stopPropagation(); removeFile(item) }} aria-label={`Delete ${item.title}`} title="Delete"><Trash2 size={15} /></button>}</td></tr>)}</tbody></table></div>}{!items.length && <div className="files-empty">No matching files.</div>}</section>
}

export function AssistantFlyout({ workspaceId, onClose }) {
  const [data, setData] = useState(null); const [provider, setProvider] = useState('openai'); const [message, setMessage] = useState(''); const [answer, setAnswer] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { fetch(`/api/workspaces/${workspaceId}/ai/settings/`, { credentials: 'include', headers: headers(workspaceId) }).then(r => r.json()).then(result => { if (result.settings) { setData(result); setProvider(result.settings.ai_default_provider || 'openai') } else setError(result.error || 'Assistant unavailable.') }).catch(() => setError('Assistant unavailable.')) }, [workspaceId])
  const ask = async event => { event.preventDefault(); if (!message.trim()) return; setBusy(true); setError(''); try { const response = await fetch(`/api/workspaces/${workspaceId}/ai/chat/`, { method: 'POST', credentials: 'include', headers: await csrf({ ...headers(workspaceId), 'Content-Type': 'application/json' }), body: JSON.stringify({ message, provider }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Assistant unavailable.'); setAnswer(result.answer); setMessage('') } catch (requestError) { setError(requestError.message) } finally { setBusy(false) } }
  const providers = data?.providers || {}; const enabled = data?.settings?.ai_enabled_providers || Object.keys(providers).filter(key => providers[key])
  return <aside className="ai-chat-window fixed bottom-5 right-4 z-[80] flex w-[min(350px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl lg:bottom-6 lg:right-6"><div className="flex items-center justify-between bg-navy px-3 py-2 text-white"><div className="flex min-w-0 items-center gap-2"><span className="rounded-lg bg-accent/20 p-1.5 text-accent"><Bot size={15} /></span><strong className="shrink-0 text-xs">AI assistant</strong></div><button type="button" className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white" onClick={onClose} aria-label="Close assistant"><X size={15} /></button></div>{(answer || error) && <div className="max-h-[210px] overflow-y-auto p-3">{answer && <div className="whitespace-pre-wrap rounded-xl rounded-bl-sm bg-surface-secondary p-3 text-xs leading-5">{answer}</div>}{error && <div className="rounded-xl bg-danger/10 p-2.5 text-xs text-danger">{error}</div>}</div>}<form onSubmit={ask} className="p-2"><div className="flex items-center gap-1.5 rounded-xl bg-surface-secondary p-1"><textarea value={message} onChange={event => setMessage(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form.requestSubmit() } }} className="ai-chat-input max-h-20 min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 text-xs outline-none" placeholder="Ask anything…" /><button className="rounded-lg bg-accent p-2 text-navy disabled:opacity-40" disabled={busy || !message.trim()} aria-label="Send message"><Send size={14} /></button></div></form></aside>
}

export function AISettingsPanel({ workspaceId, members = [], canManageMembers }) {
  const [data, setData] = useState(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingProvider, setSavingProvider] = useState('')
  const [providerNotices, setProviderNotices] = useState({})

  useEffect(() => {
    let active = true
    fetch(`/api/workspaces/${workspaceId}/ai/settings/`, { credentials: 'include', headers: headers(workspaceId) })
      .then(async response => ({ ok: response.ok, result: await response.json() }))
      .then(({ ok, result }) => {
        if (!active) return
        setData(ok ? result : { error: result.error || 'AI settings could not be loaded.' })
      })
      .catch(() => active && setData({ error: 'AI settings could not be loaded.' }))
    return () => { active = false }
  }, [workspaceId])

  if (!data) return <Card className="settings-panel p-5">Loading AI settings…</Card>
  if (data.error) return <Card className="settings-panel p-5"><p className="auth-error" role="alert">{data.error}</p></Card>

  const settings = {
    ai_enabled: false,
    ai_user_ids: [],
    ai_enabled_providers: [],
    ai_default_provider: 'openai',
    ...(data.settings || {}),
  }
  settings.ai_user_ids = settings.ai_user_ids || []
  settings.ai_enabled_providers = settings.ai_enabled_providers || []
  const providerConfig = data.provider_config || {}
  const mayManage = Boolean(data.can_manage)

  const updateSettings = changes => setData(current => ({
    ...current,
    settings: { ...current.settings, ...changes },
  }))
  const updateProvider = (provider, changes) => setData(current => ({
    ...current,
    provider_config: {
      ...current.provider_config,
      [provider]: { ...(current.provider_config?.[provider] || {}), ...changes },
    },
  }))
  const toggleProvider = provider => {
    const enabled = settings.ai_enabled_providers.includes(provider)
    updateSettings({ ai_enabled_providers: enabled
      ? settings.ai_enabled_providers.filter(value => value !== provider)
      : [...settings.ai_enabled_providers, provider] })
  }
  const toggleMember = id => updateSettings({ ai_user_ids: settings.ai_user_ids.includes(id)
    ? settings.ai_user_ids.filter(value => value !== id)
    : [...settings.ai_user_ids, id] })

  const providerPayload = provider => {
    const config = providerConfig[provider] || {}
    return {
      base_url: config.base_url || '',
      model: config.model || '',
      api_key: config.api_key || '',
      clear_api_key: Boolean(config.clear_api_key),
    }
  }

  const saveProvider = async provider => {
    setSavingProvider(provider)
    setProviderNotices(current => ({ ...current, [provider]: '' }))
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/ai/settings/`, {
        method: 'PATCH',
        credentials: 'include',
        headers: await csrf({ ...headers(workspaceId), 'Content-Type': 'application/json' }),
        body: JSON.stringify({ ...settings, provider_config: { [provider]: providerPayload(provider) } }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || `Could not save ${provider}.`)
      setData(current => ({
        ...current,
        providers: result.providers,
        settings: result.settings,
        provider_config: {
          ...current.provider_config,
          [provider]: result.provider_config[provider],
        },
      }))
      setProviderNotices(current => ({ ...current, [provider]: 'Saved' }))
    } catch (error) {
      setProviderNotices(current => ({ ...current, [provider]: error.message || 'Could not save provider.' }))
    } finally {
      setSavingProvider('')
    }
  }

  const save = async () => {
    setSaving(true)
    setNotice('')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/ai/settings/`, {
        method: 'PATCH',
        credentials: 'include',
        headers: await csrf({ ...headers(workspaceId), 'Content-Type': 'application/json' }),
        body: JSON.stringify(settings),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save AI settings.')
      setData(current => ({ ...current, ...result, can_manage: current.can_manage }))
      setNotice('Workspace AI access settings saved.')
    } catch (error) {
      setNotice(error.message || 'Could not save AI settings.')
    } finally {
      setSaving(false)
    }
  }

  return <Card className="settings-panel p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="eyebrow">Company assistant</p>
        <h2>AI providers & access</h2>
        <p className="text-sm text-text-muted">Add the company credentials here. API keys are encrypted and are never shown again.</p>
      </div>
      <button type="button" className="secondary-button" onClick={() => setHelpOpen(current => !current)}>
        <HelpCircle size={15} /> Setup help
      </button>
    </div>

    {helpOpen && <div className="mt-4 rounded-xl bg-accent/10 p-4 text-sm leading-6">
      <strong>How to connect a provider</strong>
      <p className="mt-1 text-text-muted">Create an API key in the provider's developer console, paste it below, check Enable, choose a model, then save. The default base URLs are already filled in. You only need to change one when using a compatible gateway or proxy.</p>
      <p className="mt-2 text-text-muted">Railway environment variables still work as a fallback, but they are no longer required for setup.</p>
    </div>}

    <div className="mt-5 space-y-3">
      {AI_PROVIDERS.map(([provider, label]) => {
        const config = providerConfig[provider] || {}
        const enabled = settings.ai_enabled_providers.includes(provider)
        const isDefault = settings.ai_default_provider === provider
        return <section key={provider} className="rounded-2xl bg-surface-secondary p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">{label}</h3>
              <p className="text-xs text-text-muted">{config.has_api_key && !config.clear_api_key ? `Key saved (${config.key_hint})` : 'No API key saved'}</p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="ai-provider-default">
                <input type="radio" name="company-default-ai-provider" checked={isDefault} onChange={() => updateSettings({ ai_default_provider: provider })} disabled={!mayManage} />
                <span>Company default</span>
              </label>
              <label className="ai-provider-switch">
                <input type="checkbox" checked={enabled} onChange={() => toggleProvider(provider)} disabled={!mayManage} />
                <span className="ai-provider-switch-track" aria-hidden="true"><span /></span>
                <span>{enabled ? 'Enabled' : 'Disabled'}</span>
              </label>
            </div>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <label className="text-sm lg:col-span-2">API key
              <input
                type="password"
                value={config.api_key || ''}
                onChange={event => updateProvider(provider, { api_key: event.target.value, clear_api_key: false })}
                placeholder={config.has_api_key ? `Leave blank to keep ${config.key_hint}` : `Paste your ${label} API key`}
                autoComplete="new-password"
                disabled={!mayManage}
                className="mt-1 w-full rounded-xl bg-surface px-3 py-2.5 outline-none focus:ring-2 focus:ring-accent/30"
              />
            </label>
            <label className="text-sm">Base URL
              <input
                type="url"
                value={config.base_url || ''}
                onChange={event => updateProvider(provider, { base_url: event.target.value })}
                disabled={!mayManage}
                className="mt-1 w-full rounded-xl bg-surface px-3 py-2.5 outline-none focus:ring-2 focus:ring-accent/30"
              />
            </label>
            <label className="text-sm">Model
              <input
                value={config.model || ''}
                onChange={event => updateProvider(provider, { model: event.target.value })}
                disabled={!mayManage}
                className="mt-1 w-full rounded-xl bg-surface px-3 py-2.5 outline-none focus:ring-2 focus:ring-accent/30"
              />
            </label>
          </div>
          {mayManage && config.has_api_key && <button
            type="button"
            className="mt-3 text-xs font-semibold text-danger"
            onClick={() => {
              const clearing = !config.clear_api_key
              updateProvider(provider, { api_key: '', clear_api_key: clearing })
              if (clearing && enabled) toggleProvider(provider)
            }}
          >{config.clear_api_key ? 'Keep saved key' : 'Remove saved key'}</button>}
          {mayManage && <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className="primary-button" onClick={() => saveProvider(provider)} disabled={Boolean(savingProvider)}>
              <Save size={15} /> {savingProvider === provider ? 'Saving…' : `Save ${label}`}
            </button>
            {providerNotices[provider] && <span className={`text-xs ${providerNotices[provider] === 'Saved' ? 'text-text-muted' : 'text-danger'}`} role="status">{providerNotices[provider]}</span>}
          </div>}
        </section>
      })}
    </div>

    <div className="mt-5">
      <label className="flex items-center gap-3 rounded-xl bg-surface-secondary px-4 py-3 text-sm font-semibold">
        <input type="checkbox" checked={settings.ai_enabled} onChange={event => updateSettings({ ai_enabled: event.target.checked })} disabled={!mayManage} />
        Enable the assistant for this workspace
      </label>
    </div>

    <div className="mt-5">
      <p className="text-sm font-semibold">Members with access</p>
      <p className="text-xs text-text-muted">Owners and managers always have access. Select the other team members who may use the company key.</p>
      <div className="mt-2 grid gap-1 sm:grid-cols-2">
        {members.map(member => <label key={member.id} className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-surface-secondary">
          <input type="checkbox" checked={settings.ai_user_ids.includes(member.id)} onChange={() => toggleMember(member.id)} disabled={!mayManage} />
          {[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}
        </label>)}
      </div>
    </div>

    {mayManage && <button type="button" className="primary-button mt-5" onClick={save} disabled={saving}>
      <Save size={15} /> {saving ? 'Saving…' : 'Save workspace access'}
    </button>}
    {notice && <p className="workspace-inline-status mt-3" role="status">{notice}</p>}
  </Card>
}
