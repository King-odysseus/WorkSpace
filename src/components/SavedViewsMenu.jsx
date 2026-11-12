import React, { useCallback, useEffect, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Bookmark, Trash2, Users } from 'lucide-react'
import { Button } from './ui/button.jsx'
import { getCsrfToken } from '../lib/workspace-format.js'

// Saved task views: a named snapshot of the planner's filters that a member can
// bring back in one click. A view is private to its owner unless they share it,
// in which case everyone in the workspace sees it (only the owner can delete it).
//
// The server stores one filter token, one search string and one project scope
// per view. The planner has more filters than that, so the filters travel as a
// small JSON object in the filter token. Anything missing or unreadable falls
// back to "all", so an old or hand-made view can never break the board.

export const DEFAULT_PLANNER_VIEW = { status: 'all', priority: 'all', assignee: 'all', workstream: 'all', bucketFilter: 'all', dueFilter: 'all', staleOnly: false }

export function encodeViewFilters(filters) {
  const picked = {}
  for (const key of Object.keys(DEFAULT_PLANNER_VIEW)) picked[key] = filters[key] ?? DEFAULT_PLANNER_VIEW[key]
  return JSON.stringify(picked)
}

export function decodeViewFilters(token) {
  try {
    const parsed = JSON.parse(token)
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_PLANNER_VIEW }
    const filters = { ...DEFAULT_PLANNER_VIEW }
    for (const key of Object.keys(DEFAULT_PLANNER_VIEW)) {
      if (typeof parsed[key] === typeof DEFAULT_PLANNER_VIEW[key]) filters[key] = parsed[key]
    }
    return filters
  } catch {
    return { ...DEFAULT_PLANNER_VIEW }
  }
}

export default function SavedViewsMenu({ workspaceId, currentUserId, filters, search = '', projectScope = 'all', onApply }) {
  const [open, setOpen] = useState(false)
  const [views, setViews] = useState([])
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(signal => {
    if (!workspaceId) return Promise.resolve()
    setLoading(true)
    return fetch(`/api/workspaces/${workspaceId}/saved-views/`, { credentials: 'include', signal, headers: { 'X-Workspace-Id': String(workspaceId) } })
      .then(response => response.ok ? response.json() : { saved_views: [] })
      .then(payload => setViews(Array.isArray(payload.saved_views) ? payload.saved_views : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [workspaceId])

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [open, load])

  const save = async event => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/saved-views/`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) },
        body: JSON.stringify({ name: trimmed, filter: encodeViewFilters(filters), search, project_scope: projectScope, shared }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'The view could not be saved.')
      setName('')
      setShared(false)
      await load()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async view => {
    setError('')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/saved-views/${view.id}/`, {
        method: 'DELETE', credentials: 'include',
        headers: { 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) },
      })
      if (!response.ok) throw new Error('The view could not be deleted.')
      setViews(current => current.filter(item => item.id !== view.id))
    } catch (removeError) {
      setError(removeError.message)
    }
  }

  const apply = view => {
    onApply({ ...decodeViewFilters(view.filter), search: view.search || '', projectScope: view.project_scope || 'all' })
    setOpen(false)
  }

  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>
      <Button type="button" variant="outline" className="saved-views-trigger gap-2" aria-label="Saved views"><Bookmark size={18} aria-hidden="true" /> Views</Button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="saved-views-panel" side="bottom" align="start" sideOffset={8} collisionPadding={12} aria-label="Saved views">
        <h3>Saved views</h3>
        {loading && !views.length ? <p className="saved-views-empty">Loading...</p>
          : views.length ? <ul>
            {views.map(view => <li key={view.id}>
              <button type="button" className="saved-views-apply" onClick={() => apply(view)}>
                <strong>{view.name}</strong>
                {view.shared && <small><Users size={12} aria-hidden="true" /> Shared{view.owner_id !== currentUserId ? ' by a teammate' : ''}</small>}
              </button>
              {view.owner_id === currentUserId && <button type="button" className="saved-views-delete" onClick={() => remove(view)} aria-label={`Delete view ${view.name}`} title="Delete view"><Trash2 size={14} aria-hidden="true" /></button>}
            </li>)}
          </ul> : <p className="saved-views-empty">Save the filters you are using to bring them back in one click.</p>}
        <form className="saved-views-form" onSubmit={save}>
          <input type="text" value={name} maxLength={100} onChange={event => setName(event.target.value)} placeholder="Name this view" aria-label="View name" />
          <label className="saved-views-share"><input type="checkbox" checked={shared} onChange={event => setShared(event.target.checked)} /> Share with the team</label>
          <Button type="submit" size="sm" disabled={!name.trim() || saving} loading={saving}>Save current view</Button>
        </form>
        {error && <p className="saved-views-error" role="alert">{error}</p>}
        <Popover.Arrow className="chat-reaction-picker-arrow" />
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
}
