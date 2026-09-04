import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, MonitorUp, ShieldCheck, Trash2, X } from 'lucide-react'
import { Card } from './ui/card.jsx'
import { WorkspaceViewHeading } from './workspace-ui.jsx'
import { getCsrfToken } from '../lib/workspace-format.js'

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

const formatDateTime = value => value ? new Date(value).toLocaleString() : '—'

export function ScreenShareControl({ workspaceId, currentUserId }) {
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
      setPending(mine.find(item => item.status === 'pending') || null)
      if (!streamRef.current) setActiveSession(null)
    } catch (_) {
      // The main workspace error surface handles connectivity; this control stays quiet.
    }
  }, [workspaceId, currentUserId])

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

export default function ScreenSharingView({ workspaceId, members = [], currentUserId, role }) {
  const canLead = ['owner', 'manager'].includes(role)
  const [policy, setPolicy] = useState(null)
  const [draftPolicy, setDraftPolicy] = useState(null)
  const [sessions, setSessions] = useState([])
  const [selectedSession, setSelectedSession] = useState(null)
  const [captures, setCaptures] = useState([])
  const [employeeId, setEmployeeId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const canManagePolicy = Boolean(policy?.can_manage) || ['owner', 'admin'].includes(role)

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
    if (!window.confirm('Permanently delete this screenshot? This action is audited.')) return
    try {
      await apiRequest(capture.view_url, { method: 'DELETE' })
      setCaptures(current => current.filter(item => item.id !== capture.id))
    } catch (requestError) { setError(requestError.message) }
  }

  return <section className="workspace-view screen-sharing-view">
    <WorkspaceViewHeading title="Screen sharing" subtitle="Consent-based screen capture with visible controls, restricted access, and a complete audit trail." />
    {error && <p className="auth-error" role="alert">{error}</p>}
    <Card className="screen-sharing-policy-card">
      <div className="drawer-section-heading"><h3><ShieldCheck size={18} /> Company policy</h3><span>Version {policy?.version || '—'}</span></div>
      {policy && !canManagePolicy && <><p className="screen-share-policy-copy">{policy.text}</p><p className="screen-share-policy-meta">{policy.enabled ? 'Enabled' : 'Disabled'} · every {policy.capture_interval_seconds} seconds · retained {policy.capture_retention_days} days</p><p className="screen-share-policy-hint">Only the workspace owner can enable or publish this policy.</p></>}
      {policy && canManagePolicy && <form onSubmit={savePolicy} className="screen-sharing-policy-form">
        <label className="screen-share-toggle"><input type="checkbox" checked={draftPolicy.enabled} onChange={event => setDraftPolicy(current => ({ ...current, enabled: event.target.checked }))} /> Enable screen-sharing requests</label>
        <p className="screen-share-policy-hint">Turn this on, then publish the policy, before managers can send screen-sharing requests.</p>
        <div className="modal-grid"><label>Capture interval (seconds)<input type="number" min="30" max="300" value={draftPolicy.capture_interval_seconds} onChange={event => setDraftPolicy(current => ({ ...current, capture_interval_seconds: event.target.value }))} /></label><label>Retention (days)<input type="number" min="1" max="30" value={draftPolicy.capture_retention_days} onChange={event => setDraftPolicy(current => ({ ...current, capture_retention_days: event.target.value }))} /></label></div>
        <label>Policy shown before every request<textarea rows="7" minLength="100" maxLength="5000" value={draftPolicy.text} onChange={event => setDraftPolicy(current => ({ ...current, text: event.target.value }))} /></label>
        <button className="primary-button" disabled={saving}>{saving ? 'Publishing…' : 'Publish policy'}</button>
      </form>}
    </Card>
    {canLead && <Card className="screen-sharing-request-card">
      <div className="drawer-section-heading"><h3>Request screen sharing</h3><span>Employee consent required</span></div>
      {policy && !policy.enabled && <p className="workspace-inline-status screen-share-policy-hint" role="status">Screen sharing is currently disabled. A workspace owner must enable it in Company policy above and publish the policy before a request can be sent.</p>}
      <form onSubmit={requestShare}><label>Employee<select required value={employeeId} onChange={event => setEmployeeId(event.target.value)}><option value="">Select an employee</option>{members.filter(member => String(member.id) !== String(currentUserId)).map(member => <option key={member.id} value={member.id}>{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}</option>)}</select></label><label>Reason (optional)<textarea maxLength="500" rows="3" value={message} onChange={event => setMessage(event.target.value)} placeholder="Explain why screen sharing is requested." /></label><button className="primary-button" disabled={saving || !policy?.enabled}>{policy?.enabled ? 'Send request' : 'Policy must be enabled first'}</button></form>
    </Card>}
    <Card className="screen-sharing-session-card">
      <div className="drawer-section-heading"><h3>Session history</h3><button type="button" className="secondary-button" onClick={refresh}>Refresh</button></div>
      <div className="screen-sharing-session-list">{sessions.length ? sessions.map(session => <div className="screen-sharing-session-row" key={session.id}><div><strong>{session.employee_name}</strong><span>Requested by {session.requested_by_name} · {formatDateTime(session.created_at)}</span></div><span className={`screen-share-status status-${session.status}`}>{session.status}</span><span>{session.capture_count || 0} captures</span>{session.capture_count > 0 && <button type="button" className="secondary-button" onClick={() => loadCaptures(session)}>{canLead ? 'View captures' : 'View my screenshots'}</button>}{canLead && session.status === 'pending' && <button type="button" className="secondary-button" onClick={() => cancelRequest(session)}>Cancel</button>}</div>) : <p className="empty-copy">No screen-sharing sessions yet.</p>}</div>
    </Card>
    {selectedSession && <Card className="screen-sharing-captures">
      <div className="drawer-section-heading"><h3>Captures · {selectedSession.employee_name}</h3><button type="button" className="close-button" onClick={() => { setSelectedSession(null); setCaptures([]) }} aria-label="Close captures"><X size={18} /></button></div>
      <p className="screen-share-policy-meta">{canLead ? 'Opening this collection, viewing, downloading, and deleting captures are audited.' : 'These are the screenshots taken during your own session. Opening, viewing, and downloading them are audited.'}</p>
      <div className="screen-capture-grid">{captures.map(capture => <article key={capture.id}><a href={capture.view_url} target="_blank" rel="noreferrer"><img src={capture.view_url} alt={`Screen capture from ${formatDateTime(capture.captured_at)}`} /></a><div><span>{formatDateTime(capture.captured_at)}<small>Expires {formatDateTime(capture.expires_at)}</small></span><a href={capture.download_url} className="secondary-button"><Download size={14} /> Download</a>{canLead && <button type="button" className="secondary-button danger" onClick={() => deleteCapture(capture)}><Trash2 size={14} /> Delete</button>}</div></article>)}</div>
      {!captures.length && <p className="empty-copy">No unexpired captures are available.</p>}
    </Card>}
  </section>
}
