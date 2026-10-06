import React, { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog.jsx'
import { Button } from './ui/button.jsx'
import { Alert } from './ui/alert.jsx'
import Avatar from './Avatar.jsx'
import { getCsrfToken, readJsonResponse } from '../lib/workspace-format.js'

// Who is on one board. A board - a project or an operations workstream - belongs
// to the people added to it: they see its tasks and may edit them. Owners and
// managers see every board and are the ones who choose the people.
export default function BoardMembersDialog({ workspaceId, kind, board, members = [], onClose, onSaved }) {
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const url = `/api/workspaces/${workspaceId}/boards/${kind}/${board.id}/members/`

  useEffect(() => {
    let active = true
    fetch(url, { credentials: 'include' })
      .then(async response => {
        const data = await readJsonResponse(response, 'The board members could not be loaded.')
        if (!active) return
        if (!response.ok) setError(data.error || 'The board members could not be loaded.')
        else setSelected(new Set(data.member_ids))
      })
      .catch(requestError => active && setError(requestError.message || 'The board members could not be loaded.'))
    return () => { active = false }
  }, [url])

  const toggle = id => setSelected(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const response = await fetch(url, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() },
        body: JSON.stringify({ member_ids: [...selected] }),
      })
      const data = await readJsonResponse(response, 'The board members could not be saved.')
      if (!response.ok) throw new Error(data.error || 'The board members could not be saved.')
      onSaved?.(data.member_ids || [...selected])
      onClose(true)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  const people = members.filter(member => member.id)
  return <Dialog open onOpenChange={open => { if (!open) onClose(false) }}>
    <DialogContent className="board-members-dialog">
      <DialogHeader>
        <DialogTitle>People on {board.name}</DialogTitle>
        <DialogDescription>Anyone added here can see this board and edit its tasks. Owners and managers always see every board.</DialogDescription>
      </DialogHeader>
      {error && <Alert tone="danger" compact>{error}</Alert>}
      <ul className="board-members-list">
        {selected && people.map(member => {
          const name = [member.first_name, member.last_name].filter(Boolean).join(' ') || member.name || member.email
          const leader = member.role === 'owner' || member.role === 'manager'
          return <li key={member.id}>
            <Avatar name={name} avatarUrl={member.avatar_url} presence={member.presence} className="board-members-avatar" />
            <span className="board-members-copy">
              <strong>{name}</strong>
              <small>{leader ? `${member.role === 'owner' ? 'Owner' : 'Manager'} - sees every board` : (member.email || '')}</small>
            </span>
            <button
              type="button"
              role="switch"
              className="ai-settings-switch is-small"
              aria-label={`Put ${name} on ${board.name}`}
              aria-checked={selected.has(member.id)}
              onClick={() => toggle(member.id)}
            >
              <span aria-hidden="true" />
            </button>
          </li>
        })}
      </ul>
      {!selected && !error && <p className="board-members-loading" role="status">Loading...</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onClose(false)} disabled={saving}>Cancel</Button>
        <Button type="button" onClick={save} disabled={saving || !selected}>{saving ? 'Saving...' : 'Save'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
