import React, { useEffect, useState } from 'react'
import { Megaphone, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from './ui/button.jsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog.jsx'
import { WorkspaceViewHeading } from './workspace-ui.jsx'
import useMemos from '../lib/use-memos.js'
import { OPEN_MEMO_EVENT, takePendingMemo } from '../lib/memo-navigation.js'

// Company memos: one announcement to the whole workspace. Everyone can read them
// here; people with the "Post company memos" permission can write them.
const BANNER_CHOICES = [['0', 'No banner'], ['1', '1 day'], ['3', '3 days'], ['7', '7 days'], ['14', '14 days'], ['30', '30 days']]
const day = iso => new Date(iso).toLocaleDateString([], { dateStyle: 'medium' })

function MemoForm({ memo, onSave, onClose }) {
  const [title, setTitle] = useState(memo?.title || '')
  const [body, setBody] = useState(memo?.body || '')
  const [bannerDays, setBannerDays] = useState(memo ? (memo.banner_active ? '7' : '0') : '7')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async event => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await onSave({ title, body, banner_days: Number(bannerDays) })
      onClose()
    } catch (saveError) {
      setError(saveError.message)
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !saving) onClose() }}>
      <DialogContent className="memo-dialog">
        <DialogTitle>{memo ? 'Edit memo' : 'New memo'}</DialogTitle>
        <DialogDescription>{memo ? 'Changes show for everyone straight away.' : 'Everyone in the workspace is notified when you post.'}</DialogDescription>
        <form className="memo-form" onSubmit={submit}>
          <label>Title<input type="text" value={title} maxLength={160} onChange={event => setTitle(event.target.value)} autoFocus required /></label>
          <label>Memo<textarea value={body} maxLength={5000} rows={8} onChange={event => setBody(event.target.value)} required /></label>
          <label>Show as a banner for
            <select value={bannerDays} onChange={event => setBannerDays(event.target.value)}>
              {BANNER_CHOICES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {error && <p className="memo-error" role="alert">{error}</p>}
          <div className="memo-actions">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" loading={saving}>{memo ? 'Save changes' : 'Post memo'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MemoReader({ memo, canChange, onEdit, onArchive, onClose }) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const archive = async () => {
    setError('')
    try { await onArchive(memo); onClose() } catch (archiveError) { setError(archiveError.message) }
  }
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="memo-dialog">
        <DialogTitle>{memo.title}</DialogTitle>
        <DialogDescription>{memo.author_name} - {day(memo.created_at)}</DialogDescription>
        <div className="memo-body">{memo.body}</div>
        {error && <p className="memo-error" role="alert">{error}</p>}
        {canChange && (confirming
          ? <div className="memo-actions"><span>Archive this memo? It disappears for everyone.</span><Button type="button" variant="secondary" onClick={() => setConfirming(false)}>Keep it</Button><Button type="button" variant="destructive" onClick={archive}>Archive memo</Button></div>
          : <div className="memo-actions"><Button type="button" variant="secondary" onClick={() => onEdit(memo)}><Pencil size={14} aria-hidden="true" /> Edit</Button><Button type="button" variant="secondary" onClick={() => setConfirming(true)}><Trash2 size={14} aria-hidden="true" /> Archive</Button></div>)}
      </DialogContent>
    </Dialog>
  )
}

export default function MemosView({ workspaceId, currentUserId, role }) {
  const { memos, canPost, loaded, error, post, update, archive } = useMemos(workspaceId)
  const [openId, setOpenId] = useState(null)
  const [editing, setEditing] = useState(null) // null | 'new' | a memo

  // A memo notification or the banner asks for a particular memo to be opened.
  useEffect(() => {
    const claim = () => { const id = takePendingMemo(); if (id) setOpenId(id) }
    claim()
    window.addEventListener(OPEN_MEMO_EVENT, claim)
    return () => window.removeEventListener(OPEN_MEMO_EVENT, claim)
  }, [])

  const opened = memos.find(memo => memo.id === openId) || null
  const canChange = memo => canPost && (memo.author_id === currentUserId || role === 'owner')

  return (
    <section className="workspace-view memos-view">
      <WorkspaceViewHeading
        eyebrow="Collaborate"
        title="Memos"
        subtitle="Announcements for the whole workspace."
        action={canPost ? 'New memo' : undefined}
        icon={Plus}
        onAction={() => setEditing('new')}
      />
      {error && <p className="memo-error" role="alert">{error}</p>}
      {!loaded ? <p className="memo-empty" role="status">Loading memos...</p>
        : memos.length ? (
          <div className="memo-list">
            {memos.map(memo => (
              <article key={memo.id} className="memo-card">
                <span className="memo-card-icon" aria-hidden="true"><Megaphone size={18} /></span>
                <div className="memo-card-main">
                  <button type="button" className="memo-card-title" onClick={() => setOpenId(memo.id)}>{memo.title}</button>
                  <p className="memo-card-meta">{memo.author_name} - {day(memo.created_at)}{memo.banner_active ? ' - showing as a banner' : ''}</p>
                  <p className="memo-card-preview">{memo.body}</p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="memo-empty"><Megaphone size={22} aria-hidden="true" /><strong>No memos yet</strong><p>{canPost ? 'Post the first announcement for your team.' : 'Announcements from your managers will appear here.'}</p></div>
        )}
      {opened && !editing && <MemoReader memo={opened} canChange={canChange(opened)} onEdit={memo => setEditing(memo)} onArchive={memo => archive(memo.id)} onClose={() => setOpenId(null)} />}
      {editing && <MemoForm memo={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSave={fields => (editing === 'new' ? post(fields) : update(editing.id, fields))} />}
    </section>
  )
}
