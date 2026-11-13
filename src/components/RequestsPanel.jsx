import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Check, Inbox, X } from 'lucide-react'
import { Button } from './ui/button.jsx'
import { fmtDate, useWorkspaceCall } from '../lib/workspace-api.js'
import { announceCountsChanged } from '../lib/use-nav-counts.js'

// Requests from members to the people who run the workspace. A member sees and
// manages only their own; people who can answer requests see everyone's.
const STATUS_LABEL = { pending: 'Waiting', approved: 'Approved', declined: 'Declined', cancelled: 'Withdrawn' }

function NewRequestForm({ onSend }) {
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [neededBy, setNeededBy] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async event => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onSend({ title, details, needed_by: neededBy || null })
      setTitle(''); setDetails(''); setNeededBy('')
    } catch (sendError) {
      setError(sendError.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="request-form" onSubmit={submit} aria-label="New request">
      <h2>Ask your managers for something</h2>
      <label>What do you need?<input type="text" value={title} maxLength={160} onChange={event => setTitle(event.target.value)} required /></label>
      <label>Details (optional)<textarea value={details} rows={3} maxLength={3000} onChange={event => setDetails(event.target.value)} /></label>
      <label>Needed by (optional)<input type="date" value={neededBy} onChange={event => setNeededBy(event.target.value)} /></label>
      {error && <p className="memo-error" role="alert">{error}</p>}
      <div className="memo-actions"><Button type="submit" loading={busy}>Send request</Button></div>
    </form>
  )
}

function RequestCard({ item, mine, canManage, onDecide }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const decide = async decision => {
    setBusy(true)
    setError('')
    try { await onDecide(item.id, decision, note) } catch (decideError) { setError(decideError.message); setBusy(false) }
  }
  return (
    <article className="request-card">
      <header>
        <strong>{item.title}</strong>
        <span className={`request-status is-${item.status}`}>{STATUS_LABEL[item.status]}</span>
      </header>
      <p className="memo-card-meta">{mine ? 'You' : item.requester_name} - {fmtDate(item.created_at.slice(0, 10))}{item.needed_by ? ` - needed by ${fmtDate(item.needed_by)}` : ''}</p>
      {item.details && <p className="request-details">{item.details}</p>}
      {item.status !== 'pending' && item.reviewer_name && <p className="memo-card-meta">{STATUS_LABEL[item.status]} by {item.reviewer_name}{item.review_note ? `: ${item.review_note}` : ''}</p>}
      {error && <p className="memo-error" role="alert">{error}</p>}
      {item.status === 'pending' && mine && <div className="memo-actions"><Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => decide('cancel')}>Withdraw</Button></div>}
      {item.status === 'pending' && !mine && canManage && (
        <div className="request-decide">
          <input type="text" aria-label={`Reply to ${item.requester_name}`} placeholder="Add a reply (optional)" value={note} maxLength={1000} onChange={event => setNote(event.target.value)} />
          <Button type="button" size="sm" disabled={busy} onClick={() => decide('approved')}><Check size={14} aria-hidden="true" /> Approve</Button>
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => decide('declined')}><X size={14} aria-hidden="true" /> Decline</Button>
        </div>
      )}
    </article>
  )
}

export default function RequestsPanel({ workspaceId, currentUserId, onChanged }) {
  const call = useWorkspaceCall(workspaceId)
  const [items, setItems] = useState([])
  const [canManage, setCanManage] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await call('requests/', 'GET')
      setItems(data.requests || [])
      setCanManage(Boolean(data.can_manage))
      setError('')
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoaded(true)
    }
  }, [call])

  useEffect(() => { load() }, [load])

  const send = async fields => { await call('requests/', 'POST', fields); toast.success('Request sent. You will be told when it is answered.'); await load(); announceCountsChanged(); onChanged?.() }
  const decide = async (id, decision, note) => {
    await call(`requests/${id}/`, 'PATCH', { decision, note })
    toast.success({ approved: 'Request approved.', declined: 'Request declined.', cancel: 'Request withdrawn.' }[decision] || 'Saved.')
    await load()
    announceCountsChanged()
    onChanged?.()
  }

  const mineItems = items.filter(item => item.requester_id === currentUserId)
  const others = items.filter(item => item.requester_id !== currentUserId)
  const waiting = others.filter(item => item.status === 'pending')
  const answered = others.filter(item => item.status !== 'pending')

  return (
    <div className="requests-wrap">
      {error && <p className="memo-error" role="alert">{error}</p>}
      {canManage && (
        <section className="leave-decide" aria-label="Requests from the team">
          <h2>Inbox: requests from the team{waiting.length ? ` (${waiting.length} waiting)` : ''}</h2>
          {loaded && !others.length && <p className="memo-empty-inline">Nothing from your team yet.</p>}
          <div className="leave-decide-grid">{waiting.map(item => <RequestCard key={item.id} item={item} canManage onDecide={decide} />)}</div>
          {answered.length > 0 && (
            <details className="history-block">
              <summary>History ({answered.length})</summary>
              <div className="leave-decide-grid">{answered.map(item => <RequestCard key={item.id} item={item} canManage onDecide={decide} />)}</div>
            </details>
          )}
        </section>
      )}
      <div className="leave-layout">
        <NewRequestForm onSend={send} />
        <div className="leave-side">
          <section aria-label="My requests">
            <h2>My requests</h2>
            {loaded && !mineItems.length && <p className="memo-empty-inline"><Inbox size={16} aria-hidden="true" /> You have not asked for anything yet.</p>}
            {mineItems.filter(item => item.status === 'pending').map(item => <RequestCard key={item.id} item={item} mine onDecide={decide} />)}
            {mineItems.some(item => item.status !== 'pending') && (
              <details className="history-block">
                <summary>History ({mineItems.filter(item => item.status !== 'pending').length})</summary>
                {mineItems.filter(item => item.status !== 'pending').map(item => <RequestCard key={item.id} item={item} mine onDecide={decide} />)}
              </details>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
