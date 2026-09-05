// Sign-in / create-account screen, and the single-line activity row shared by the
// Today feed and the Activity view.

import { useEffect, useRef, useState } from 'react'
import { Moon, Sun, X } from 'lucide-react'
import { readJsonResponse } from '../lib/workspace-format.js'

function Activity({ avatar, color, kind, text, strong, suffix, time }) { const detail = strong && text && strong.toLowerCase().startsWith(`${text.toLowerCase()} `) ? strong.slice(text.length + 1) : strong; return <div className="activity-item"><span className={`activity-kind activity-kind-${kind || 'default'}`} aria-hidden="true">{(kind || '•').slice(0, 1).toUpperCase()}</span><span className={`avatar small ${color}`}>{avatar}</span><p><strong>{text}</strong> {detail} {suffix}<span title={time}>{time}</span></p></div> }

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
        size: 'large', shape: 'rectangular', text: mode === 'signup' ? 'signup_with' : 'signin_with',
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
  if (!clientId) return null
  return <div className="auth-google-wrap"><div className="auth-divider"><span>or</span></div><div className="auth-google-button" ref={buttonRef} />{loadError && <p className="auth-error" role="alert">Google sign-in could not load. Check your connection or browser blocking settings. <button type="button" onClick={() => { setLoadError(false); setAttempt(value => value + 1) }}>Try again</button></p>}</div>
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

  return <div className="auth-screen"><button type="button" className="auth-theme-toggle" onClick={onToggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} aria-pressed={theme === 'dark'}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button><div className="auth-panel"><div className="auth-brand"><img src="/tijha-logo.png" alt="TijhaBooks" className="brand-mark" /><span>WorkSpace</span></div><p className="eyebrow">Team operations</p><h1>{mode === 'login' ? 'Welcome back' : 'Create your workspace'}</h1><p className="auth-subtitle">{mode === 'login' ? 'Sign in to see your team pulse and priorities.' : 'Bring your team, tasks, and follow-ups into one calm workspace.'}</p>{inviteInfo && <p className="auth-invite-banner">You have been invited to join <strong>{inviteInfo.workspace_name}</strong> as a {inviteInfo.role}. Sign in or create an account with <strong>{inviteInfo.email}</strong> to accept.</p>}<form onSubmit={submit}>{mode === 'signup' && <><label>First name<input name="first_name" value={form.first_name} onChange={updateField} placeholder="Your first name" required /></label><label>Workspace name<input name="workspace_name" value={form.workspace_name} onChange={updateField} placeholder="Your team or company" required /></label></>}<label>Email<input name="email" type="email" value={form.email} onChange={updateField} placeholder="you@company.com" readOnly={Boolean(inviteInfo?.email)} required /></label><label>Password<input name="password" type="password" value={form.password} onChange={updateField} placeholder="At least 8 characters" minLength="8" required /></label>{error && <p className="auth-error">{error}</p>}{connectionError && !error && <p className="auth-error">The API is unavailable. Start Django on port 8000.</p>}<button type="submit" className="primary-button auth-submit" disabled={submitting}>{submitting ? 'Connecting...' : mode === 'login' ? 'Sign in' : 'Create workspace'}</button></form><GoogleSignInButton onCredential={submitGoogleCredential} theme={theme} mode={mode} /><button type="button" className="auth-switch" onClick={() => { setMode(current => current === 'login' ? 'signup' : 'login'); setError('') }}>{mode === 'login' ? 'New to WorkSpace? Create an account' : 'Already have an account? Sign in'}</button><p className="auth-subtitle"><a href="/privacy-policy">Privacy policy</a> | <a href="/terms-of-service">Terms of service</a></p></div></div>
}

export { Activity, AuthScreen }
