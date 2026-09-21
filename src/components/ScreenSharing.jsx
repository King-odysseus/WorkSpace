import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, CheckCircle2, Clock3, Download, MonitorUp, ShieldCheck, Trash2, Users, X } from 'lucide-react'
import Avatar from './Avatar.jsx'
import { Card } from './ui/card.jsx'
import { AppSelect } from './ui/select.jsx'
import { WorkspaceViewHeading } from './workspace-ui.jsx'
import { formatDateTime as formatTimestamp, getCsrfToken } from '../lib/workspace-format.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

async function apiRequest(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const headers = { ...(options.headers || {}) }
  if (!SAFE_METHODS.has(method)) headers['X-CSRFToken'] = await getCsrfToken()
  const response = await fetch(url, { credentials: 'include', ...options, headers })
  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await response.json() : null
  if (!response.ok) throw new Error(data?.error || 'The request could not be completed.')
  return data
}

// The shared format, plus the dash this screen shows where a timestamp is missing.
const formatDateTime = value => value ? formatTimestamp(value) : '-'

const SESSION_STATUS_LABELS = {
  pending: 'Waiting for consent',
  active: 'Active session',
  declined: 'Declined',
  cancelled: 'Cancelled',
  stopped: 'Stopped',
  expired: 'Expired',
}

const formatDuration = session => {
  if (!session) return '-'
  const startValue = session.started_at || session.accepted_at || session.created_at
  if (!startValue) return '-'
  const start = new Date(startValue)
  const end = session.ended_at ? new Date(session.ended_at) : new Date()
  const seconds = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return hours ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m ${String(remainder).padStart(2, '0')}s`
}

const sessionMember = (members, id, name = '', email = '') => members.find(member => String(member.id) === String(id)) || {
  id,
  first_name: name,
  last_name: '',
  email,
  avatar_url: '',
}

const memberName = member => [member?.first_name, member?.last_name].filter(Boolean).join(' ') || member?.email || 'Former member'

export function ScreenShareControl({ workspaceId, currentUserId, targetSessionId = null }) {
  const [pending, setPending] = useState(null)
  const [activeSession, setActiveSession] = useState(null)
  const [error, setError] = useState('')
  const [responding, setResponding] = useState(false)
  const streamRef = useRef(null)
  const activeSessionRef = useRef(null)
  const videoRef = useRef(null)
  const captureTimerRef = useRef(null)
  const heartbeatTimerRef = useRef(null)
  const stoppingRef = useRef(false)
  const workspaceRef = useRef(workspaceId)
  const consentRef = useRef(null)
  const declineRef = useRef(null)

  const loadSessions = useCallback(async () => {
    if (!workspaceId) return
    try {
      const data = await apiRequest(`/api/workspaces/${workspaceId}/screen-sharing/sessions/?scope=mine`)
      const mine = data.sessions.filter(item => String(item.employee_id) === String(currentUserId))
      const target = targetSessionId && mine.find(item => String(item.id) === String(targetSessionId))
      setPending(target || mine.find(item => item.status === 'pending') || null)
      if (!streamRef.current) setActiveSession(null)
    } catch (_) {
      // The main workspace error surface handles connectivity; this control stays quiet.
    }
  }, [workspaceId, currentUserId, targetSessionId])

  useEffect(() => {
    loadSessions()
    const timer = window.setInterval(loadSessions, 8000)
    return () => window.clearInterval(timer)
  }, [loadSessions])

  const clearTimers = () => {
    window.clearInterval(captureTimerRef.current)
    window.clearInterval(heartbeatTimerRef.current)
    captureTimerRef.current = null
    heartbeatTimerRef.current = null
  }

  const stopLocal = useCallback(async (notifyServer = true) => {
    if (stoppingRef.current) return
    stoppingRef.current = true
    clearTimers()
    const session = activeSessionRef.current
    const stream = streamRef.current
    streamRef.current = null
    activeSessionRef.current = null
    stream?.getTracks().forEach(track => track.stop())
    if (videoRef.current) videoRef.current.srcObject = null
    setActiveSession(null)
    if (notifyServer && session) {
      try {
        await apiRequest(`/api/workspaces/${workspaceId}/screen-sharing/sessions/${session.id}/`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stop' }),
        })
      } catch (requestError) {
        if (!/not active/i.test(requestError.message)) setError(requestError.message)
      }
    }
    stoppingRef.current = false
    loadSessions()
  }, [loadSessions, workspaceId])

  useEffect(() => () => {
    clearTimers()
    streamRef.current?.getTracks().forEach(track => track.stop())
  }, [])

  useEffect(() => {
    const previousWorkspaceId = workspaceRef.current
    workspaceRef.current = workspaceId
    if (previousWorkspaceId === workspaceId || !streamRef.current) return
    const session = activeSessionRef.current
    stoppingRef.current = true
    clearTimers()
    streamRef.current.getTracks().forEach(track => track.stop())
    streamRef.current = null
    activeSessionRef.current = null
    setActiveSession(null)
    if (session) apiRequest(`/api/workspaces/${previousWorkspaceId}/screen-sharing/sessions/${session.id}/`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stop' }),
    }).finally(() => { stoppingRef.current = false })
  }, [workspaceId])

  const uploadCapture = useCallback(async session => {
    const video = videoRef.current
    if (!video || !streamRef.current || video.readyState < 2) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    if (!canvas.width || !canvas.height) return
    canvas.getContext('2d', { alpha: false }).drawImage(video, 0, 0)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.75))
    if (!blob || blob.size > 5 * 1024 * 1024) return
    const form = new FormData()
    form.append('capture', blob, `screen-${Date.now()}.jpg`)
    try {
      await apiRequest(`/api/workspaces/${workspaceId}/screen-sharing/sessions/${session.id}/captures/`, { method: 'POST', body: form })
    } catch (requestError) {
      if (!/not due yet/i.test(requestError.message)) setError(requestError.message)
    }
  }, [workspaceId])

  const accept = async () => {
    setError('')
    setResponding(true)
    let stream
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen sharing is not supported by this browser.')
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 1, max: 2 } }, audio: false })
      const data = await apiRequest(`/api/workspaces/${workspaceId}/screen-sharing/sessions/${pending.id}/`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'accept' }),
      })
      streamRef.current = stream
      activeSessionRef.current = data.session
      setPending(null)
      setActiveSession(data.session)
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      const displayTrack = stream.getVideoTracks()[0]
      displayTrack?.addEventListener('ended', () => stopLocal(true), { once: true })
      if (displayTrack?.readyState === 'ended') {
        await stopLocal(true)
        return
      }
      heartbeatTimerRef.current = window.setInterval(async () => {
        try {
          await apiRequest(`/api/workspaces/${workspaceId}/screen-sharing/sessions/${data.session.id}/heartbeat/`, { method: 'POST' })
        } catch (_) {
          stopLocal(false)
        }
      }, 20000)
      uploadCapture(data.session)
      captureTimerRef.current = window.setInterval(() => uploadCapture(data.session), data.session.capture_interval_seconds * 1000)
    } catch (requestError) {
      stream?.getTracks().forEach(track => track.stop())
      setError(requestError.name === 'NotAllowedError' ? 'Screen sharing was not started. You can decline the request or try again.' : requestError.message)
    } finally {
      setResponding(false)
    }
  }

  useEffect(() => {
    if (!pending) return undefined
    const card = consentRef.current
    const previouslyFocused = document.activeElement
    declineRef.current?.focus()
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        declineRef.current?.click()
        return
      }
      if (event.key !== 'Tab' || !card) return
      const focusable = [...card.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(node => !node.disabled)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [pending])

  const decline = async () => {
    setResponding(true)
    setError('')
    try {
      await apiRequest(`/api/workspaces/${workspaceId}/screen-sharing/sessions/${pending.id}/`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'decline' }),
      })
      setPending(null)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setResponding(false)
    }
  }

  return <>
    <video ref={videoRef} muted playsInline className="screen-share-video-source" aria-hidden="true" />
    {pending && <div className="screen-share-consent-backdrop" role="dialog" aria-modal="true" aria-labelledby="screen-share-request-title">
      <Card className="screen-share-consent-card" ref={consentRef}>
        <div className="screen-share-consent-icon"><MonitorUp size={24} /></div>
        <div>
          <p className="eyebrow">Explicit consent required</p>
          <h2 id="screen-share-request-title">{pending.requested_by_name} wants you to share your screen</h2>
          {pending.message && <p className="screen-share-request-message">“{pending.message}”</p>}
          <div className="screen-share-policy-copy">{pending.policy_text}</div>
          <ul className="screen-share-assurances">
            <li>You choose a screen, window, or tab in the browser picker.</li>
            <li>No audio or webcam data is requested.</li>
            <li>You can stop sharing at any time.</li>
          </ul>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <div className="screen-share-actions">
            <button type="button" className="secondary-button" ref={declineRef} disabled={responding} onClick={decline}>Decline</button>
            <button type="button" className="primary-button" disabled={responding} onClick={accept}>{responding ? 'Opening browser picker…' : 'Choose what to share'}</button>
          </div>
        </div>
      </Card>
    </div>}
    {activeSession && <div className="screen-share-active" role="status" aria-live="polite">
      <span className="screen-share-live-dot" />
      <div><strong>Screen sharing active</strong><span>Screenshots every {activeSession.capture_interval_seconds}s · no audio or camera</span></div>
      <button type="button" onClick={() => stopLocal(true)}><X size={16} /> Stop sharing</button>
    </div>}
    {activeSession && error && <div className="screen-share-floating-error" role="alert">{error}</div>}
  </>
}

export default function ScreenSharingView({ workspaceId, members = [], currentUserId, role, targetSessionId = null }) {
  const canLead = ['owner', 'manager'].includes(role)
  const [policy, setPolicy] = useState(null)
  const [draftPolicy, setDraftPolicy] = useState(null)
  const [sessions, setSessions] = useState([])
  const [selectedSession, setSelectedSession] = useState(null)
  const [captures, setCaptures] = useState([])
  const [captureToDelete, setCaptureToDelete] = useState(null)
  const [employeeId, setEmployeeId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const canManagePolicy = Boolean(policy?.can_manage) || role === 'owner'
  const activeSession = sessions.find(session => session.status === 'active') || null
  const pendingSession = sessions.find(session => session.status === 'pending') || null
  const currentSession = activeSession || pendingSession
  const currentSubject = currentSession ? sessionMember(members, currentSession.employee_id, currentSession.employee_name, currentSession.employee_email) : null
  const currentRequester = currentSession ? sessionMember(members, currentSession.requested_by_id, currentSession.requested_by_name) : null
  const currentStatusLabel = currentSession ? (SESSION_STATUS_LABELS[currentSession.status] || currentSession.status) : 'No session running'
  const participants = currentSession
    ? [
        { ...currentSubject, role: 'Presenter', note: currentSession.status === 'active' ? 'Sharing now' : 'Waiting to share' },
        currentRequester && String(currentRequester.id) !== String(currentSubject?.id)
          ? { ...currentRequester, role: 'Requested by', note: formatDateTime(currentSession.created_at) }
          : null,
      ].filter(Boolean)
    : []

  const focusRequest = () => {
    const field = document.getElementById('screen-sharing-employee')
    document.getElementById('screen-sharing-request')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => field?.focus(), 250)
  }

  const refresh = useCallback(async () => {
    if (!workspaceId) return
    try {
      const [policyData, sessionData] = await Promise.all([
        apiRequest(`/api/workspaces/${workspaceId}/screen-sharing/policy/`),
        apiRequest(`/api/workspaces/${workspaceId}/screen-sharing/sessions/`),
      ])
      setPolicy(policyData.policy)
      setDraftPolicy(current => current || policyData.policy)
      setSessions(sessionData.sessions)
    } catch (requestError) {
      setError(requestError.message)
    }
  }, [workspaceId])

  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, 15000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const savePolicy = async event => {
    event.preventDefault()
    setSaving(true); setError('')
    try {
      const data = await apiRequest(`/api/workspaces/${workspaceId}/screen-sharing/policy/`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: draftPolicy.enabled, capture_interval_seconds: Number(draftPolicy.capture_interval_seconds), capture_retention_days: Number(draftPolicy.capture_retention_days), text: draftPolicy.text }),
      })
      setPolicy(data.policy); setDraftPolicy(data.policy)
      window.dispatchEvent(new CustomEvent('workspace:notice', { detail: 'Screen-sharing policy published.' }))
    } catch (requestError) { setError(requestError.message) } finally { setSaving(false) }
  }

  const requestShare = async event => {
    event.preventDefault(); setSaving(true); setError('')
    try {
      await apiRequest(`/api/workspaces/${workspaceId}/screen-sharing/sessions/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employee_id: Number(employeeId), message }),
      })
      setEmployeeId(''); setMessage(''); await refresh()
    } catch (requestError) { setError(requestError.message) } finally { setSaving(false) }
  }

  const loadCaptures = async session => {
    setSelectedSession(session); setError('')
    try {
      const data = await apiRequest(`/api/workspaces/${workspaceId}/screen-sharing/sessions/${session.id}/captures/`)
      setCaptures(data.captures)
    } catch (requestError) { setError(requestError.message) }
  }

  const cancelRequest = async session => {
    try {
      await apiRequest(`/api/workspaces/${workspaceId}/screen-sharing/sessions/${session.id}/`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) })
      await refresh()
    } catch (requestError) { setError(requestError.message) }
  }

  const deleteCapture = async capture => {
    setCaptureToDelete(capture)
  }

  useEffect(() => {
    if (!targetSessionId) return
    const target = sessions.find(session => String(session.id) === String(targetSessionId))
    if (target) loadCaptures(target)
  }, [sessions, targetSessionId])

  const confirmDeleteCapture = async () => {
    const capture = captureToDelete
    setCaptureToDelete(null)
    if (!capture) return
    try {
      await apiRequest(capture.view_url, { method: 'DELETE' })
      setCaptures(current => current.filter(item => item.id !== capture.id))
    } catch (requestError) { setError(requestError.message) }
  }

  return <section className="workspace-view screen-sharing-view">
    {captureToDelete && <div className="modal-backdrop" onMouseDown={() => setCaptureToDelete(null)}><form className="modal file-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="capture-delete-title" onSubmit={event => { event.preventDefault(); confirmDeleteCapture() }} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Screen sharing</p><h2 id="capture-delete-title">Delete screenshot?</h2></div><button type="button" className="close-button" onClick={() => setCaptureToDelete(null)} aria-label="Close delete dialog"><X size={18} /></button></div><p className="file-delete-copy">This screenshot will be permanently deleted. The action will be audited.</p><div className="file-delete-actions"><button type="button" className="secondary-button" onClick={() => setCaptureToDelete(null)}>Cancel</button><button type="submit" className="file-delete-confirm">Delete</button></div></form></div>}
    <WorkspaceViewHeading
      title="Screen sharing"
      subtitle="Start a collaborative viewing session, or manage one that is running."
      actions={canLead ? <button type="button" className="primary-button screen-sharing-start" onClick={focusRequest} disabled={!policy?.enabled} title={!policy?.enabled ? 'Enable and publish the policy before requesting screen sharing.' : 'Request screen sharing'}><MonitorUp size={16} /> Request sharing</button> : null}
    />
    {error && <p className="auth-error" role="alert">{error}</p>}

    <div className="screen-sharing-overview">
      <div className="screen-sharing-main-column">
        <Card className="screen-sharing-stage-card">
          <div className="screen-sharing-section-heading">
            <div><p className="eyebrow">Current session</p><h2>{activeSession ? 'Active session' : currentSession ? currentStatusLabel : 'No session running'}</h2></div>
            <span className={`screen-share-status status-${currentSession?.status || 'idle'}`}>{activeSession ? 'Live' : currentStatusLabel}</span>
          </div>
          <div className={`screen-sharing-stage-panel is-${currentSession?.status || 'idle'}`}>
            <div className="screen-sharing-stage-icon"><MonitorUp size={28} /></div>
            <strong>{activeSession ? 'Consent-based capture is active' : pendingSession ? 'Waiting for employee consent' : 'Start with a consent request'}</strong>
            <p>{activeSession ? 'WorkSpace receives consented screenshots, not a live video stream.' : pendingSession ? `${memberName(currentSubject)} chooses whether to share and selects the source in the browser picker.` : 'The employee always chooses the screen, window, or tab in the browser before capture begins.'}</p>
            <span className="screen-sharing-stage-note"><ShieldCheck size={14} /> No audio or camera data is requested</span>
          </div>
          <div className="screen-sharing-stage-meta">
            <div><span>Duration</span><strong>{formatDuration(currentSession)}</strong></div>
            <div><span>Capture cadence</span><strong>{currentSession ? `Every ${currentSession.capture_interval_seconds}s` : '-'}</strong></div>
            <div><span>Captures</span><strong>{currentSession ? currentSession.capture_count || 0 : '-'}</strong></div>
            <div><span>Policy version</span><strong>{currentSession ? `v${currentSession.policy_version}` : policy?.version ? `v${policy.version}` : '-'}</strong></div>
          </div>
          <div className="screen-sharing-stage-foot"><Activity size={15} /><span>{currentSession ? `Requested ${formatDateTime(currentSession.created_at)}` : 'Session history and consented captures appear below.'}</span></div>
        </Card>

        <Card className="screen-sharing-participants-card">
          <div className="screen-sharing-section-heading">
            <div><p className="eyebrow">Access</p><h2>Participants</h2></div>
            <span>{participants.length} {participants.length === 1 ? 'person' : 'people'}</span>
          </div>
          {participants.length ? <div className="screen-sharing-participant-list">{participants.map(participant => <div className="screen-sharing-participant" key={`${participant.id}-${participant.role}`}><Avatar name={memberName(participant)} avatarUrl={participant.avatar_url} presence={participant.presence} small /><span><strong>{memberName(participant)}</strong><small>{participant.email}</small></span><em>{participant.role}</em><b>{participant.note}</b></div>)}</div> : <div className="screen-sharing-inline-empty"><Users size={20} /><span>No participants until a session is requested.</span></div>}
        </Card>
      </div>

      <aside className="screen-sharing-rail">
        <Card className="screen-sharing-status-card">
          <div className="screen-sharing-section-heading"><div><p className="eyebrow">Session state</p><h2>Status</h2></div><span className={`screen-share-state-dot is-${activeSession ? 'active' : pendingSession ? 'pending' : 'idle'}`} /></div>
          <strong className="screen-sharing-state-title">{currentStatusLabel}</strong>
          <p>{activeSession ? 'The employee has approved capture and can stop at any time.' : pendingSession ? 'The request expires if it is not accepted within ten minutes.' : policy?.enabled ? 'Screen-sharing requests are available to workspace leaders.' : 'Screen sharing is disabled until an owner enables and publishes the policy.'}</p>
          <dl className="screen-sharing-status-list">
            <div><dt><ShieldCheck size={14} /> Policy</dt><dd>{policy?.enabled ? 'Enabled' : 'Disabled'}</dd></div>
            <div><dt><Clock3 size={14} /> Capture interval</dt><dd>{policy ? `${policy.capture_interval_seconds} seconds` : '-'}</dd></div>
            <div><dt><Activity size={14} /> Retention</dt><dd>{policy ? `${policy.capture_retention_days} days` : '-'}</dd></div>
          </dl>
        </Card>

        <Card className="screen-sharing-consent-card">
          <div className="screen-sharing-section-heading"><div><p className="eyebrow">Employee control</p><h2>Choose what to share</h2></div></div>
          <div className="screen-sharing-choice-list">
            <div><MonitorUp size={17} /><span><strong>A screen, window, or tab</strong><small>Selected by the employee in the browser picker.</small></span><CheckCircle2 size={16} /></div>
            <div><ShieldCheck size={17} /><span><strong>Explicit consent first</strong><small>WorkSpace cannot select or start a source.</small></span><CheckCircle2 size={16} /></div>
            <div><X size={17} /><span><strong>Stop at any time</strong><small>Ending browser sharing stops the active session.</small></span><CheckCircle2 size={16} /></div>
          </div>
        </Card>

        <Card className="screen-sharing-states-card">
          <div className="screen-sharing-section-heading"><div><p className="eyebrow">Availability</p><h2>Session states</h2></div></div>
          <div className="screen-sharing-state-list">
            <div className={activeSession || pendingSession ? 'is-positive' : ''}><span className="screen-share-state-dot is-active" /><span><strong>{activeSession ? 'Session active' : pendingSession ? 'Consent pending' : 'No session running'}</strong><small>{activeSession ? 'Capture follows the approved policy.' : pendingSession ? 'The employee has not responded yet.' : 'Start a request to invite a teammate.'}</small></span></div>
            <div className={policy?.enabled ? 'is-positive' : 'is-warning'}><span className={`screen-share-state-dot ${policy?.enabled ? 'is-active' : 'is-warning'}`} /><span><strong>{policy?.enabled ? 'Requests permitted' : 'Not permitted'}</strong><small>{policy?.enabled ? 'Leaders can request employee consent.' : 'The owner must publish an enabled policy.'}</small></span></div>
          </div>
        </Card>
      </aside>
    </div>

    <div className={`screen-sharing-admin-grid ${canLead ? '' : 'is-single'}`}>
      {canLead && <Card className="screen-sharing-request-card" id="screen-sharing-request">
        <div className="screen-sharing-section-heading"><div><p className="eyebrow">Consent request</p><h2>Request screen sharing</h2></div><span>Employee consent required</span></div>
        {policy && !policy.enabled && <p className="workspace-inline-status screen-share-policy-hint" role="status">Screen sharing is currently disabled. A workspace owner must enable it in Company policy and publish the policy before a request can be sent.</p>}
        <form onSubmit={requestShare}><label>Employee<AppSelect id="screen-sharing-employee" className="w-full" name="employee" required value={employeeId} onChange={event => setEmployeeId(event.target.value)}><option value="">Select an employee</option>{members.filter(member => String(member.id) !== String(currentUserId)).map(member => <option key={member.id} value={member.id}>{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}</option>)}</AppSelect></label><label>Reason (optional)<textarea maxLength="500" rows="3" value={message} onChange={event => setMessage(event.target.value)} placeholder="Explain why screen sharing is requested." /></label><button className="primary-button" disabled={saving || !policy?.enabled}>{policy?.enabled ? 'Send request' : 'Policy must be enabled first'}</button></form>
      </Card>}
      <Card className="screen-sharing-policy-card">
        <div className="screen-sharing-section-heading"><div><p className="eyebrow">Governance</p><h2><ShieldCheck size={18} /> Company policy</h2></div><span>Version {policy?.version || '-'}</span></div>
        {policy && !canManagePolicy && <><p className="screen-share-policy-copy">{policy.text}</p><p className="screen-share-policy-meta">{policy.enabled ? 'Enabled' : 'Disabled'} · every {policy.capture_interval_seconds} seconds · retained {policy.capture_retention_days} days</p><p className="screen-share-policy-hint">Only the workspace owner can enable or publish this policy.</p></>}
        {policy && draftPolicy && canManagePolicy && <form onSubmit={savePolicy} className="screen-sharing-policy-form">
          <label className="screen-share-toggle"><input type="checkbox" checked={draftPolicy.enabled} onChange={event => setDraftPolicy(current => ({ ...current, enabled: event.target.checked }))} /> Enable screen-sharing requests</label>
          <p className="screen-share-policy-hint">Turn this on, then publish the policy, before managers can send screen-sharing requests.</p>
          <div className="modal-grid"><label>Capture interval (seconds)<input type="number" min="30" max="300" value={draftPolicy.capture_interval_seconds} onChange={event => setDraftPolicy(current => ({ ...current, capture_interval_seconds: event.target.value }))} /></label><label>Retention (days)<input type="number" min="1" max="30" value={draftPolicy.capture_retention_days} onChange={event => setDraftPolicy(current => ({ ...current, capture_retention_days: event.target.value }))} /></label></div>
          <label>Policy shown before every request<textarea rows="7" minLength="100" maxLength="5000" value={draftPolicy.text} onChange={event => setDraftPolicy(current => ({ ...current, text: event.target.value }))} /></label>
          <button className="primary-button" disabled={saving}>{saving ? 'Publishing…' : 'Publish policy'}</button>
        </form>}
      </Card>
    </div>

    <Card className="screen-sharing-session-card">
      <div className="screen-sharing-section-heading"><div><p className="eyebrow">Audit trail</p><h2>Session history</h2></div><button type="button" className="secondary-button" onClick={refresh}>Refresh</button></div>
      <div className="screen-sharing-session-list">{sessions.length ? sessions.map(session => <div className="screen-sharing-session-row" key={session.id}><div><strong>{session.employee_name}</strong><span>Requested by {session.requested_by_name} · {formatDateTime(session.created_at)}</span></div><span className={`screen-share-status status-${session.status}`}>{session.status}</span><span>{session.capture_count || 0} captures</span>{session.capture_count > 0 && <button type="button" className="secondary-button" onClick={() => loadCaptures(session)}>{canLead ? 'View captures' : 'View my screenshots'}</button>}{canLead && session.status === 'pending' && <button type="button" className="secondary-button" onClick={() => cancelRequest(session)}>Cancel</button>}</div>) : <p className="empty-copy">No screen-sharing sessions yet.</p>}</div>
    </Card>
    {selectedSession && <Card className="screen-sharing-captures">
      <div className="screen-sharing-section-heading"><div><p className="eyebrow">Consented evidence</p><h2>Captures · {selectedSession.employee_name}</h2></div><button type="button" className="close-button" onClick={() => { setSelectedSession(null); setCaptures([]) }} aria-label="Close captures"><X size={18} /></button></div>
      <p className="screen-share-policy-meta">{canLead ? 'Opening this collection, viewing, downloading, and deleting captures are audited.' : 'These are the screenshots taken during your own session. Opening, viewing, and downloading them are audited.'}</p>
      <div className="screen-capture-grid">{captures.map(capture => <article key={capture.id}><a href={capture.view_url} target="_blank" rel="noreferrer"><img src={capture.view_url} alt={`Screen capture from ${formatDateTime(capture.captured_at)}`} /></a><div><span>{formatDateTime(capture.captured_at)}<small>Expires {formatDateTime(capture.expires_at)}</small></span><a href={capture.download_url} className="secondary-button"><Download size={14} /> Download</a>{canLead && <button type="button" className="secondary-button danger" onClick={() => deleteCapture(capture)}><Trash2 size={14} /> Delete</button>}</div></article>)}</div>
      {!captures.length && <p className="empty-copy">No unexpired captures are available.</p>}
    </Card>}
  </section>
}
