import { useRef, useState } from 'react'

export default function MentionPicker({ members = [], value, onChange, currentUserId, children }) {
  const inputRef = useRef(null)
  const [open, setOpen] = useState(false)
  // Typing @ and a few letters offers matching teammates right under the box.
  const [typed, setTyped] = useState(null)
  const [active, setActive] = useState(0)
  const name = member => [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email
  const matches = typed
    ? members.filter(member => member.id !== currentUserId && `${name(member)} ${member.email.split('@')[0]}`.toLowerCase().includes(typed.query)).slice(0, 6)
    : []
  const detect = () => {
    const input = inputRef.current
    if (!input) return
    const caret = input.selectionStart ?? input.value.length
    const found = /(?:^|\s)@([\w.-]*)$/.exec(input.value.slice(0, caret))
    setTyped(found ? { start: caret - found[1].length - 1, caret, query: found[1].toLowerCase() } : null)
    setActive(0)
  }
  const pick = member => {
    const input = inputRef.current
    if (!input || !typed) return
    const mention = `@${member.email.split('@')[0]} `
    onChange(`${input.value.slice(0, typed.start)}${mention}${input.value.slice(typed.caret)}`.slice(0, 4000))
    setTyped(null)
    requestAnimationFrame(() => {
      const cursor = Math.min(typed.start + mention.length, 4000)
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(cursor, cursor)
    })
  }
  const onKeyDown = event => {
    if (!typed || !matches.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActive(current => (current + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length)
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      pick(matches[Math.min(active, matches.length - 1)])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setTyped(null)
    }
  }
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
  return <div className="relative" onInput={detect} onClick={detect} onKeyDown={onKeyDown} onKeyUp={event => { if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) detect() }}>
    {children(inputRef)}
    <button type="button" className="secondary-button" onClick={() => setOpen(current => !current)} aria-label="Mention a teammate" aria-expanded={open}>@</button>
    {!open && typed && matches.length > 0 && <div className="chat-mention-picker" role="listbox" aria-label="Mention suggestions">
      {matches.map((member, index) => <button type="button" role="option" aria-selected={index === active} className={index === active ? 'is-active' : ''} key={member.id} onMouseDown={event => event.preventDefault()} onClick={() => pick(member)}><strong>{name(member)}</strong><span>@{member.email.split('@')[0]}</span></button>)}
    </div>}
    {open && <div className="chat-mention-picker" role="listbox" aria-label="Mention a workspace member">
      {members.filter(member => member.id !== currentUserId).map(member => <button type="button" role="option" key={member.id} onClick={() => insertMention(member)}><strong>{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}</strong><span>@{member.email.split('@')[0]}</span></button>)}
    </div>}
  </div>
}
