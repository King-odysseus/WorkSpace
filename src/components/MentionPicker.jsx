import { useRef, useState } from 'react'

export default function MentionPicker({ members = [], value, onChange, currentUserId, children }) {
  const inputRef = useRef(null)
  const [open, setOpen] = useState(false)
  const insertMention = member => {
    const input = inputRef.current
    const start = input?.selectionStart ?? value.length
    const end = input?.selectionEnd ?? start
    const alias = member.email.split('@')[0]
    const prefix = start && !/\s/.test(value[start - 1]) ? ' ' : ''
    const mention = `${prefix}@${alias} `
    onChange(`${value.slice(0, start)}${mention}${value.slice(end)}`.slice(0, 4000))
    setOpen(false)
    requestAnimationFrame(() => {
      const cursor = Math.min(start + mention.length, 4000)
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(cursor, cursor)
    })
  }
  return <div className="relative">
    {children(inputRef)}
    <button type="button" className="secondary-button" onClick={() => setOpen(current => !current)} aria-label="Mention a teammate" aria-expanded={open}>@</button>
    {open && <div className="chat-mention-picker" role="listbox" aria-label="Mention a workspace member">
      {members.filter(member => member.id !== currentUserId).map(member => <button type="button" role="option" key={member.id} onClick={() => insertMention(member)}><strong>{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}</strong><span>@{member.email.split('@')[0]}</span></button>)}
    </div>}
  </div>
}
