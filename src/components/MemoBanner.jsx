import React from 'react'
import { Megaphone, X } from 'lucide-react'
import useMemos from '../lib/use-memos.js'

// The announcement banner: the newest memo that is still in its banner period and
// that this person has not closed. Clicking it opens the memo; the X closes it for
// this person only, and the memo stays on the Memos page.
export default function MemoBanner({ workspaceId, onOpen }) {
  const { memos, dismiss } = useMemos(workspaceId)
  const live = memos.filter(memo => memo.banner_active && !memo.dismissed)
  const memo = live[0]
  if (!memo) return null
  const preview = memo.body.replace(/\s+/g, ' ').slice(0, 120)

  return (
    <section className="memo-banner" role="region" aria-label="Announcement">
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
