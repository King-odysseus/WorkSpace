import React from 'react'
import { Users } from 'lucide-react'
import Avatar from './Avatar.jsx'
import { Button } from './ui/button.jsx'

// The people on a board, as a row of round avatars. Owners and managers get an
// "Add people" button on it; with no single board chosen they are told how to
// pick one, so the control is never simply missing.
export default function BoardPeople({ target, members, canManage, scopeNoun, onOpen }) {
  if (!target) {
    return canManage
      ? <p className="board-people-hint" role="note"><Users size={16} aria-hidden="true" /> Choose a {scopeNoun} to see and manage who is on it.</p>
      : null
  }
  const ids = new Set((target.board.member_ids || []).map(String))
  const people = members.filter(member => ids.has(String(member.id)))
  const shown = people.slice(0, 5)
  const label = person => [person.first_name, person.last_name].filter(Boolean).join(' ') || person.name || person.email || 'Member'
  const summary = people.length ? `${people.length} ${people.length === 1 ? 'person' : 'people'} on ${target.board.name}` : `Nobody has been added to ${target.board.name} yet`
  return <div className="board-people" role="group" aria-label={`People on ${target.board.name}`}>
    <ul className="board-people-stack" aria-label={summary}>
      {shown.map(person => <li key={person.id} title={label(person)}><Avatar name={label(person)} avatarUrl={person.avatar_url} className="board-people-avatar" /></li>)}
      {people.length > shown.length && <li className="board-people-more" title={people.slice(shown.length).map(label).join(', ')}>+{people.length - shown.length}</li>}
    </ul>
    {!people.length && !canManage && <span className="board-people-empty">No one added yet</span>}
    {canManage && <Button type="button" variant="outline" className="board-people-add gap-2" onClick={onOpen} aria-label={`Add or remove people on ${target.board.name}`}><Users size={16} aria-hidden="true" /> {people.length ? 'People' : 'Add people'}</Button>}
  </div>
}
