import React, { useLayoutEffect, useRef } from 'react'
import { Megaphone, X } from 'lucide-react'
import useMemos from '../lib/use-memos.js'

// The announcement banner: the newest memo that is still in its banner period and
// that this person has not closed. Clicking it opens the memo; the X closes it for
// this person only, and the memo stays on the Memos page.
export default function MemoBanner({ workspaceId, onOpen }) {
  const { memos, dismiss } = useMemos(workspaceId)
  const live = memos.filter(memo => memo.banner_active && !memo.dismissed)
  const memo = live[0]
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
        {live.length > 1 && <span className="memo-banner-more">+{live.length - 1} more</span>}
        <span className="memo-banner-read">Read</span>
      </button>
      <button type="button" className="memo-banner-close" onClick={() => dismiss(memo.id)} aria-label="Dismiss announcement" title="Dismiss"><X size={16} aria-hidden="true" /></button>
    </section>
  )
}
