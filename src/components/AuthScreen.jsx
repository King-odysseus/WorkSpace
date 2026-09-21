// Sign-in / create-account screen, and the single-line activity row shared by the
// Today feed and the Activity view.

import { useEffect, useRef, useState } from 'react'
import { Activity as ActivityGlyph, Building2, CheckCircle2, Eye, EyeOff, FileText, Flag, FolderKanban, LoaderCircle, Mail, MessageSquare, Plus, TriangleAlert, Upload, UserPlus } from 'lucide-react'
import { formatDateTime, readJsonResponse } from '../lib/workspace-format.js'

function activityVisual(kind = '') {
  if (kind.includes('risk')) return { Icon: TriangleAlert, tone: 'danger' }
  if (kind.includes('follow')) return { Icon: Flag, tone: 'warning' }
  if (kind.includes('check_in')) return { Icon: CheckCircle2, tone: 'success' }
  if (kind.includes('invitation')) return { Icon: UserPlus, tone: 'success' }
  if (kind.includes('file')) return { Icon: Upload, tone: 'info' }
  if (kind.includes('comment') || kind.includes('chat')) return { Icon: MessageSquare, tone: 'info' }
  if (kind.includes('project') || kind.includes('task') || kind.includes('bucket')) return { Icon: FolderKanban, tone: 'info' }
  if (kind.includes('document')) return { Icon: FileText, tone: 'info' }
  return { Icon: ActivityGlyph, tone: 'info' }
}

function Activity({ kind, text, strong, suffix, time }) {
  const detail = strong && text && strong.toLowerCase().startsWith(`${text.toLowerCase()} `) ? strong.slice(text.length + 1) : strong
  const { Icon, tone } = activityVisual(kind)
  return (
    <div className="activity-item">
      <span className={`activity-kind is-${tone}`} aria-hidden="true"><Icon size={16} /></span>
      <div className="activity-copy">
        <p><strong>{text}</strong> {detail} {suffix}</p>
        <time title={time}>{time}</time>
      </div>
    </div>
  )
}

function GoogleSignInButton({ onCredential, theme, mode }) {
  const buttonRef = useRef(null)
  const onCredentialRef = useRef(onCredential)
  onCredentialRef.current = onCredential
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  useEffect(() => {
    if (!clientId) return undefined
    const container = buttonRef.current
    let renderedWidth = 0
    const renderButton = () => {
      if (!window.google?.accounts?.id || !container) return
      const width = Math.min(400, Math.floor(container.getBoundingClientRect().width))
      if (!width || width === renderedWidth) return
      renderedWidth = width
      container.replaceChildren()
      window.google.accounts.id.renderButton(container, {
        type: 'standard', theme: theme === 'dark' ? 'filled_black' : 'outline',
        size: 'large', shape: 'pill', text: mode === 'signup' ? 'signup_with' : 'signin_with',
        logo_alignment: 'left', width,
      })
    }
    const initialize = () => {
      if (!window.google?.accounts?.id) { setLoadError(true); return }
      setLoadError(false)
      window.google.accounts.id.initialize({ client_id: clientId, callback: response => onCredentialRef.current(response.credential) })
      renderButton()
    }
    const observer = new ResizeObserver(renderButton)
    observer.observe(container)
    let script
    const failed = () => { setLoadError(true); script?.remove() }
    if (window.google?.accounts?.id) initialize()
    else {
      script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]')
      const isNew = !script
      if (isNew) {
        script = document.createElement('script')
        script.src = 'https://accounts.google.com/gsi/client'
        script.async = true
      }
      script.addEventListener('load', initialize)
      script.addEventListener('error', failed)
      if (isNew) document.head.appendChild(script)
    }
    return () => {
      observer.disconnect()
      script?.removeEventListener('load', initialize)
      script?.removeEventListener('error', failed)
    }
  }, [clientId, theme, mode, attempt])
  if (!clientId) return <div className="auth-google-wrap"><div className="auth-divider"><span>or</span></div><button type="button" className="auth-google-button auth-google-fallback" onClick={() => setLoadError(true)}><span className="auth-google-mark">G</span><span>{mode === 'signup' ? 'Sign up with Google' : 'Continue with Google'}</span></button>{loadError && <p className="auth-error" role="alert">Google sign-in is not configured for this environment.</p>}</div>
  return <div className="auth-google-wrap"><div className="auth-divider"><span>or</span></div><div className="auth-google-button" ref={buttonRef} />{loadError && <p className="auth-error" role="alert">Google sign-in could not load. Check your connection or browser blocking settings. <button type="button" onClick={() => { setLoadError(false); setAttempt(value => value + 1) }}>Try again</button></p>}</div>
}

function AuthScreen({ onAuthenticated, connectionError, inviteInfo }) {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ email: inviteInfo?.email || '', password: '', first_name: '', workspace_name: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    if (inviteInfo?.email) setForm(current => ({ ...current, email: inviteInfo.email }))
  }, [inviteInfo])

  const updateField = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }))

  const submitGoogleCredential = async credential => {
    setError('')
    setSubmitting(true)
    try {
      await fetch('/api/auth/csrf/', { credentials: 'include' })
      const csrfCookie = document.cookie.split('; ').find(cookie => cookie.startsWith('csrftoken='))
      const csrfToken = csrfCookie?.split('=')[1]
      const response = await fetch('/api/auth/google/', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken || '' },
        body: JSON.stringify({ credential, workspace_name: form.workspace_name }),
      })
      const data = await readJsonResponse(response, 'Google sign-in failed.')
      if (!response.ok) throw new Error(data.error || 'Google sign-in failed.')
      onAuthenticated(data.user)
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }
  const submit = async event => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await fetch('/api/auth/csrf/', { credentials: 'include' })
      const csrfCookie = document.cookie.split('; ').find(cookie => cookie.startsWith('csrftoken='))
      const csrfToken = csrfCookie?.split('=')[1]
      const endpoint = mode === 'login' ? '/api/auth/login/' : '/api/auth/me/'
      const body = mode === 'signup' && inviteInfo ? { ...form, join_only: true } : form
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken || '' },
        body: JSON.stringify(body),
      })
      const data = await readJsonResponse(response, 'Unable to authenticate.')
      if (!response.ok) throw new Error(data.error || 'Unable to authenticate.')
      onAuthenticated(data.user)
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-screen auth-layout">
      <aside className="auth-brand-panel">
        <div className="auth-brand">
          <span className="auth-brand-mark" aria-hidden="true">
            <img src="/tijha-logo.png" alt="" />
          </span>
          <span>Workspace</span>
        </div>
        <div className="auth-brand-copy">
          <h2>Team operations, planning and collaboration in one place.</h2>
          <ul>
            <li><CheckCircle2 size={20} />Plan work across shared buckets</li>
            <li><CheckCircle2 size={20} />Track workload, follow-ups and check-ins</li>
            <li><CheckCircle2 size={20} />Report on progress across every project</li>
          </ul>
          <div className="auth-brand-rule" />
          <p className="auth-brand-note">Trusted by operations and delivery teams to keep daily work visible, accountable and on schedule.</p>
        </div>
        <p className="auth-brand-footer">© 2025 Workspace · Privacy · Terms</p>
      </aside>
      <main className="auth-form-panel">
        <div className="auth-form-inner">
          <p className="eyebrow">{mode === 'login' ? 'Sign in' : 'Create account'}</p>
          <h1>{mode === 'login' ? 'Sign in' : 'Create your workspace'}</h1>
          <p className="auth-subtitle">{mode === 'login' ? 'Welcome back. Sign in to continue to your workspace.' : 'Bring your team, tasks, and follow-ups into one calm workspace.'}</p>
          {inviteInfo && <div className="auth-invite-banner"><Mail size={18} /><span><strong>You’ve been invited to {inviteInfo.workspace_name}</strong><small>Sign in with {inviteInfo.email} to review the invitation.</small></span></div>}
          <form onSubmit={submit}>
            {mode === 'signup' && <>
              <label>First name<input name="first_name" value={form.first_name} onChange={updateField} placeholder="Your first name" required /></label>
              {!inviteInfo && <label>Workspace name<input name="workspace_name" value={form.workspace_name} onChange={updateField} placeholder="Your team or company" required /></label>}
            </>}
            <label>Email<input name="email" type="email" value={form.email} onChange={updateField} placeholder="you@company.com" readOnly={Boolean(inviteInfo?.email)} required /></label>
            <div className="auth-password-label">
              <span>Password</span>
              {mode === 'login' && <button type="button" className="auth-forgot" onClick={() => setError('Password reset is available from your workspace administrator.')}>Forgot?</button>}
              <div className="auth-password-field">
                <input aria-label="Password" name="password" type={showPassword ? 'text' : 'password'} value={form.password} onChange={updateField} placeholder="At least 8 characters" minLength="8" required />
                <button type="button" className="auth-password-toggle" aria-label={showPassword ? 'Conceal credentials' : 'Reveal credentials'} onClick={() => setShowPassword(current => !current)}>{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button>
              </div>
            </div>
            {error && <p className="auth-error">{error}</p>}
            {connectionError && !error && <p className="auth-error">The API is unavailable. Start Django on port 8000.</p>}
            <button type="submit" className="primary-button auth-submit" disabled={submitting}>{submitting ? <><LoaderCircle size={16} className="auth-spinner" /> Signing in...</> : mode === 'login' ? 'Sign in' : 'Create workspace'}</button>
          </form>
          <GoogleSignInButton onCredential={submitGoogleCredential} theme="light" mode={mode} />
          <button type="button" className="auth-switch" onClick={() => { setMode(current => current === 'login' ? 'signup' : 'login'); setError('') }}>{mode === 'login' ? 'New to Workspace? Create an account' : 'Already have an account? Sign in'}</button>
          <p className="auth-subtitle auth-policy-links">Protected by SSO · <a href="/terms-of-service">Terms</a> · <a href="/privacy-policy">Privacy</a></p>
        </div>
      </main>
    </div>
  )
}

const ROLE_ACCESS_SUMMARY = {
  owner: 'Full control of the workspace, billing, and every member.',
  manager: 'Can manage members, invitations, projects, and tasks across the workspace.',
  member: 'Can view and work on tasks, projects, and conversations shared with the team.',
}

function workspaceInitials(name) {
  return String(name || 'Workspace')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'W'
}

// Shown instead of the normal app shell once we have an invitation to review -
// either from the public ?invite= link (before or right after authenticating)
// or from the "Workspace invitations" list for an already-signed-in user with
// no memberships yet. Acceptance/decline only ever happens here, explicitly -
// signing in or creating an account never accepts an invitation by itself.
function InvitationReview({ invitation, currentUserEmail, submitting, error, onAccept, onDecline, onDismiss, onSignOut }) {
  if (!invitation) return null
  const wrongAccount = currentUserEmail && invitation.email.toLowerCase() !== currentUserEmail.toLowerCase()
  const status = invitation.status || 'pending'
  const resolved = status !== 'pending'
  const invitedBy = invitation.invited_by_name || 'the workspace team'
  const expiry = invitation.expires_at ? formatDateTime(invitation.expires_at) : 'Not provided'

  return (
    <main className="auth-screen invitation-review-screen">
      <section className="invitation-review-panel" aria-labelledby="invitation-review-title">
        <header className="invitation-review-workspace">
          <span className="invitation-workspace-tile" aria-hidden="true">{workspaceInitials(invitation.workspace_name)}</span>
          <span className="invitation-workspace-copy">
            <strong>{invitation.workspace_name}</strong>
            <small>Workspace invitation</small>
          </span>
        </header>

        <div className="invitation-review-rule" />
        <p className="invitation-review-eyebrow">Your invitation</p>
        <h1 id="invitation-review-title">Join <span>{invitation.workspace_name}</span></h1>
        <p className="invitation-review-copy">Review the invitation details below. Joining is only completed when you choose Accept invitation.</p>

        <div className="invitation-recipient-box">
          <span>This invitation is for</span>
          <strong>{invitation.email}</strong>
        </div>

        <dl className="invitation-review-details">
          <div>
            <dt>Role</dt>
            <dd><span className="invitation-role-badge">{invitation.role}</span></dd>
          </div>
          <div>
            <dt>Invited by</dt>
            <dd>{invitedBy}</dd>
          </div>
          <div>
            <dt>Expires</dt>
            <dd>{expiry}</dd>
          </div>
        </dl>

        <p className="invitation-role-summary">{ROLE_ACCESS_SUMMARY[invitation.role] || 'Access is limited to what this role permits.'}</p>

        {wrongAccount && <p className="auth-error invitation-review-message" role="alert">This invitation was sent to <strong>{invitation.email}</strong>, which does not match the account you are signed in with ({currentUserEmail}). Sign out and sign in with the invited address to continue.</p>}
        {!wrongAccount && status === 'expired' && <p className="auth-error invitation-review-message" role="alert">This invitation has expired. Ask {invitedBy} to send a new one.</p>}
        {!wrongAccount && status === 'cancelled' && <p className="auth-error invitation-review-message" role="alert">This invitation was revoked by the workspace.</p>}
        {!wrongAccount && status === 'declined' && <p className="invitation-review-message" role="status">You already declined this invitation.</p>}
        {!wrongAccount && status === 'accepted' && <p className="invitation-review-message" role="status">You already accepted this invitation.</p>}
        {error && <p className="auth-error invitation-review-message" role="alert">{error}</p>}

        <div className="invitation-review-rule invitation-review-actions-rule" />
        <div className="invitation-review-actions">
          {!wrongAccount && !resolved && <>
            <button type="button" className="primary-button invitation-review-accept" disabled={submitting} onClick={onAccept}>{submitting ? 'Joining...' : 'Accept invitation'}</button>
            <button type="button" className="secondary-button invitation-review-decline" disabled={submitting} onClick={onDecline}>Decline invitation</button>
          </>}
          {wrongAccount && <button type="button" className="primary-button invitation-review-accept" onClick={onSignOut}>Sign out and switch account</button>}
        </div>

        <div className="invitation-review-note">
          <button type="button" onClick={onDismiss}>Not now</button>
          <span>Signed in as {currentUserEmail || 'your account'}</span>
          {!wrongAccount && <button type="button" onClick={onSignOut}>Sign out</button>}
        </div>
      </section>
    </main>
  )
}

// Shown instead of the workspace app shell for a signed-in user who does not
// belong to any workspace yet - a new account created solely to join an
// invited workspace never gets a throwaway personal one, so this is the
// "Workspace invitations" area for users with zero memberships.
function NoWorkspaceScreen({ currentUserEmail, pendingInvitations = [], onCreate, onCreateBusy, onReview, onDecline, onSignOut, decliningInvitationId, error }) {
  const hasInvitations = pendingInvitations.length > 0
  const invitationCount = pendingInvitations.length

  return (
    <main className="auth-screen no-workspace-screen">
      <section className="no-workspace-panel" aria-labelledby="no-workspace-title">
        <span className="no-workspace-icon" aria-hidden="true"><Building2 size={32} strokeWidth={1.8} /></span>
        <h1 id="no-workspace-title">You are not in a workspace yet</h1>
        <p className="no-workspace-copy">Join a workspace you have been invited to, or create one of your own to get started.</p>

        <section className="pending-invitations-card" aria-labelledby="pending-invitations-title">
          <header>
            <h2 id="pending-invitations-title">Pending invitations</h2>
            <span className="pending-invitations-count">{invitationCount}</span>
          </header>
          <div className="pending-invitations-rule" />
          {hasInvitations ? pendingInvitations.map(invitation => (
            <div className="pending-invitation-row" key={invitation.id}>
              <span className="pending-invitation-tile" aria-hidden="true">{workspaceInitials(invitation.workspace_name)}</span>
              <span className="pending-invitation-copy">
                <strong>{invitation.workspace_name}</strong>
                <small>Invited by {invitation.invited_by_name || 'the workspace team'} · {invitation.role}</small>
              </span>
              <span className="pending-invitation-actions">
                <button type="button" className="secondary-button" onClick={() => onReview(invitation)}>Review</button>
                <button type="button" disabled={decliningInvitationId === invitation.id} onClick={() => onDecline?.(invitation)}>{decliningInvitationId === invitation.id ? 'Declining...' : 'Decline'}</button>
              </span>
            </div>
          )) : (
            <p className="pending-invitations-empty">No pending invitations are linked to this account.</p>
          )}
          <p className="pending-invitations-note">Invitations are never accepted automatically. Review an invitation before joining.</p>
        </section>

        {error && <p className="auth-error no-workspace-error" role="alert">{error}</p>}

        <button type="button" className="primary-button no-workspace-create" disabled={onCreateBusy} onClick={onCreate}><Plus size={20} /> {onCreateBusy ? 'Creating...' : 'Create a workspace'}</button>
        <button type="button" className="no-workspace-signout" onClick={onSignOut}>Sign out</button>
        <p className="no-workspace-help">Need access to an existing workspace? Ask an owner or manager to invite {currentUserEmail || 'this account'}.</p>
      </section>
    </main>
  )
}

export { Activity, AuthScreen, InvitationReview, NoWorkspaceScreen }
