import React, { useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Megaphone, X } from 'lucide-react'
import useMemos from '../lib/use-memos.js'

// The announcement banner: the newest memo that is still in its banner period and
// that this person has not closed. Clicking it opens the memo; the X closes it for
// this person only, and the memo stays on the Memos page.
export default function MemoBanner({ workspaceId, onOpen }) {
  const { memos, dismiss } = useMemos(workspaceId)
  const live = memos.filter(memo => memo.banner_active && !memo.dismissed)
  // With several memos up, the arrows step through them; the counter says where you are.
  const [position, setPosition] = useState(0)
  const index = Math.min(position, Math.max(0, live.length - 1))
  const memo = live[index]
  const step = delta => setPosition((index + delta + live.length) % live.length)
  const bannerRef = useRef(null)
  // Pages that fill the screen (the Zuri page) subtract this, so the banner never
  // pushes their bottom edge off screen.
  useLayoutEffect(() => {
    const root = document.documentElement
    const element = bannerRef.current
    if (!memo || !element) { root.style.removeProperty('--memo-banner-h'); return undefined }
    const apply = () => root.style.setProperty('--memo-banner-h', `${Math.ceil(element.getBoundingClientRect().height) + 24}px`)
    apply()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(apply) : null
    observer?.observe(element)
    return () => { observer?.disconnect(); root.style.removeProperty('--memo-banner-h') }
  }, [memo?.id])
  if (!memo) return null
  const preview = memo.body.replace(/\s+/g, ' ').slice(0, 120)

  return (
    <section ref={bannerRef} className="memo-banner" role="region" aria-label="Announcement">
      <button type="button" className="memo-banner-open" onClick={() => onOpen(memo)} aria-label={`Open memo: ${memo.title}`}>
        <span className="memo-banner-icon" aria-hidden="true"><Megaphone size={18} /></span>
        <span className="memo-banner-copy">
          <strong>{memo.title}</strong>
          <span>{preview}{memo.body.length > 120 ? '...' : ''}</span>
        </span>
        <span className="memo-banner-read">Read</span>
      </button>
      {live.length > 1 && (
        <div className="memo-banner-pager" role="group" aria-label="Announcements">
          <button type="button" onClick={() => step(-1)} aria-label="Previous announcement"><ChevronLeft size={16} aria-hidden="true" /></button>
          <span aria-live="polite">{index + 1} of {live.length}</span>
          <button type="button" onClick={() => step(1)} aria-label="Next announcement"><ChevronRight size={16} aria-hidden="true" /></button>
        </div>
      )}
      <button type="button" className="memo-banner-close" onClick={() => dismiss(memo.id)} aria-label="Dismiss announcement" title="Dismiss"><X size={16} aria-hidden="true" /></button>
    </section>
  )
}
