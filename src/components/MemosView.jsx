import React, { useEffect, useState } from 'react'
import { Megaphone, Pencil, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from './ui/button.jsx'
import { AppSelect } from './ui/select.jsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog.jsx'
import { WorkspaceViewHeading } from './workspace-ui.jsx'
import RequestsPanel from './RequestsPanel.jsx'
import { workspaceCall } from '../lib/workspace-api.js'
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
  const [kind, setKind] = useState(memo?.kind || 'memo')
  const [dueDate, setDueDate] = useState(memo?.due_date || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async event => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await onSave({ title, body, banner_days: Number(bannerDays), ...(memo ? {} : { kind }), ...(kind === 'request' ? { due_date: dueDate || null } : {}) })
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
          {!memo && <label>Type
            <AppSelect value={kind} aria-label="Type" className="form-select" onChange={event => setKind(event.target.value)}>
              <option value="memo">Announcement</option>
              <option value="request">Ask the team for a response</option>
            </AppSelect>
          </label>}
          <label>Title<input type="text" value={title} maxLength={160} onChange={event => setTitle(event.target.value)} autoFocus required /></label>
          <label>Memo<textarea value={body} maxLength={5000} rows={8} onChange={event => setBody(event.target.value)} required /></label>
          {kind === 'request' && <label>Answers needed by (optional)<input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></label>}
          <label>Show as a banner for
            <AppSelect value={bannerDays} aria-label="Show as a banner for" className="form-select" onChange={event => setBannerDays(event.target.value)}>
              {BANNER_CHOICES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </AppSelect>
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

function ResponseBox({ memo, onRespond }) {
  const [note, setNote] = useState(memo.my_response?.note || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const send = async () => {
    setBusy(true)
    setError('')
    try { await onRespond(memo.id, note) } catch (sendError) { setError(sendError.message) } finally { setBusy(false) }
  }
  return (
    <div className="memo-response">
      {memo.my_response && <p className="memo-card-meta">You answered on {day(memo.my_response.created_at)}. You can change your answer.</p>}
      <label>Your answer (optional)<textarea value={note} rows={3} maxLength={2000} onChange={event => setNote(event.target.value)} /></label>
      {error && <p className="memo-error" role="alert">{error}</p>}
      <div className="memo-actions"><Button type="button" loading={busy} onClick={send}>{memo.my_response ? 'Update answer' : 'Mark as done'}</Button></div>
    </div>
  )
}

function ResponseList({ memo }) {
  return (
    <div className="memo-responses">
      <h3>{memo.responses.length} answered, {memo.waiting.length} waiting</h3>
      {memo.responses.map(item => <p key={item.user_id}><strong>{item.name}</strong>{item.note ? `: ${item.note}` : ' - done'}</p>)}
      {memo.waiting.length > 0 && <p className="memo-card-meta">Still to answer: {memo.waiting.map(item => item.name).join(', ')}</p>}
    </div>
  )
}

function MemoReader({ memo, canChange, isAuthor, onRespond, onEdit, onArchive, onClose }) {
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
        {memo.kind === 'request' && memo.due_date && <p className="memo-card-meta">Answers needed by {day(`${memo.due_date}T00:00:00`)}</p>}
        {memo.kind === 'request' && !isAuthor && <ResponseBox memo={memo} onRespond={onRespond} />}
        {memo.kind === 'request' && memo.responses && <ResponseList memo={memo} />}
        {error && <p className="memo-error" role="alert">{error}</p>}
        {canChange && (confirming
          ? <div className="memo-actions"><span>Archive this memo? It disappears for everyone.</span><Button type="button" variant="secondary" onClick={() => setConfirming(false)}>Keep it</Button><Button type="button" variant="destructive" onClick={archive}>Archive memo</Button></div>
          : <div className="memo-actions"><Button type="button" variant="secondary" onClick={() => onEdit(memo)}><Pencil size={14} aria-hidden="true" /> Edit</Button><Button type="button" variant="secondary" onClick={() => setConfirming(true)}><Trash2 size={14} aria-hidden="true" /> Archive</Button></div>)}
      </DialogContent>
    </Dialog>
  )
}

// Memos that were archived, kept out of the main list and read here. Loaded when the
// history is opened, so the page stays light. A poster can put one back.
function MemoHistory({ workspaceId, canRestore, onOpen, version }) {
  const [items, setItems] = useState(null)
  const [opened, setOpened] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!opened) return
    workspaceCall(workspaceId, 'memos/?archived=1', 'GET').then(data => setItems(data.memos || [])).catch(loadError => setError(loadError.message))
  }, [opened, workspaceId, version])
  const restore = async memo => {
    try {
      await workspaceCall(workspaceId, `memos/${memo.id}/`, 'PATCH', { archived: false })
      setItems(current => current.filter(item => item.id !== memo.id))
      toast.success('Memo restored.')
      window.dispatchEvent(new Event('workspace:memos-changed'))
    } catch (restoreError) {
      setError(restoreError.message)
    }
  }
  return (
    <details className="history-block" onToggle={event => setOpened(event.currentTarget.open)}>
      <summary>History: archived memos{items ? ` (${items.length})` : ''}</summary>
      {error && <p className="memo-error" role="alert">{error}</p>}
      {items && !items.length && <p className="memo-empty-inline">No archived memos.</p>}
      {(items || []).map(memo => (
        <p className="leave-away" key={memo.id}>
          <button type="button" className="memo-card-title" onClick={() => onOpen(memo)}>{memo.title}</button> - {memo.author_name}, {day(memo.created_at)}
          {canRestore && <button type="button" className="history-restore" onClick={() => restore(memo)} aria-label={`Restore ${memo.title}`}>Restore</button>}
        </p>
      ))}
    </details>
  )
}

export default function MemosView({ workspaceId, currentUserId, role }) {
  const { memos, canPost, loaded, error, post, update, archive, respond } = useMemos(workspaceId)
  const [tab, setTab] = useState('memos')
  const [historyMemo, setHistoryMemo] = useState(null)
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
        title="Memos/Requests"
        subtitle="Announcements for the whole workspace, and requests to and from your managers."
        action={canPost && tab === 'memos' ? 'New memo' : undefined}
        icon={Plus}
        onAction={() => setEditing('new')}
      />
      <div className="memo-tabs" role="tablist" aria-label="Memos and requests">
        <button type="button" role="tab" aria-selected={tab === 'memos'} className={tab === 'memos' ? 'is-active' : ''} onClick={() => setTab('memos')}>Memos</button>
        <button type="button" role="tab" aria-selected={tab === 'requests'} className={tab === 'requests' ? 'is-active' : ''} onClick={() => setTab('requests')}>Requests</button>
      </div>
      {tab === 'requests' && <RequestsPanel workspaceId={workspaceId} currentUserId={currentUserId} />}
      {tab === 'memos' && error && <p className="memo-error" role="alert">{error}</p>}
      {tab === 'memos' && (!loaded ? <p className="memo-empty" role="status">Loading memos...</p>
        : memos.length ? (
          <div className="memo-list">
            {memos.map(memo => (
              <article key={memo.id} className="memo-card">
                <span className="memo-card-icon" aria-hidden="true"><Megaphone size={18} /></span>
                <div className="memo-card-main">
                  <button type="button" className="memo-card-title" onClick={() => setOpenId(memo.id)}>{memo.title}</button>
                  <p className="memo-card-meta">{memo.author_name} - {day(memo.created_at)}{memo.banner_active ? ' - showing as a banner' : ''}</p>
                  {memo.kind === 'request' && <p className="memo-card-badge">{memo.author_id === currentUserId ? `Request - ${memo.response_count} answered${memo.waiting ? `, ${memo.waiting.length} waiting` : ''}` : memo.my_response ? 'Request - you answered' : `Request - needs your answer${memo.due_date ? ` by ${day(`${memo.due_date}T00:00:00`)}` : ''}`}</p>}
                  <p className="memo-card-preview">{memo.body}</p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="memo-empty"><Megaphone size={22} aria-hidden="true" /><strong>No memos yet</strong><p>{canPost ? 'Post the first announcement for your team.' : 'Announcements from your managers will appear here.'}</p></div>
        ))}
      {tab === 'memos' && loaded && <MemoHistory workspaceId={workspaceId} canRestore={canPost} onOpen={memo => setHistoryMemo(memo)} version={memos.length} />}
      {historyMemo && <MemoReader memo={historyMemo} canChange={false} isAuthor onRespond={() => {}} onEdit={() => {}} onArchive={() => {}} onClose={() => setHistoryMemo(null)} />}
      {opened && !editing && <MemoReader memo={opened} isAuthor={opened.author_id === currentUserId} onRespond={async (id, note) => { const result = await respond(id, note); toast.success('Your answer is saved.'); return result }} canChange={canChange(opened)} onEdit={memo => setEditing(memo)} onArchive={async memo => { await archive(memo.id); toast.success('Memo archived.') }} onClose={() => setOpenId(null)} />}
      {editing && <MemoForm memo={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSave={async fields => { if (editing === 'new') { await post(fields); toast.success(fields.kind === 'request' ? 'Request posted to the team.' : 'Memo posted.') } else { await update(editing.id, fields); toast.success('Memo updated.') } }} />}
    </section>
  )
}
