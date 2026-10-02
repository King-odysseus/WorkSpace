// The in-app viewer for an uploaded file.
//
// Files used to open with window.open(url, '_blank'), which left the app
// outright: on mobile it hands the file to the system browser, and in the
// installed desktop app it opens a separate browser window. Either way there was
// nothing to press to come back, so readers who only meant to glance at a PDF
// lost their place. This overlay stays inside the app and carries its own Back
// control, which is the reader's way out from every state it can be in.
//
// It portals to <body> rather than rendering in place. The app header and the
// mobile pill nav both carry backdrop-filter, and a filtered ancestor becomes
// the containing block for its position: fixed descendants - the overlay would
// anchor to that ancestor instead of the viewport. Portalling sidesteps it
// rather than relying on where each call site happens to sit.

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, Download, FileWarning } from 'lucide-react'
import { downloadHref, previewKind, previewSrc } from '../lib/file-preview.js'

export default function FilePreview({ file, onClose }) {
  const backRef = useRef(null)
  const restoreRef = useRef(null)
  const name = file?.name || 'File'
  const src = previewSrc(file?.url)
  const kind = src ? previewKind(name) : 'none'
  const download = downloadHref(file?.url)

  // Focus the Back control on open so the reader lands on the way out, and hand
  // focus back to whatever opened the viewer on close so a keyboard user is not
  // dropped at the top of the page.
  useEffect(() => {
    restoreRef.current = document.activeElement
    backRef.current?.focus()
    return () => restoreRef.current?.focus?.()
  }, [])

  // Capture phase, and stopped. The surfaces this opens over - the task drawer,
  // the chat panes - close on Escape from their own document-level listeners, so
  // a plain bubble listener here would close the viewer and the layer under it
  // together and drop the reader two steps back instead of one.
  useEffect(() => {
    const onKey = event => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  if (!file) return null

  return createPortal(
    <div className="file-preview" role="dialog" aria-modal="true" aria-label={`Preview of ${name}`}>
      <div className="file-preview-bar">
        <button ref={backRef} type="button" className="secondary-button file-preview-back" onClick={onClose}>
          <ChevronLeft size={16} /> Back
        </button>
        <strong className="file-preview-name" title={name}>{name}</strong>
        {download && <a className="secondary-button file-preview-download" href={download}><Download size={15} /> Download</a>}
      </div>
      <div className="file-preview-body">
        {kind === 'image' && <img className="file-preview-image" src={src} alt={name} />}
        {/* A PDF renders in the browser's own viewer, which is why the server
            serves it inline and without the sandbox CSP images get. iOS Safari
            shows only the first page here, so the Download action in the bar
            stays the reliable route on a phone. */}
        {kind === 'pdf' && <iframe className="file-preview-frame" src={src} title={name} />}
        {kind === 'none' && <div className="file-preview-fallback">
          <FileWarning size={30} />
          <p><strong>{name}</strong></p>
          <p>This file type cannot be shown inside the app.</p>
          {download && <a className="primary-button" href={download}><Download size={15} /> Download</a>}
        </div>}
      </div>
    </div>,
    document.body,
  )
}
