import { useCallback, useEffect, useState } from 'react'
import { getCsrfToken } from './workspace-format.js'

// One place that knows how to talk to the memo API, shared by the Memos page and
// the announcement banner. Either can post, change or dismiss a memo; the
// MEMOS_CHANGED event makes every other user of the hook look again, so the page
// and the banner never disagree.
export const MEMOS_CHANGED = 'workspace:memos-changed'
const REFRESH_MS = 60000

export function announceMemosChanged() {
  window.dispatchEvent(new Event(MEMOS_CHANGED))
}

export default function useMemos(workspaceId) {
  const [memos, setMemos] = useState([])
  const [canPost, setCanPost] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async signal => {
    if (!workspaceId) return
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/memos/`, { credentials: 'include', signal, headers: { 'X-Workspace-Id': String(workspaceId) } })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Memos could not be loaded.')
      setMemos(Array.isArray(payload.memos) ? payload.memos : [])
      setCanPost(Boolean(payload.can_post))
      setError('')
    } catch (loadError) {
      if (loadError.name !== 'AbortError') setError(loadError.message || 'Memos could not be loaded.')
    } finally {
      setLoaded(true)
    }
  }, [workspaceId])

  useEffect(() => {
    setMemos([])
    setLoaded(false)
    if (!workspaceId) return undefined
    const controller = new AbortController()
    load(controller.signal)
    const again = () => load()
    const timer = setInterval(again, REFRESH_MS)
    window.addEventListener('focus', again)
    window.addEventListener(MEMOS_CHANGED, again)
    return () => {
      controller.abort()
      clearInterval(timer)
      window.removeEventListener('focus', again)
      window.removeEventListener(MEMOS_CHANGED, again)
    }
  }, [workspaceId, load])

  const send = async (path, method, body) => {
    const response = await fetch(`/api/workspaces/${workspaceId}/memos/${path}`, {
      method, credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || 'That did not work. Try again.')
    return payload
  }

  const post = async fields => { const payload = await send('', 'POST', fields); announceMemosChanged(); return payload.memo }
  const update = async (id, fields) => { const payload = await send(`${id}/`, 'PATCH', fields); announceMemosChanged(); return payload.memo }
  const archive = async id => { await send(`${id}/`, 'DELETE'); announceMemosChanged() }
  const respond = async (id, note) => { const payload = await send(`${id}/respond/`, 'POST', { note }); announceMemosChanged(); return payload.memo }
  const dismiss = async id => {
    // Close it at once; the server records it so it stays closed on other devices.
    setMemos(current => current.map(memo => (memo.id === id ? { ...memo, dismissed: true } : memo)))
    try { await send(`${id}/dismiss/`, 'POST') } catch { announceMemosChanged() }
  }

  return { memos, canPost, loaded, error, reload: load, post, update, archive, respond, dismiss }
}
