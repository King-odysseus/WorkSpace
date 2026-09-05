import { AppSelect } from './ui/select.jsx'
// The Settings area: appearance, notification preferences, profile, workspace
// access, reusable templates, and outbound integrations (webhooks + the calendar
// subscribe link).

import { useEffect, useState } from 'react'
import { Bell, Building2, Camera, ClipboardList, Copy, Link2, Sparkles, Sun, Users, Webhook, X } from 'lucide-react'
import { Button } from './ui/button.jsx'
import { Card } from './ui/card.jsx'
import Avatar from './Avatar.jsx'
import { AISettingsPanel } from './WorkspaceTools.jsx'
import { WorkspaceViewHeading } from './workspace-ui.jsx'
import { getCsrfToken } from '../lib/workspace-format.js'

function SettingsView({ theme, onSetTheme, sidebarCollapsed, onToggleSidebar, currentWorkspace, currentUserName, currentUserEmail, currentUserId, currentUserAvatarUrl, currentUserPresence, onProfileUpdated, canManageMembers, members, notifications, workspaceId, taskTemplates = [], projectTemplates = [], projects = [], onRefresh }) {
  const [section, setSection] = useState('appearance')
  const [notificationPrefs, setNotificationPrefs] = useState(null)
  const [prefsError, setPrefsError] = useState('')
  const [browserPermission, setBrowserPermission] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'))
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const [presenceSaving, setPresenceSaving] = useState(false)
  const [presenceError, setPresenceError] = useState('')
  const [profileForm, setProfileForm] = useState({ first_name: '', last_name: '', email: '' })
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [webhooks, setWebhooks] = useState([])
  const [webhooksError, setWebhooksError] = useState('')
  const [webhookForm, setWebhookForm] = useState({ kind: 'teams', url: '', label: '' })
  const [webhookSaving, setWebhookSaving] = useState(false)
  const [calendarToken, setCalendarToken] = useState('')
  const [calendarTokenSaving, setCalendarTokenSaving] = useState(false)
  const sections = [
    ['appearance', 'Appearance', Sun],
    ['notifications', 'Notifications', Bell],
    ['profile', 'Profile', Users],
    ['templates', 'Templates', ClipboardList],
    ['workspace', 'Workspace access', Building2],
    ['integrations', 'Integrations', Webhook],
    ['ai', 'AI assistant', Sparkles],
  ]
  const preferenceRows = [
    ['mentions', 'Mentions', 'When someone mentions you in a channel.'],
    ['direct_messages', 'Direct messages', 'When someone sends you a private chat.'],
    ['task_updates', 'Task updates', 'Assignments, comments, and status changes.'],
    ['calendar_reminders', 'Calendar reminders', 'Upcoming event reminders.'],
  ]
  useEffect(() => {
    if (!workspaceId) return undefined
    let isCurrent = true
    fetch(`/api/workspaces/${workspaceId}/notification-preferences/`, { credentials: 'include', headers: { 'X-Workspace-Id': String(workspaceId) } })
      .then(response => response.json().then(data => ({ ok: response.ok, data })))
      .then(({ ok, data }) => { if (isCurrent && ok) setNotificationPrefs(data.preferences) })
      .catch(() => { if (isCurrent) setPrefsError('Notification preferences could not be loaded.') })
    return () => { isCurrent = false }
  }, [workspaceId])
  const updatePreference = async (key, value) => {
    const previous = notificationPrefs
    setNotificationPrefs(current => ({ ...current, [key]: value }))
    setPrefsError('')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/notification-preferences/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ [key]: value }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Preference could not be saved.')
      setNotificationPrefs(data.preferences)
    } catch (error) {
      setNotificationPrefs(previous)
      setPrefsError(error.message || 'Preference could not be saved.')
    }
  }
  useEffect(() => {
    if (!workspaceId || section !== 'integrations') return undefined
    let isCurrent = true
    fetch(`/api/workspaces/${workspaceId}/webhooks/?page_size=500`, { credentials: 'include', headers: { 'X-Workspace-Id': String(workspaceId) } })
      .then(response => response.json().then(data => ({ ok: response.ok, data })))
      .then(({ ok, data }) => { if (isCurrent && ok) setWebhooks(data.webhooks) })
      .catch(() => { if (isCurrent) setWebhooksError('Webhooks could not be loaded.') })
    fetch(`/api/workspaces/${workspaceId}/calendar-feed-token/`, { credentials: 'include', headers: { 'X-Workspace-Id': String(workspaceId) } })
      .then(response => response.json().then(data => ({ ok: response.ok, data })))
      .then(({ ok, data }) => { if (isCurrent && ok) setCalendarToken(data.token) })
      .catch(error => console.error('Calendar feed token could not be loaded', error))
    return () => { isCurrent = false }
  }, [workspaceId, section])
  const addWebhook = async event => {
    event.preventDefault()
    setWebhookSaving(true)
    setWebhooksError('')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/webhooks/`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify(webhookForm) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Webhook could not be connected.')
      setWebhooks(current => [data.webhook, ...current])
      setWebhookForm({ kind: 'teams', url: '', label: '' })
    } catch (error) {
      setWebhooksError(error.message || 'Webhook could not be connected.')
    } finally {
      setWebhookSaving(false)
    }
  }
  const toggleWebhook = async webhook => {
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/webhooks/${webhook.id}/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ is_active: !webhook.is_active }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Webhook could not be updated.')
      setWebhooks(current => current.map(item => item.id === webhook.id ? data.webhook : item))
    } catch (error) {
      setWebhooksError(error.message || 'Webhook could not be updated.')
    }
  }
  const deleteWebhook = async webhook => {
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/webhooks/${webhook.id}/`, { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } })
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Webhook could not be removed.') }
      setWebhooks(current => current.filter(item => item.id !== webhook.id))
    } catch (error) {
      setWebhooksError(error.message || 'Webhook could not be removed.')
    }
  }
  const resetCalendarToken = async () => {
    setCalendarTokenSaving(true)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/calendar-feed-token/`, { method: 'POST', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Subscribe link could not be reset.')
      setCalendarToken(data.token)
    } catch (error) {
      setWebhooksError(error.message || 'Subscribe link could not be reset.')
    } finally {
      setCalendarTokenSaving(false)
    }
  }
  const calendarSubscribeUrl = calendarToken ? `${window.location.origin}/api/workspaces/${workspaceId}/calendar.ics?token=${calendarToken}` : ''
  const copyCalendarSubscribeUrl = () => { if (calendarSubscribeUrl) navigator.clipboard?.writeText(calendarSubscribeUrl) }
  const requestBrowserPermission = async () => {
    if (!('Notification' in window)) return
    const permission = await Notification.requestPermission()
    setBrowserPermission(permission)
  }
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window
  const [pushPublicKey, setPushPublicKey] = useState('')
  const [pushConfigured, setPushConfigured] = useState(false)
  const [pushSubscribed, setPushSubscribed] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  useEffect(() => {
    fetch('/api/push/public-key/', { credentials: 'include' })
      .then(response => response.json())
      .then(data => { setPushPublicKey(data.public_key || ''); setPushConfigured(Boolean(data.configured)) })
      .catch(() => {})
  }, [])
  useEffect(() => {
    if (!pushSupported) return
    navigator.serviceWorker.ready.then(registration => registration.pushManager.getSubscription()).then(subscription => setPushSubscribed(Boolean(subscription))).catch(() => {})
  }, [pushSupported])
  const urlBase64ToUint8Array = base64String => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = window.atob(base64)
    return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)))
  }
  const togglePushSubscription = async () => {
    if (!pushSupported || !pushConfigured || pushBusy) return
    setPushBusy(true)
    try {
      const registration = await navigator.serviceWorker.ready
      if (pushSubscribed) {
        const subscription = await registration.pushManager.getSubscription()
        if (subscription) {
          await fetch('/api/push/subscriptions/', { method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ endpoint: subscription.endpoint }) })
          await subscription.unsubscribe()
        }
        setPushSubscribed(false)
      } else {
        const permission = await Notification.requestPermission()
        setBrowserPermission(permission)
        if (permission !== 'granted') return
        const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(pushPublicKey) })
        const subscriptionJson = subscription.toJSON()
        await fetch('/api/push/subscriptions/', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ endpoint: subscriptionJson.endpoint, keys: subscriptionJson.keys }) })
        setPushSubscribed(true)
      }
    } catch {
      // Leave state as-is so the user can retry from the same button.
    } finally {
      setPushBusy(false)
    }
  }
  const handleAvatarChange = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setAvatarUploading(true)
    setAvatarError('')
    try {
      const body = new FormData()
      body.append('avatar', file)
      const response = await fetch('/api/auth/me/avatar/', { method: 'POST', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() }, body })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Photo could not be uploaded.')
      onProfileUpdated({ avatar_url: `${data.avatar_url}?t=${Date.now()}` })
    } catch (error) {
      setAvatarError(error.message || 'Photo could not be uploaded.')
    } finally {
      setAvatarUploading(false)
    }
  }
  const handleAvatarRemove = async () => {
    setAvatarUploading(true)
    setAvatarError('')
    try {
      const response = await fetch('/api/auth/me/avatar/', { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Photo could not be removed.')
      onProfileUpdated({ avatar_url: '' })
    } catch (error) {
      setAvatarError(error.message || 'Photo could not be removed.')
    } finally {
      setAvatarUploading(false)
    }
  }
  const handlePresenceChange = async event => {
    const presence = event.target.value
    setPresenceSaving(true)
    setPresenceError('')
    try {
      const response = await fetch('/api/auth/me/presence/', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ presence }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Presence could not be updated.')
      onProfileUpdated({ presence: data.presence })
    } catch (error) {
      setPresenceError(error.message || 'Presence could not be updated.')
    } finally {
      setPresenceSaving(false)
    }
  }
  useEffect(() => {
    const names = currentUserName.split(' ')
    setProfileForm(current => ({ first_name: names.shift() || '', last_name: names.join(' '), email: currentUserEmail }))
  }, [currentUserName, currentUserEmail])
  const saveProfile = async event => {
    event.preventDefault()
    setProfileSaving(true)
    setProfileError('')
    try {
      const response = await fetch('/api/auth/me/profile/', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify(profileForm) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Profile could not be updated.')
      onProfileUpdated(data.user)
      window.dispatchEvent(new CustomEvent('workspace:notice', { detail: 'Profile updated.' }))
    } catch (error) {
      setProfileError(error.message || 'Profile could not be updated.')
    } finally {
      setProfileSaving(false)
    }
  }
  const [taskTemplateForm, setTaskTemplateForm] = useState({ name: '', title: '', description: '', priority: 'normal', bucket: 'Backlog', recurrence: 'none', project_id: '', assignee_id: '', workstream: '' })
  const [projectTemplateForm, setProjectTemplateForm] = useState({ name: '', project_name: '', description: '', due_days: 14 })
  const [templateSaving, setTemplateSaving] = useState(false)
  const [templateError, setTemplateError] = useState('')
  const createTaskTemplate = async event => {
    event.preventDefault()
    setTemplateSaving(true)
    setTemplateError('')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/task-templates/`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify(taskTemplateForm) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Task template could not be created.')
      setTaskTemplateForm({ name: '', title: '', description: '', priority: 'normal', bucket: 'Backlog', recurrence: 'none', project_id: '', assignee_id: '', workstream: '' })
      onRefresh?.()
    } catch (error) { setTemplateError(error.message) } finally { setTemplateSaving(false) }
  }
  const createProjectTemplate = async event => {
    event.preventDefault()
    setTemplateSaving(true)
    setTemplateError('')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/project-templates/`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify(projectTemplateForm) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Project template could not be created.')
      setProjectTemplateForm({ name: '', project_name: '', description: '', due_days: 14 })
      onRefresh?.()
    } catch (error) { setTemplateError(error.message) } finally { setTemplateSaving(false) }
  }
  const deleteTaskTemplate = async template => {
    const response = await fetch(`/api/workspaces/${workspaceId}/task-templates/${template.id}/`, { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } })
    if (response.ok) onRefresh?.()
  }
  const deleteProjectTemplate = async template => {
    const response = await fetch(`/api/workspaces/${workspaceId}/project-templates/${template.id}/`, { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } })
    if (response.ok) onRefresh?.()
  }
  const applyTaskTemplate = async template => {
    const response = await fetch(`/api/workspaces/${workspaceId}/task-templates/${template.id}/apply/`, { method: 'POST', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } })
    const data = await response.json()
    if (!response.ok) return setTemplateError(data.error || 'Task could not be created from template.')
    window.dispatchEvent(new CustomEvent('workspace:notice', { detail: `Task created from ${template.name}.` }))
    onRefresh?.()
  }
  const applyProjectTemplate = async template => {
    const response = await fetch(`/api/workspaces/${workspaceId}/project-templates/${template.id}/apply/`, { method: 'POST', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } })
    const data = await response.json()
    if (!response.ok) return setTemplateError(data.error || 'Project could not be created from template.')
    window.dispatchEvent(new CustomEvent('workspace:notice', { detail: `Project created from ${template.name}.` }))
    onRefresh?.()
  }
  const roleLabel = currentWorkspace?.role === 'owner' ? 'Owner' : currentWorkspace?.role === 'manager' ? 'Manager' : 'Member'
  const unreadCount = notifications.filter(notification => !notification.read).length
  return <section className="workspace-view settings-view">
    <WorkspaceViewHeading title="Settings" subtitle="Control your workspace, account, and notification preferences." />
    <div className="settings-shell">
      <nav className="settings-nav" aria-label="Settings sections">{sections.map(([value, label, Icon]) => <button type="button" key={value} className={section === value ? 'active' : ''} onClick={() => setSection(value)}><Icon size={16} />{label}</button>)}</nav>
      <div className="settings-content">
        {section === 'appearance' && <Card className="settings-panel"><div className="settings-panel-heading"><div><p className="eyebrow">Personal preferences</p><h2>Appearance</h2><p>Choose how WorkSpace looks on this device.</p></div></div><div className="settings-row settings-control-row"><div><strong>Theme</strong><span>Light, dark, or follow your operating system.</span></div><div className="settings-segmented" role="radiogroup" aria-label="Theme"><button type="button" className={theme === 'light' ? 'active' : ''} onClick={() => onSetTheme('light')}>Light</button><button type="button" className={theme === 'dark' ? 'active' : ''} onClick={() => onSetTheme('dark')}>Dark</button><button type="button" className={theme === 'system' ? 'active' : ''} onClick={() => onSetTheme('system')}>System</button></div></div><div className="settings-row settings-control-row"><div><strong>Sidebar</strong><span>Use a full navigation menu or compact icon rail.</span></div><button type="button" className="settings-switch" aria-pressed={!sidebarCollapsed} onClick={onToggleSidebar}><span />{sidebarCollapsed ? 'Collapsed' : 'Expanded'}</button></div></Card>}
        {section === 'ai' && <AISettingsPanel workspaceId={workspaceId} members={members} canManageMembers={canManageMembers} />}
        {section === 'notifications' && <Card className="settings-panel"><div className="settings-panel-heading"><div><p className="eyebrow">Stay informed</p><h2>Notifications</h2><p>{unreadCount ? `${unreadCount} unread workspace updates.` : 'You are all caught up.'}</p></div></div>{notificationPrefs ? preferenceRows.map(([key, label, description]) => <div className="settings-row settings-control-row" key={key}><div><strong>{label}</strong><span>{description}</span></div><button type="button" className={`settings-switch ${notificationPrefs[key] ? 'is-on' : ''}`} aria-pressed={notificationPrefs[key]} onClick={() => updatePreference(key, !notificationPrefs[key])}><span />{notificationPrefs[key] ? 'On' : 'Off'}</button></div>) : <p className="settings-note">Loading your preferences…</p>}{prefsError && <p className="auth-error" role="alert">{prefsError}</p>}<div className="settings-row settings-control-row"><div><strong>Desktop notifications</strong><span>{browserPermission === 'granted' ? 'Enabled in this browser.' : browserPermission === 'denied' ? 'Blocked - allow notifications for this site in your browser settings.' : browserPermission === 'unsupported' ? 'Not supported in this browser.' : 'Get a native alert for calendar reminders.'}</span></div>{browserPermission === 'default' && <button type="button" className="secondary-button" onClick={requestBrowserPermission}>Enable</button>}</div>{pushSupported && pushConfigured && <div className="settings-row settings-control-row"><div><strong>Push notifications</strong><span>{pushSubscribed ? 'Enabled on this device - alerts arrive even when WorkSpace is closed.' : 'Get alerts on this device even when WorkSpace is closed.'}</span></div><button type="button" className="secondary-button" disabled={pushBusy} onClick={togglePushSubscription}>{pushBusy ? 'Working...' : pushSubscribed ? 'Disable' : 'Enable'}</button></div>}<p className="settings-note">Turning a category off stops those notifications from being created for you, on every device.</p></Card>}
        {section === 'profile' && <Card className="settings-panel"><div className="settings-panel-heading"><div><p className="eyebrow">Your account</p><h2>Profile</h2><p>Your identity as it appears across the workspace.</p></div></div><div className="settings-profile-card"><span className="avatar-upload"><Avatar name={currentUserName} avatarUrl={currentUserAvatarUrl} presence={currentUserPresence} className="settings-profile-avatar" /><label className="avatar-upload-trigger" aria-label="Change profile photo"><Camera size={14} /><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={handleAvatarChange} disabled={avatarUploading} /></label></span><div><strong>{currentUserName}</strong><span>{currentWorkspace?.name || 'Workspace member'}</span>{currentUserAvatarUrl && <button type="button" className="text-button" onClick={handleAvatarRemove} disabled={avatarUploading}>Remove photo</button>}</div></div>{avatarError && <p className="auth-error" role="alert">{avatarError}</p>}<form className="settings-profile-form" onSubmit={saveProfile}><div className="modal-grid"><label>First name<input value={profileForm.first_name} onChange={event => setProfileForm(current => ({ ...current, first_name: event.target.value }))} maxLength="150" required /></label><label>Last name<input value={profileForm.last_name} onChange={event => setProfileForm(current => ({ ...current, last_name: event.target.value }))} maxLength="150" /></label></div><label>Email address<input type="email" value={profileForm.email} onChange={event => setProfileForm(current => ({ ...current, email: event.target.value }))} required /></label>{profileError && <p className="auth-error" role="alert">{profileError}</p>}<button className="secondary-button" disabled={profileSaving}>{profileSaving ? 'Saving…' : 'Save profile'}</button></form><div className="settings-row settings-control-row"><div><strong>Presence</strong><span>Shown to teammates next to your name, like a status in Teams.</span></div><span className="presence-select"><span className={`presence-dot presence-${currentUserPresence}`} /><AppSelect value={currentUserPresence} onChange={handlePresenceChange} disabled={presenceSaving} aria-label="Set your presence"><option value="available">Available</option><option value="busy">Busy</option><option value="away">Away</option><option value="offline">Offline</option></AppSelect></span></div>{presenceError && <p className="auth-error" role="alert">{presenceError}</p>}<div className="settings-row"><div><strong>Workspace role</strong><span>Access level for this workspace.</span></div><em>{roleLabel}</em></div><p className="settings-note">Password changes remain available through your account provider.</p></Card>}
        {section === 'templates' && <Card className="settings-panel"><div className="settings-panel-heading"><div><p className="eyebrow">Reusable setup</p><h2>Templates</h2><p>Create templates for repeatable tasks and projects, then apply them from the create forms.</p></div></div><div className="settings-template-section"><h3>Task templates</h3><form className="settings-template-form" onSubmit={createTaskTemplate}><label>Template name<input value={taskTemplateForm.name} onChange={event => setTaskTemplateForm(current => ({ ...current, name: event.target.value }))} required /></label><label>Task title<input value={taskTemplateForm.title} onChange={event => setTaskTemplateForm(current => ({ ...current, title: event.target.value }))} required /></label><label>Description<textarea value={taskTemplateForm.description} onChange={event => setTaskTemplateForm(current => ({ ...current, description: event.target.value }))} /></label><div className="modal-grid"><label>Priority<AppSelect value={taskTemplateForm.priority} onChange={event => setTaskTemplateForm(current => ({ ...current, priority: event.target.value }))}><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></AppSelect></label><label>Bucket<input value={taskTemplateForm.bucket} onChange={event => setTaskTemplateForm(current => ({ ...current, bucket: event.target.value }))} /></label><label>Repeat<AppSelect value={taskTemplateForm.recurrence} onChange={event => setTaskTemplateForm(current => ({ ...current, recurrence: event.target.value }))}><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></AppSelect></label><label>Assignee<AppSelect value={taskTemplateForm.assignee_id} onChange={event => setTaskTemplateForm(current => ({ ...current, assignee_id: event.target.value }))}><option value="">Unassigned</option>{members.map(member => <option key={member.id} value={member.id}>{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}</option>)}</AppSelect></label><label>Project<AppSelect value={taskTemplateForm.project_id} onChange={event => setTaskTemplateForm(current => ({ ...current, project_id: event.target.value }))}><option value="">General</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</AppSelect></label><label>Workstream<input value={taskTemplateForm.workstream} onChange={event => setTaskTemplateForm(current => ({ ...current, workstream: event.target.value }))} /></label></div><button className="secondary-button" disabled={templateSaving}>{templateSaving ? 'Saving…' : 'Create task template'}</button></form><div className="settings-template-list">{taskTemplates.map(template => <div className="settings-template-row" key={template.id}><div><strong>{template.name}</strong><span>{template.title} · {template.priority} · {template.bucket}</span></div><button type="button" className="secondary-button" onClick={() => applyTaskTemplate(template)}>Use</button>{canManageMembers && <button type="button" className="inline-delete" onClick={() => deleteTaskTemplate(template)} aria-label={`Delete ${template.name}`}><X size={14} /></button>}</div>)}</div></div><div className="settings-template-section"><h3>Project templates</h3><form className="settings-template-form" onSubmit={createProjectTemplate}><label>Template name<input value={projectTemplateForm.name} onChange={event => setProjectTemplateForm(current => ({ ...current, name: event.target.value }))} required /></label><label>Project name<input value={projectTemplateForm.project_name} onChange={event => setProjectTemplateForm(current => ({ ...current, project_name: event.target.value }))} required /></label><label>Description<textarea value={projectTemplateForm.description} onChange={event => setProjectTemplateForm(current => ({ ...current, description: event.target.value }))} /></label><label>Due in days<input type="number" min="0" max="365" value={projectTemplateForm.due_days} onChange={event => setProjectTemplateForm(current => ({ ...current, due_days: event.target.value }))} /></label><button className="secondary-button" disabled={templateSaving}>{templateSaving ? 'Saving…' : 'Create project template'}</button></form><div className="settings-template-list">{projectTemplates.map(template => <div className="settings-template-row" key={template.id}><div><strong>{template.name}</strong><span>{template.project_name} · {template.due_days} days</span></div><button type="button" className="secondary-button" onClick={() => applyProjectTemplate(template)}>Use</button>{canManageMembers && <button type="button" className="inline-delete" onClick={() => deleteProjectTemplate(template)} aria-label={`Delete ${template.name}`}><X size={14} /></button>}</div>)}</div></div>{templateError && <p className="auth-error" role="alert">{templateError}</p>}</Card>}{section === 'workspace' && <Card className="settings-panel"><div className="settings-panel-heading"><div><p className="eyebrow">Workspace administration</p><h2>Workspace access</h2><p>Review who can access {currentWorkspace?.name || 'this workspace'}.</p></div></div><div className="settings-stat-grid"><div><strong>{members.length}</strong><span>Members</span></div><div><strong>{members.filter(member => member.role === 'owner' || member.role === 'manager').length}</strong><span>Managers</span></div><div><strong>{currentWorkspace?.role === 'owner' ? 'Owner' : canManageMembers ? 'Manager' : 'Member'}</strong><span>Your role</span></div></div><div className="settings-member-list">{members.slice(0, 8).map(member => <div className="settings-member-row" key={member.id}><Avatar name={[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email} avatarUrl={member.avatar_url} presence={member.presence} small /><div><strong>{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}</strong><span>{member.email}</span></div><em>{member.role}</em></div>)}</div>{canManageMembers && <p className="settings-note">Member invitations and role changes are available from Team board.</p>}</Card>}
        {section === 'integrations' && <Card className="settings-panel"><div className="settings-panel-heading"><div><p className="eyebrow">Connect other tools</p><h2>Integrations</h2><p>Send WorkSpace notifications to Microsoft Teams or Slack, and subscribe to the team calendar from Outlook or Google Calendar.</p></div></div>
          <div className="settings-row settings-control-row"><div><strong>Calendar subscribe link</strong><span>Add this feed to Outlook, Google Calendar, or Apple Calendar - it updates automatically as events change.</span></div></div>
          {calendarSubscribeUrl ? <div className="settings-webhook-url-row"><Link2 size={14} /><code>{calendarSubscribeUrl}</code><Button type="button" variant="ghost" size="icon-sm" onClick={copyCalendarSubscribeUrl} aria-label="Copy subscribe link"><Copy size={14} /></Button></div> : <p className="settings-note">Loading your subscribe link…</p>}
          {canManageMembers && <button type="button" className="text-button" disabled={calendarTokenSaving} onClick={resetCalendarToken}>{calendarTokenSaving ? 'Resetting…' : 'Reset link'}</button>}
          <div className="settings-row settings-control-row" style={{ marginTop: '1rem' }}><div><strong>Webhooks</strong><span>Post task, calendar, and chat notifications to a Teams or Slack channel.</span></div></div>
          {webhooksError && <p className="auth-error" role="alert">{webhooksError}</p>}
          <div className="settings-webhook-list">{webhooks.length ? webhooks.map(hook => <div className="settings-webhook-row" key={hook.id}><Webhook size={14} /><div><strong>{hook.label || (hook.kind === 'teams' ? 'Microsoft Teams' : hook.kind === 'slack' ? 'Slack' : 'Generic webhook')}</strong><span>{hook.url}</span></div><button type="button" className={`settings-switch ${hook.is_active ? 'is-on' : ''}`} aria-pressed={hook.is_active} onClick={() => toggleWebhook(hook)}><span />{hook.is_active ? 'On' : 'Off'}</button>{canManageMembers && <Button type="button" variant="ghost" size="icon-sm" onClick={() => deleteWebhook(hook)} aria-label={`Remove ${hook.label || hook.url}`}><X size={14} /></Button>}</div>) : <p className="settings-note">No webhooks connected yet.</p>}</div>
          {canManageMembers && <form className="settings-webhook-form" onSubmit={addWebhook}><AppSelect value={webhookForm.kind} onChange={event => setWebhookForm(current => ({ ...current, kind: event.target.value }))} aria-label="Webhook type"><option value="teams">Microsoft Teams</option><option value="slack">Slack</option><option value="generic">Generic JSON</option></AppSelect><input type="url" required placeholder="https://... incoming webhook URL" value={webhookForm.url} onChange={event => setWebhookForm(current => ({ ...current, url: event.target.value }))} aria-label="Webhook URL" /><input type="text" placeholder="Label (optional)" value={webhookForm.label} onChange={event => setWebhookForm(current => ({ ...current, label: event.target.value }))} aria-label="Webhook label" maxLength={120} /><Button type="submit" disabled={webhookSaving}>{webhookSaving ? 'Connecting…' : 'Connect'}</Button></form>}
          {!canManageMembers && <p className="settings-note">Only owners and managers can connect or remove webhooks.</p>}
        </Card>}
      </div>
    </div>
  </section>
}

export default SettingsView
