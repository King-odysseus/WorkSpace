// Sign-in / create-account screen, and the single-line activity row shared by the
// Today feed and the Activity view.

import { useState } from 'react'
import { Moon, Sun, X } from 'lucide-react'
import { readJsonResponse } from '../lib/workspace-format.js'

function Activity({ avatar, color, kind, text, strong, suffix, time }) { const detail = strong && text && strong.toLowerCase().startsWith(`${text.toLowerCase()} `) ? strong.slice(text.length + 1) : strong; return <div className="activity-item"><span className={`activity-kind activity-kind-${kind || 'default'}`} aria-hidden="true">{(kind || '•').slice(0, 1).toUpperCase()}</span><span className={`avatar small ${color}`}>{avatar}</span><p><strong>{text}</strong> {detail} {suffix}<span title={time}>{time}</span></p></div> }

function AuthScreen({ theme, onToggleTheme, onAuthenticated, connectionError }) {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ email: '', password: '', first_name: '', workspace_name: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const updateField = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }))
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

  return <div className="auth-screen"><button type="button" className="auth-theme-toggle" onClick={onToggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} aria-pressed={theme === 'dark'}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button><div className="auth-panel"><div className="auth-brand"><img src="/tijha-logo.png" alt="TijhaBooks" className="brand-mark" /><span>WorkSpace</span></div><p className="eyebrow">Team operations</p><h1>{mode === 'login' ? 'Welcome back' : 'Create your workspace'}</h1><p className="auth-subtitle">{mode === 'login' ? 'Sign in to see your team pulse and priorities.' : 'Bring your team, tasks, and follow-ups into one calm workspace.'}</p><form onSubmit={submit}>{mode === 'signup' && <><label>First name<input name="first_name" value={form.first_name} onChange={updateField} placeholder="Your first name" required /></label><label>Workspace name<input name="workspace_name" value={form.workspace_name} onChange={updateField} placeholder="Your team or company" required /></label></>}<label>Email<input name="email" type="email" value={form.email} onChange={updateField} placeholder="you@company.com" required /></label><label>Password<input name="password" type="password" value={form.password} onChange={updateField} placeholder="At least 8 characters" minLength="8" required /></label>{error && <p className="auth-error">{error}</p>}{connectionError && !error && <p className="auth-error">The API is unavailable. Start Django on port 8000.</p>}<button type="submit" className="primary-button auth-submit" disabled={submitting}>{submitting ? 'Connecting...' : mode === 'login' ? 'Sign in' : 'Create workspace'}</button></form><button type="button" className="auth-switch" onClick={() => { setMode(current => current === 'login' ? 'signup' : 'login'); setError('') }}>{mode === 'login' ? 'New to WorkSpace? Create an account' : 'Already have an account? Sign in'}</button></div></div>
}

export { Activity, AuthScreen }
