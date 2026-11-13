import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { CalendarOff, Check, X } from 'lucide-react'
import { Button } from './ui/button.jsx'
import { AppSelect } from './ui/select.jsx'
import { WorkspaceViewHeading } from './workspace-ui.jsx'
import { fmtDate, useWorkspaceCall } from '../lib/workspace-api.js'
import { announceCountsChanged } from '../lib/use-nav-counts.js'

// Time off. A request goes to the people who can approve it (a manager's goes to
// an owner). Everyone can see who is away and when; only the person and their
// approvers see the kind of leave and the note. The page changes with the role:
// staff ask and watch, managers also decide for members, owners also decide for
// managers and see what was decided lately.
const KINDS = [['annual', 'Annual leave'], ['sick', 'Sick leave'], ['other', 'Other absence']]
const KIND_LABEL = Object.fromEntries(KINDS)
const STATUS_LABEL = { pending: 'Waiting', approved: 'Approved', declined: 'Declined', cancelled: 'Withdrawn' }
const ROLE_LINE = {
  member: 'Request leave. A manager approves it, and everyone can see who is away so work can be planned around it.',
  manager: 'Request your own leave (an owner approves it) and approve leave for members.',
  owner: 'Approve leave for managers and members. Your own time off is recorded as approved straight away.',
}

// Over, declined or withdrawn leave goes to History so the page shows what is live.
const isHistory = (item, todayIso) => item.status === 'declined' || item.status === 'cancelled' || item.end_date < todayIso

export function describeSpan(item) {
  const first = fmtDate(item.start_date, { dateStyle: 'medium' })
  const last = fmtDate(item.end_date, { dateStyle: 'medium' })
  const halves = [item.start_half && 'starts at midday', item.end_half && 'ends at midday'].filter(Boolean)
  const span = item.start_date === item.end_date ? first : `${first} to ${last}`
  return halves.length ? `${span} (${halves.join(', ')})` : span
}

function LeaveForm({ onSend, role }) {
  const [kind, setKind] = useState('annual')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [startHalf, setStartHalf] = useState(false)
  const [endHalf, setEndHalf] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async event => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onSend({ kind, start_date: start, end_date: end || start, start_half: startHalf, end_half: endHalf, note })
      setStart(''); setEnd(''); setNote(''); setStartHalf(false); setEndHalf(false)
    } catch (sendError) {
      setError(sendError.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="request-form" onSubmit={submit} aria-label="Request time off">
      <h2>Request time off</h2>
      <label>Type
        <AppSelect value={kind} onChange={event => setKind(event.target.value)} aria-label="Type" className="form-select">{KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</AppSelect>
      </label>
      <div className="leave-dates">
        <label>From<input type="date" value={start} onChange={event => { setStart(event.target.value); if (!end) setEnd(event.target.value) }} required /></label>
        <label>To<input type="date" value={end} min={start || undefined} onChange={event => setEnd(event.target.value)} required /></label>
      </div>
      <label className="leave-check"><input type="checkbox" checked={startHalf} onChange={event => setStartHalf(event.target.checked)} /> First day starts at midday</label>
      <label className="leave-check"><input type="checkbox" checked={endHalf} onChange={event => setEndHalf(event.target.checked)} /> Last day ends at midday</label>
      <label>Note (optional, only you and approvers see it)<textarea value={note} rows={2} maxLength={1000} onChange={event => setNote(event.target.value)} /></label>
      {role === 'owner' && <p className="memo-card-meta">As an owner, your time off is recorded as approved straight away.</p>}
      {role === 'manager' && <p className="memo-card-meta">An owner will approve this.</p>}
      {error && <p className="memo-error" role="alert">{error}</p>}
      <div className="memo-actions"><Button type="submit" loading={busy}>Send request</Button></div>
    </form>
  )
}

function DecideCard({ item, onDecide }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const decide = async decision => {
    setBusy(true)
    setError('')
    try { await onDecide(item, decision, note) } catch (decideError) { setError(decideError.message); setBusy(false) }
  }
  return (
    <article className="request-card">
      <header><strong>{item.user_name}</strong><span className="request-status is-pending">{KIND_LABEL[item.kind]}</span></header>
      <p className="memo-card-meta">{describeSpan(item)}</p>
      {item.note && <p className="request-details">{item.note}</p>}
      {item.overlapping?.length > 0 && (
        <p className="leave-overlap" role="note">Also away or waiting on these dates: {item.overlapping.map(other => `${other.user_name} (${describeSpan(other)}${other.status === 'pending' ? ', waiting' : ''})`).join('; ')}</p>
      )}
      {error && <p className="memo-error" role="alert">{error}</p>}
      <div className="request-decide">
        <input type="text" aria-label={`Reply to ${item.user_name}`} placeholder="Add a reply (optional)" value={note} maxLength={1000} onChange={event => setNote(event.target.value)} />
        <Button type="button" size="sm" disabled={busy} onClick={() => decide('approved')}><Check size={14} aria-hidden="true" /> Approve</Button>
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => decide('declined')}><X size={14} aria-hidden="true" /> Decline</Button>
      </div>
    </article>
  )
}

export default function LeaveView({ workspaceId, role }) {
  const call = useWorkspaceCall(workspaceId)
  const [data, setData] = useState({ mine: [], team: [], to_decide: [], recent: [], can_approve: false })
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setData({ mine: [], team: [], to_decide: [], recent: [], can_approve: false, ...(await call('time-off/', 'GET')) })
      setError('')
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoaded(true)
    }
  }, [call])
  useEffect(() => { load() }, [load])

  const send = async fields => {
    const result = await call('time-off/', 'POST', fields)
    toast.success(result.leave?.status === 'approved' ? 'Time off recorded.' : 'Request sent. You will be told when it is decided.')
    await load()
    announceCountsChanged()
  }
  const decide = async (item, decision, note) => {
    await call(`time-off/${item.id}/`, 'PATCH', { decision, note })
    toast.success(decision === 'approved' ? `Approved ${item.user_name}'s leave.` : `Declined ${item.user_name}'s leave.`)
    await load()
    announceCountsChanged()
  }
  const withdraw = async item => {
    try {
      await call(`time-off/${item.id}/`, 'PATCH', { decision: 'cancel' })
      toast.success('Time off withdrawn.')
      await load()
    } catch (withdrawError) {
      setError(withdrawError.message)
    }
  }
  const effectiveRole = role || data.role || 'member'
  const todayIso = new Date().toISOString().slice(0, 10)

  return (
    <section className="workspace-view leave-view">
      <WorkspaceViewHeading eyebrow="People" title="Time off" subtitle={ROLE_LINE[effectiveRole] || ROLE_LINE.member} />
      {error && <p className="memo-error" role="alert">{error}</p>}
      {data.can_approve && (
        <section className="leave-decide" aria-label="Leave to decide">
          <h2>To decide{data.to_decide.length ? ` (${data.to_decide.length})` : ''}</h2>
          {loaded && !data.to_decide.length && <p className="memo-empty-inline">Nothing is waiting for you.</p>}
          <div className="leave-decide-grid">{data.to_decide.map(item => <DecideCard key={item.id} item={item} onDecide={decide} />)}</div>
        </section>
      )}
      <div className="leave-layout">
        <LeaveForm onSend={send} role={effectiveRole} />
        <div className="leave-side">
          <section aria-label="My time off">
            <h2>My time off</h2>
            {loaded && !data.mine.length && <p className="memo-empty-inline"><CalendarOff size={16} aria-hidden="true" /> You have not asked for any time off.</p>}
            {data.mine.filter(item => !isHistory(item, todayIso)).map(item => (
              <article className="request-card" key={item.id}>
                <header><strong>{KIND_LABEL[item.kind]}</strong><span className={`request-status is-${item.status}`}>{STATUS_LABEL[item.status]}</span></header>
                <p className="memo-card-meta">{describeSpan(item)}</p>
                {item.reviewer_name && item.status !== 'pending' && <p className="memo-card-meta">{STATUS_LABEL[item.status]} by {item.reviewer_name}{item.review_note ? `: ${item.review_note}` : ''}</p>}
                {(item.status === 'pending' || item.status === 'approved') && item.end_date >= todayIso && (
                  <div className="memo-actions"><Button type="button" variant="secondary" size="sm" onClick={() => withdraw(item)}>Withdraw</Button></div>
                )}
              </article>
            ))}
            {data.mine.some(item => isHistory(item, todayIso)) && (
              <details className="history-block">
                <summary>History ({data.mine.filter(item => isHistory(item, todayIso)).length})</summary>
                {data.mine.filter(item => isHistory(item, todayIso)).map(item => (
                  <p className="leave-away" key={item.id}>
                    <strong>{KIND_LABEL[item.kind]}</strong> - {describeSpan(item)} <span className={`request-status is-${item.status}`}>{STATUS_LABEL[item.status]}</span>
                  </p>
                ))}
              </details>
            )}
          </section>
          <section aria-label="Who is away">
            <h2>Who is away</h2>
            {loaded && !data.team.length && <p className="memo-empty-inline">Nobody has approved time off coming up.</p>}
            {data.team.map(item => (
              <p className="leave-away" key={item.id}><strong>{item.user_name}</strong> - {describeSpan(item)}</p>
            ))}
          </section>
          {data.can_approve && (
            <section aria-label="Decided recently">
              <details className="history-block">
                <summary>History: decided in the last 60 days ({data.recent.length})</summary>
                {!data.recent.length && <p className="memo-empty-inline">Nothing decided in the last 60 days.</p>}
                {data.recent.map(item => (
                  <p className="leave-away" key={item.id}>
                    <strong>{item.user_name}</strong> - {KIND_LABEL[item.kind]}, {describeSpan(item)} <span className={`request-status is-${item.status}`}>{STATUS_LABEL[item.status]}</span>
                  </p>
                ))}
              </details>
            </section>
          )}
        </div>
      </div>
    </section>
  )
}
