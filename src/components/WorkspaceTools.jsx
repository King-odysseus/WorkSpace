import React, { useEffect, useRef, useState } from 'react'
import { Bold, Bot, Download, FileText, HelpCircle, Italic, List, Plus, Presentation, Save, Send, Sparkles, Underline, Upload, X } from 'lucide-react'
import { Card } from './ui/card.jsx'

const headers = id => ({ 'X-Workspace-Id': String(id) })
const AI_PROVIDERS = [['openai', 'OpenAI'], ['claude', 'Claude'], ['kimi', 'Kimi'], ['deepseek', 'DeepSeek']]
async function csrf(extra = {}) {
  await fetch('/api/auth/csrf/', { credentials: 'include' })
  const token = document.cookie.split('; ').find(value => value.startsWith('csrftoken='))?.split('=')[1] || ''
  return { ...extra, 'X-CSRFToken': token }
}

function cleanHtml(value) {
  if (typeof window === 'undefined') return value || ''
  const doc = new DOMParser().parseFromString(value || '', 'text/html')
  doc.querySelectorAll('script,style,iframe,object,embed').forEach(node => node.remove())
  doc.querySelectorAll('*').forEach(node => [...node.attributes].forEach(attribute => { if (attribute.name.toLowerCase().startsWith('on')) node.removeAttribute(attribute.name) }))
  return doc.body.innerHTML
}

function RichEditor({ value, onChange }) {
  const editorRef = useRef(null)
  useEffect(() => { if (editorRef.current && editorRef.current.innerHTML !== value) editorRef.current.innerHTML = cleanHtml(value) }, [value])
  const command = (name, argument = null) => { editorRef.current?.focus(); document.execCommand(name, false, argument); onChange(editorRef.current?.innerHTML || '') }
  return <div className="overflow-hidden rounded-xl border border-border bg-surface-secondary"><div className="flex flex-wrap gap-1 border-b border-border bg-surface px-3 py-2"><button type="button" className="rounded-lg p-2 hover:bg-surface-secondary" onClick={() => command('bold')} aria-label="Bold"><Bold size={15} /></button><button type="button" className="rounded-lg p-2 hover:bg-surface-secondary" onClick={() => command('italic')} aria-label="Italic"><Italic size={15} /></button><button type="button" className="rounded-lg p-2 hover:bg-surface-secondary" onClick={() => command('underline')} aria-label="Underline"><Underline size={15} /></button><button type="button" className="rounded-lg p-2 hover:bg-surface-secondary" onClick={() => command('insertUnorderedList')} aria-label="Bulleted list"><List size={15} /></button><select className="rounded-lg border border-border bg-surface px-2 text-xs" onChange={event => command('formatBlock', event.target.value)} defaultValue="p" aria-label="Text style"><option value="p">Paragraph</option><option value="h2">Heading</option><option value="h3">Subheading</option><option value="blockquote">Quote</option></select></div><div ref={editorRef} contentEditable suppressContentEditableWarning onInput={event => onChange(cleanHtml(event.currentTarget.innerHTML))} className="min-h-[390px] p-5 text-sm leading-7 outline-none" data-placeholder="Start writing…" /> </div>
}

export function FilesWorkspaceView({ workspaceId }) {
  const [documents, setDocuments] = useState([]); const [files, setFiles] = useState([]); const [selected, setSelected] = useState(null); const [draft, setDraft] = useState(''); const [kind, setKind] = useState('document'); const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false)
  const load = () => Promise.all([fetch(`/api/workspaces/${workspaceId}/documents/`, { credentials: 'include', headers: headers(workspaceId) }).then(r => r.json()), fetch(`/api/workspaces/${workspaceId}/files/`, { credentials: 'include', headers: headers(workspaceId) }).then(r => r.json())]).then(([docs, uploaded]) => { const nextDocuments = docs.documents || []; setDocuments(nextDocuments); setFiles(uploaded.files || []); const requested = localStorage.getItem('workspace-open-document-id'); const requestedDocument = nextDocuments.find(document => String(document.id) === requested); if (requestedDocument) { setSelected(requestedDocument); setKind(requestedDocument.kind); setDraft(requestedDocument.kind === 'presentation' ? (requestedDocument.content?.slides || []).map(slide => `${slide.title || 'Slide'}\n${slide.body || ''}`).join('\n---\n') : requestedDocument.content?.html || requestedDocument.content?.text || ''); localStorage.removeItem('workspace-open-document-id') } })
  useEffect(() => { load().catch(() => setStatus('Could not load workspace files.')) }, [workspaceId])
  const createDocument = async () => { setBusy(true); setStatus('Creating…'); try { const response = await fetch(`/api/workspaces/${workspaceId}/documents/`, { method: 'POST', credentials: 'include', headers: await csrf({ ...headers(workspaceId), 'Content-Type': 'application/json' }), body: JSON.stringify({ title: kind === 'presentation' ? 'Untitled presentation' : 'Untitled document', kind, content: kind === 'presentation' ? { slides: [{ title: 'New slide', body: '' }] } : { text: '' } }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not create document.'); setDocuments(current => [data.document, ...current]); setSelected(data.document); setDraft(kind === 'presentation' ? 'New slide\n' : ''); setStatus('Ready to edit') } catch (error) { setStatus(error.message) } finally { setBusy(false) } }
  const save = async () => { if (!selected) return; setBusy(true); const content = selected.kind === 'presentation' ? { slides: draft.split('\n---\n').map(slide => ({ title: slide.split('\n')[0] || 'Slide', body: slide.split('\n').slice(1).join('\n') })) } : { html: cleanHtml(draft), text: cleanHtml(draft).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }; try { const response = await fetch(`/api/workspaces/${workspaceId}/documents/${selected.id}/`, { method: 'PATCH', credentials: 'include', headers: await csrf({ ...headers(workspaceId), 'Content-Type': 'application/json' }), body: JSON.stringify({ title: selected.title, content }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not save changes.'); setSelected(data.document); setDocuments(current => current.map(item => item.id === data.document.id ? data.document : item)); setStatus('Saved') } catch (error) { setStatus(error.message) } finally { setBusy(false) } }
  const remove = async () => { if (!selected || !window.confirm(`Delete “${selected.title}”?`)) return; setBusy(true); try { const response = await fetch(`/api/workspaces/${workspaceId}/documents/${selected.id}/`, { method: 'DELETE', credentials: 'include', headers: await csrf(headers(workspaceId)) }); if (!response.ok) throw new Error('Could not delete document.'); setDocuments(current => current.filter(item => item.id !== selected.id)); setSelected(null); setDraft(''); setStatus('Document deleted') } catch (error) { setStatus(error.message) } finally { setBusy(false) } }
  const upload = async event => { const file = event.target.files?.[0]; if (!file) return; const form = new FormData(); form.append('file', file); try { const response = await fetch(`/api/workspaces/${workspaceId}/files/`, { method: 'POST', credentials: 'include', headers: await csrf(headers(workspaceId)), body: form }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Upload failed'); setFiles(current => [data.file, ...current]); setStatus('File uploaded') } catch (error) { setStatus(error.message) } event.target.value = '' }
  const openDocument = document => { setSelected(document); setKind(document.kind); setDraft(document.kind === 'presentation' ? (document.content?.slides || []).map(slide => `${slide.title || 'Slide'}\n${slide.body || ''}`).join('\n---\n') : document.content?.html || document.content?.text || '') }
  return <section className="workspace-view"><div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Workspace resources</p><h2>Documents & files</h2><p className="text-sm text-text-muted">Create editable documents and presentations, or upload files for your team.</p></div><div className="flex gap-2"><select value={kind} onChange={event => setKind(event.target.value)} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"><option value="document">Document</option><option value="presentation">Presentation</option></select><button type="button" className="primary-button" onClick={createDocument} disabled={busy}><Plus size={15} /> {busy ? 'Working…' : 'New'}</button><label className="secondary-button cursor-pointer"><Upload size={15} /> Upload<input type="file" className="hidden" onChange={upload} /></label></div></div>{status && <p className="workspace-inline-status" role="status">{status}</p>}<div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]"><Card className="p-5"><div className="mb-3 flex items-center gap-2"><input value={selected?.title || ''} onChange={event => setSelected(current => current ? { ...current, title: event.target.value } : current)} disabled={!selected} className="min-w-0 flex-1 rounded-lg border border-border bg-surface-secondary px-3 py-2 text-lg font-semibold outline-none focus:border-accent" placeholder="Document title" />{selected && <><button type="button" className="primary-button" onClick={save} disabled={busy}><Save size={15} /> Save</button><button type="button" className="rounded-lg p-2 text-danger hover:bg-danger/10" onClick={remove} disabled={busy} aria-label="Delete document"><X size={17} /></button></>}</div>{selected ? selected.kind === 'presentation' ? <textarea value={draft} onChange={event => setDraft(event.target.value)} className="min-h-[430px] w-full resize-y rounded-xl border border-border bg-surface-secondary p-4 font-mono text-sm leading-6 outline-none focus:border-accent" aria-label="Presentation editor" placeholder="Slide title and body. Separate slides with ---" /> : <RichEditor value={draft} onChange={setDraft} /> : <div className="flex min-h-[430px] items-center justify-center text-sm text-text-muted">Choose a document or create a new one.</div>}</Card><div className="space-y-5"><Card className="p-4"><h3 className="mb-3">Editable content</h3>{documents.length ? documents.map(document => <button type="button" key={document.id} onClick={() => openDocument(document)} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm hover:bg-surface-secondary"><span className="rounded-lg bg-accent/15 p-2 text-accent">{document.kind === 'presentation' ? <Presentation size={16} /> : <FileText size={16} />}</span><span className="min-w-0 flex-1 truncate">{document.title}</span></button>) : <p className="text-sm text-text-muted">No editable documents yet.</p>}</Card><Card className="p-4"><h3 className="mb-3">Uploaded files</h3>{files.length ? files.map(file => <a key={file.id} href={file.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm hover:bg-surface-secondary"><FileText size={16} className="text-text-muted" /><span className="min-w-0 flex-1 truncate">{file.original_name}</span><Download size={14} /></a>) : <p className="text-sm text-text-muted">No uploaded files yet.</p>}</Card></div></div></section>
}

export function AssistantFlyout({ workspaceId, onClose }) {
  const [data, setData] = useState(null); const [provider, setProvider] = useState('openai'); const [message, setMessage] = useState(''); const [answer, setAnswer] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { fetch(`/api/workspaces/${workspaceId}/ai/settings/`, { credentials: 'include', headers: headers(workspaceId) }).then(r => r.json()).then(result => { if (result.settings) { setData(result); setProvider(result.settings.ai_default_provider || 'openai') } else setError(result.error || 'Assistant unavailable.') }).catch(() => setError('Assistant unavailable.')) }, [workspaceId])
  const ask = async event => { event.preventDefault(); if (!message.trim()) return; setBusy(true); setError(''); try { const response = await fetch(`/api/workspaces/${workspaceId}/ai/chat/`, { method: 'POST', credentials: 'include', headers: await csrf({ ...headers(workspaceId), 'Content-Type': 'application/json' }), body: JSON.stringify({ message, provider }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Assistant unavailable.'); setAnswer(result.answer); setMessage('') } catch (requestError) { setError(requestError.message) } finally { setBusy(false) } }
  const providers = data?.providers || {}; const enabled = data?.settings?.ai_enabled_providers || Object.keys(providers).filter(key => providers[key])
  return <aside className="ai-chat-window fixed bottom-5 right-4 z-[80] flex w-[min(350px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl lg:bottom-6 lg:right-6"><div className="flex items-center justify-between bg-navy px-3 py-2 text-white"><div className="flex min-w-0 items-center gap-2"><span className="rounded-lg bg-accent/20 p-1.5 text-accent"><Bot size={15} /></span><strong className="shrink-0 text-xs">AI assistant</strong></div><button type="button" className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white" onClick={onClose} aria-label="Close assistant"><X size={15} /></button></div>{(answer || error) && <div className="max-h-[210px] overflow-y-auto p-3">{answer && <div className="whitespace-pre-wrap rounded-xl rounded-bl-sm bg-surface-secondary p-3 text-xs leading-5">{answer}</div>}{error && <div className="rounded-xl bg-danger/10 p-2.5 text-xs text-danger">{error}</div>}</div>}<form onSubmit={ask} className="p-2"><div className="flex items-center gap-1.5 rounded-xl bg-surface-secondary p-1"><textarea value={message} onChange={event => setMessage(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form.requestSubmit() } }} className="ai-chat-input max-h-20 min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 text-xs outline-none" placeholder="Ask anything…" /><button className="rounded-lg bg-accent p-2 text-navy disabled:opacity-40" disabled={busy || !message.trim()} aria-label="Send message"><Send size={14} /></button></div></form></aside>
}

function LegacyAISettingsPanel({ workspaceId, members, canManageMembers }) {
  const [data, setData] = useState(null); const [helpOpen, setHelpOpen] = useState(false); const [notice, setNotice] = useState('')
  useEffect(() => { fetch(`/api/workspaces/${workspaceId}/ai/settings/`, { credentials: 'include', headers: headers(workspaceId) }).then(r => r.json()).then(setData) }, [workspaceId])
  if (!data) return <Card className="settings-panel p-5">Loading AI settings…</Card>
  const settings = { ai_enabled: false, ai_user_ids: [], ai_enabled_providers: [], ai_default_provider: 'openai', ...(data.settings || {}) }; settings.ai_user_ids = settings.ai_user_ids || []; settings.ai_enabled_providers = settings.ai_enabled_providers || []; const providers = data.providers || {}; const toggle = provider => setData(current => ({ ...current, settings: { ...current.settings, ai_enabled_providers: (current.settings.ai_enabled_providers || []).includes(provider) ? current.settings.ai_enabled_providers.filter(value => value !== provider) : [...(current.settings.ai_enabled_providers || []), provider] } })); const toggleMember = id => setData(current => ({ ...current, settings: { ...current.settings, ai_user_ids: (current.settings.ai_user_ids || []).includes(id) ? current.settings.ai_user_ids.filter(value => value !== id) : [...(current.settings.ai_user_ids || []), id] } }))
  const save = async () => { const response = await fetch(`/api/workspaces/${workspaceId}/ai/settings/`, { method: 'PATCH', credentials: 'include', headers: await csrf({ ...headers(workspaceId), 'Content-Type': 'application/json' }), body: JSON.stringify(settings) }); const result = await response.json(); setNotice(response.ok ? 'AI settings saved.' : (result.error || 'Could not save settings.')); if (response.ok) setData(current => ({ ...current, settings: result.settings })) }
  return <Card className="settings-panel p-5"><div className="flex items-start justify-between gap-3"><div><p className="eyebrow">Company assistant</p><h2>AI providers & access</h2><p className="text-sm text-text-muted">Keys stay server-side. Configure them in Railway environment variables.</p></div><button type="button" className="secondary-button" onClick={() => setHelpOpen(current => !current)}><HelpCircle size={15} /> Setup help</button></div>{helpOpen && <div className="mt-4 rounded-xl bg-accent/10 p-4 text-sm leading-6"><strong>Configuration help</strong><p className="mt-1">Set <code>OPENAI_API_KEY</code>, <code>ANTHROPIC_API_KEY</code>, <code>KIMI_API_KEY</code>, or <code>DEEPSEEK_API_KEY</code> on the server, then redeploy. API usage is billed by each provider.</p></div>}<div className="mt-5 space-y-2">{AI_PROVIDERS.map(([key, label]) => <label key={key} className="flex items-center gap-3 rounded-xl bg-surface-secondary p-3"><input type="checkbox" checked={settings.ai_enabled_providers.includes(key)} onChange={() => toggle(key)} disabled={!providers[key] || !canManageMembers} /><span className="flex-1"><strong>{label}</strong><small className="block text-text-muted">{providers[key] ? 'API key configured' : 'Add the API key in Railway first'}</small></span></label>)}</div><label className="mt-4 block text-sm">Default provider<select value={settings.ai_default_provider} onChange={event => setData(current => ({ ...current, settings: { ...current.settings, ai_default_provider: event.target.value } }))} className="mt-1 w-full rounded-lg bg-surface-secondary px-3 py-2" disabled={!canManageMembers}>{AI_PROVIDERS.map(([key, label]) => <option key={key} value={key} disabled={!providers[key]}>{label}{providers[key] ? '' : ' — key required'}</option>)}</select></label>{canManageMembers && <><label className="settings-switch mt-4"><input type="checkbox" checked={settings.ai_enabled} onChange={event => setData(current => ({ ...current, settings: { ...current.settings, ai_enabled: event.target.checked } }))} /> Enable assistant</label><div className="mt-4"><p className="text-sm font-semibold">Members with access</p>{members.map(member => <label key={member.id} className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-surface-secondary"><input type="checkbox" checked={settings.ai_user_ids.includes(member.id)} onChange={() => toggleMember(member.id)} />{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}</label>)}</div><button type="button" className="primary-button mt-4" onClick={save}><Save size={15} /> Save AI settings</button></>}{notice && <p className="workspace-inline-status mt-3">{notice}</p>}</Card>
}

export function AISettingsPanel({ workspaceId, members = [], canManageMembers }) {
  const [data, setData] = useState(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingProvider, setSavingProvider] = useState('')
  const [providerNotices, setProviderNotices] = useState({})

  useEffect(() => {
    let active = true
    fetch(`/api/workspaces/${workspaceId}/ai/settings/`, { credentials: 'include', headers: headers(workspaceId) })
      .then(async response => ({ ok: response.ok, result: await response.json() }))
      .then(({ ok, result }) => {
        if (!active) return
        setData(ok ? result : { error: result.error || 'AI settings could not be loaded.' })
      })
      .catch(() => active && setData({ error: 'AI settings could not be loaded.' }))
    return () => { active = false }
  }, [workspaceId])

  if (!data) return <Card className="settings-panel p-5">Loading AI settings…</Card>
  if (data.error) return <Card className="settings-panel p-5"><p className="auth-error" role="alert">{data.error}</p></Card>

  const settings = {
    ai_enabled: false,
    ai_user_ids: [],
    ai_enabled_providers: [],
    ai_default_provider: 'openai',
    ...(data.settings || {}),
  }
  settings.ai_user_ids = settings.ai_user_ids || []
  settings.ai_enabled_providers = settings.ai_enabled_providers || []
  const providerConfig = data.provider_config || {}
  const mayManage = Boolean(data.can_manage)

  const updateSettings = changes => setData(current => ({
    ...current,
    settings: { ...current.settings, ...changes },
  }))
  const updateProvider = (provider, changes) => setData(current => ({
    ...current,
    provider_config: {
      ...current.provider_config,
      [provider]: { ...(current.provider_config?.[provider] || {}), ...changes },
    },
  }))
  const toggleProvider = provider => {
    const enabled = settings.ai_enabled_providers.includes(provider)
    updateSettings({ ai_enabled_providers: enabled
      ? settings.ai_enabled_providers.filter(value => value !== provider)
      : [...settings.ai_enabled_providers, provider] })
  }
  const toggleMember = id => updateSettings({ ai_user_ids: settings.ai_user_ids.includes(id)
    ? settings.ai_user_ids.filter(value => value !== id)
    : [...settings.ai_user_ids, id] })

  const providerPayload = provider => {
    const config = providerConfig[provider] || {}
    return {
      base_url: config.base_url || '',
      model: config.model || '',
      api_key: config.api_key || '',
      clear_api_key: Boolean(config.clear_api_key),
    }
  }

  const saveProvider = async provider => {
    setSavingProvider(provider)
    setProviderNotices(current => ({ ...current, [provider]: '' }))
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/ai/settings/`, {
        method: 'PATCH',
        credentials: 'include',
        headers: await csrf({ ...headers(workspaceId), 'Content-Type': 'application/json' }),
        body: JSON.stringify({ ...settings, provider_config: { [provider]: providerPayload(provider) } }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || `Could not save ${provider}.`)
      setData(current => ({
        ...current,
        providers: result.providers,
        settings: result.settings,
        provider_config: {
          ...current.provider_config,
          [provider]: result.provider_config[provider],
        },
      }))
      setProviderNotices(current => ({ ...current, [provider]: 'Saved' }))
    } catch (error) {
      setProviderNotices(current => ({ ...current, [provider]: error.message || 'Could not save provider.' }))
    } finally {
      setSavingProvider('')
    }
  }

  const save = async () => {
    setSaving(true)
    setNotice('')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/ai/settings/`, {
        method: 'PATCH',
        credentials: 'include',
        headers: await csrf({ ...headers(workspaceId), 'Content-Type': 'application/json' }),
        body: JSON.stringify(settings),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not save AI settings.')
      setData(current => ({ ...current, ...result, can_manage: current.can_manage }))
      setNotice('Workspace AI access settings saved.')
    } catch (error) {
      setNotice(error.message || 'Could not save AI settings.')
    } finally {
      setSaving(false)
    }
  }

  return <Card className="settings-panel p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="eyebrow">Company assistant</p>
        <h2>AI providers & access</h2>
        <p className="text-sm text-text-muted">Add the company credentials here. API keys are encrypted and are never shown again.</p>
      </div>
      <button type="button" className="secondary-button" onClick={() => setHelpOpen(current => !current)}>
        <HelpCircle size={15} /> Setup help
      </button>
    </div>

    {helpOpen && <div className="mt-4 rounded-xl bg-accent/10 p-4 text-sm leading-6">
      <strong>How to connect a provider</strong>
      <p className="mt-1 text-text-muted">Create an API key in the provider's developer console, paste it below, check Enable, choose a model, then save. The default base URLs are already filled in. You only need to change one when using a compatible gateway or proxy.</p>
      <p className="mt-2 text-text-muted">Railway environment variables still work as a fallback, but they are no longer required for setup.</p>
    </div>}

    <div className="mt-5 space-y-3">
      {AI_PROVIDERS.map(([provider, label]) => {
        const config = providerConfig[provider] || {}
        const enabled = settings.ai_enabled_providers.includes(provider)
        const isDefault = settings.ai_default_provider === provider
        return <section key={provider} className="rounded-2xl bg-surface-secondary p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">{label}</h3>
              <p className="text-xs text-text-muted">{config.has_api_key && !config.clear_api_key ? `Key saved (${config.key_hint})` : 'No API key saved'}</p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="ai-provider-default">
                <input type="radio" name="company-default-ai-provider" checked={isDefault} onChange={() => updateSettings({ ai_default_provider: provider })} disabled={!mayManage} />
                <span>Company default</span>
              </label>
              <label className="ai-provider-switch">
                <input type="checkbox" checked={enabled} onChange={() => toggleProvider(provider)} disabled={!mayManage} />
                <span className="ai-provider-switch-track" aria-hidden="true"><span /></span>
                <span>{enabled ? 'Enabled' : 'Disabled'}</span>
              </label>
            </div>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <label className="text-sm lg:col-span-2">API key
              <input
                type="password"
                value={config.api_key || ''}
                onChange={event => updateProvider(provider, { api_key: event.target.value, clear_api_key: false })}
                placeholder={config.has_api_key ? `Leave blank to keep ${config.key_hint}` : `Paste your ${label} API key`}
                autoComplete="new-password"
                disabled={!mayManage}
                className="mt-1 w-full rounded-xl bg-surface px-3 py-2.5 outline-none focus:ring-2 focus:ring-accent/30"
              />
            </label>
            <label className="text-sm">Base URL
              <input
                type="url"
                value={config.base_url || ''}
                onChange={event => updateProvider(provider, { base_url: event.target.value })}
                disabled={!mayManage}
                className="mt-1 w-full rounded-xl bg-surface px-3 py-2.5 outline-none focus:ring-2 focus:ring-accent/30"
              />
            </label>
            <label className="text-sm">Model
              <input
                value={config.model || ''}
                onChange={event => updateProvider(provider, { model: event.target.value })}
                disabled={!mayManage}
                className="mt-1 w-full rounded-xl bg-surface px-3 py-2.5 outline-none focus:ring-2 focus:ring-accent/30"
              />
            </label>
          </div>
          {mayManage && config.has_api_key && <button
            type="button"
            className="mt-3 text-xs font-semibold text-danger"
            onClick={() => {
              const clearing = !config.clear_api_key
              updateProvider(provider, { api_key: '', clear_api_key: clearing })
              if (clearing && enabled) toggleProvider(provider)
            }}
          >{config.clear_api_key ? 'Keep saved key' : 'Remove saved key'}</button>}
          {mayManage && <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className="primary-button" onClick={() => saveProvider(provider)} disabled={Boolean(savingProvider)}>
              <Save size={15} /> {savingProvider === provider ? 'Saving…' : `Save ${label}`}
            </button>
            {providerNotices[provider] && <span className={`text-xs ${providerNotices[provider] === 'Saved' ? 'text-text-muted' : 'text-danger'}`} role="status">{providerNotices[provider]}</span>}
          </div>}
        </section>
      })}
    </div>

    <div className="mt-5">
      <label className="flex items-center gap-3 rounded-xl bg-surface-secondary px-4 py-3 text-sm font-semibold">
        <input type="checkbox" checked={settings.ai_enabled} onChange={event => updateSettings({ ai_enabled: event.target.checked })} disabled={!mayManage} />
        Enable the assistant for this workspace
      </label>
    </div>

    <div className="mt-5">
      <p className="text-sm font-semibold">Members with access</p>
      <p className="text-xs text-text-muted">Owners and managers always have access. Select the other team members who may use the company key.</p>
      <div className="mt-2 grid gap-1 sm:grid-cols-2">
        {members.map(member => <label key={member.id} className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-surface-secondary">
          <input type="checkbox" checked={settings.ai_user_ids.includes(member.id)} onChange={() => toggleMember(member.id)} disabled={!mayManage} />
          {[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}
        </label>)}
      </div>
    </div>

    {mayManage && <button type="button" className="primary-button mt-5" onClick={save} disabled={saving}>
      <Save size={15} /> {saving ? 'Saving…' : 'Save workspace access'}
    </button>}
    {notice && <p className="workspace-inline-status mt-3" role="status">{notice}</p>}
  </Card>
}
