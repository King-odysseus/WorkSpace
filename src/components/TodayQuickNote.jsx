import React, { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Eraser } from 'lucide-react'
import { NOTE_COLORS, NOTE_COLOR_LABEL } from '../lib/note-colors.js'
import { workspaceCall } from '../lib/workspace-api.js'

// One sticky note on Today for jotting things down. It saves a moment after you
// stop typing, is private to you in this workspace, and stays until you clear it.
const SAVE_DELAY_MS = 700

export default function TodayQuickNote({ workspaceId }) {
  const [body, setBody] = useState('')
  const [color, setColor] = useState('yellow')
  const [loaded, setLoaded] = useState(false)
  const [status, setStatus] = useState('')
  const timer = useRef(null)
  const latest = useRef({ body: '', color: 'yellow' })
  latest.current = { body, color }

  useEffect(() => {
    if (!workspaceId) return undefined
    let cancelled = false
    workspaceCall(workspaceId, 'personal/quick-note/', 'GET')
      .then(data => {
        if (cancelled) return
        setBody(data.note?.body || '')
        setColor(data.note?.color || 'yellow')
        setLoaded(true)
      })
      .catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true; clearTimeout(timer.current) }
  }, [workspaceId])

  const save = async fields => {
    setStatus('Saving...')
    try {
      await workspaceCall(workspaceId, 'personal/quick-note/', 'PUT', fields)
      setStatus('Saved')
    } catch (failure) {
      setStatus('')
      toast.error(failure.message || 'The note could not be saved.')
    }
  }
  const change = event => {
    const next = event.target.value
    setBody(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => save({ body: next }), SAVE_DELAY_MS)
  }
  const pick = next => { setColor(next); save({ color: next }) }
  const clear = async () => {
    clearTimeout(timer.current)
    setBody('')
    setStatus('')
    try {
      await workspaceCall(workspaceId, 'personal/quick-note/', 'DELETE')
      setColor('yellow')
      toast.success('Note cleared.')
    } catch (failure) {
      toast.error(failure.message || 'The note could not be cleared.')
    }
  }

  if (!loaded) return null
  return (
    <section className={`today-quick-note plan-sticky color-${color}`} aria-label="Quick note">
      <header>
        <strong>Quick note</strong>
        <span className="quick-note-status" role="status">{status}</span>
      </header>
      <textarea
        className="plan-block-note quick-note-text"
        aria-label="Quick note text"
        placeholder="Jot something down. Only you can see this."
        rows={5}
        maxLength={2000}
        value={body}
        onChange={change}
      />
      <footer>
        <div className="note-colors" role="group" aria-label="Note colour">
          {NOTE_COLORS.map(name => (
            <button key={name} type="button" className={`note-color color-${name}${color === name ? ' is-selected' : ''}`} aria-label={NOTE_COLOR_LABEL[name]} aria-pressed={color === name} onClick={() => pick(name)} />
          ))}
        </div>
        <button type="button" className="quick-note-clear" onClick={clear} disabled={!body}><Eraser size={14} aria-hidden="true" /> Clear</button>
      </footer>
    </section>
  )
}
