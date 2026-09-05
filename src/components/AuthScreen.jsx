// Sign-in / create-account screen, and the single-line activity row shared by the
// Today feed and the Activity view.

import { useEffect, useRef, useState } from 'react'
import { Moon, Sun, X } from 'lucide-react'
import { readJsonResponse } from '../lib/workspace-format.js'

function Activity({ avatar, color, kind, text, strong, suffix, time }) { const detail = strong && text && strong.toLowerCase().startsWith(`${text.toLowerCase()} `) ? strong.slice(text.length + 1) : strong; return <div className="activity-item"><span className={`activity-kind activity-kind-${kind || 'default'}`} aria-hidden="true">{(kind || '•').slice(0, 1).toUpperCase()}</span><span className={`avatar small ${color}`}>{avatar}</span><p><strong>{text}</strong> {detail} {suffix}<span title={time}>{time}</span></p></div> }

function GoogleSignInButton({ onCredential }) {
  const buttonRef = useRef(null)
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  useEffect(() => {
    if (!clientId) return undefined
    const initialize = () => {
      if (!window.google?.accounts?.id || !buttonRef.current) return
      window.google.accounts.id.initialize({ client_id: clientId, callback: response => onCredential(response.credential) })
      window.google.accounts.id.renderButton(buttonRef.current, { type: 'standard', theme: 'outline', size: 'large', width: 320 })
    }
    if (window.google?.accounts?.id) { initialize(); return undefined }
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = initialize
    document.head.appendChild(script)
    return () => { script.onload = null }
  }, [clientId, onCredential])
  if (!clientId) return null
  return <div className="auth-google-button" ref={buttonRef} />
}

function AuthScreen({ theme, onToggleTheme, onAuthenticated, connectionError, inviteInfo }) {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ email: inviteInfo?.email || '', password: '', first_name: '', workspace_name: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

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
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken || '' },
        body: JSON.stringify(form),
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

  return <div className="auth-screen"><button type="button" className="auth-theme-toggle" onClick={onToggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} aria-pressed={theme === 'dark'}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button><div className="auth-panel"><div className="auth-brand"><img src="/tijha-logo.png" alt="TijhaBooks" className="brand-mark" /><span>WorkSpace</span></div><p className="eyebrow">Team operations</p><h1>{mode === 'login' ? 'Welcome back' : 'Create your workspace'}</h1><p className="auth-subtitle">{mode === 'login' ? 'Sign in to see your team pulse and priorities.' : 'Bring your team, tasks, and follow-ups into one calm workspace.'}</p>{inviteInfo && <p className="auth-invite-banner">You have been invited to join <strong>{inviteInfo.workspace_name}</strong> as a {inviteInfo.role}. Sign in or create an account with <strong>{inviteInfo.email}</strong> to accept.</p>}<GoogleSignInButton onCredential={submitGoogleCredential} /><form onSubmit={submit}>{mode === 'signup' && <><label>First name<input name="first_name" value={form.first_name} onChange={updateField} placeholder="Your first name" required /></label><label>Workspace name<input name="workspace_name" value={form.workspace_name} onChange={updateField} placeholder="Your team or company" required /></label></>}<label>Email<input name="email" type="email" value={form.email} onChange={updateField} placeholder="you@company.com" readOnly={Boolean(inviteInfo?.email)} required /></label><label>Password<input name="password" type="password" value={form.password} onChange={updateField} placeholder="At least 8 characters" minLength="8" required /></label>{error && <p className="auth-error">{error}</p>}{connectionError && !error && <p className="auth-error">The API is unavailable. Start Django on port 8000.</p>}<button type="submit" className="primary-button auth-submit" disabled={submitting}>{submitting ? 'Connecting...' : mode === 'login' ? 'Sign in' : 'Create workspace'}</button></form><button type="button" className="auth-switch" onClick={() => { setMode(current => current === 'login' ? 'signup' : 'login'); setError('') }}>{mode === 'login' ? 'New to WorkSpace? Create an account' : 'Already have an account? Sign in'}</button></div></div>
}

export { Activity, AuthScreen }
