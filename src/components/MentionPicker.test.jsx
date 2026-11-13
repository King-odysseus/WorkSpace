import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { vi, it, expect } from 'vitest'
import MentionPicker from './MentionPicker.jsx'

it('excludes the current user and inserts a teammate mention', () => {
  const onChange = vi.fn()
  render(<MentionPicker members={[{ id: 1, email: 'me@example.com' }, { id: 2, email: 'jane@example.com', first_name: 'Jane' }]} currentUserId={1} value="Update" onChange={onChange}>{inputRef => <textarea ref={inputRef} defaultValue="Update" />}</MentionPicker>)

  fireEvent.click(screen.getByRole('button', { name: 'Mention a teammate' }))
  expect(screen.queryByRole('option', { name: /me@example.com/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('option', { name: /Jane/ }))

  expect(onChange).toHaveBeenCalledWith('Update @jane ')
})

it('offers teammates as you type @, and Enter picks the highlighted one', () => {
  const Harness = () => {
    const [text, setText] = React.useState('')
    return <MentionPicker members={[{ id: 1, email: 'me@example.com' }, { id: 2, email: 'jane@example.com', first_name: 'Jane' }, { id: 3, email: 'joe@example.com', first_name: 'Joe' }]} currentUserId={1} value={text} onChange={setText}>{inputRef => <textarea aria-label="Comment" ref={inputRef} value={text} onChange={event => setText(event.target.value)} />}</MentionPicker>
  }
  render(<Harness />)
  const box = screen.getByLabelText('Comment')
  box.focus()
  fireEvent.change(box, { target: { value: 'Hi @j', selectionStart: 5, selectionEnd: 5 } })
  box.setSelectionRange(5, 5)
  fireEvent.input(box)
  expect(screen.getByRole('listbox', { name: 'Mention suggestions' })).toBeTruthy()
  expect(screen.getAllByRole('option')).toHaveLength(2)
  fireEvent.keyDown(box, { key: 'ArrowDown' })
  fireEvent.keyDown(box, { key: 'Enter' })
  expect(box.value).toBe('Hi @joe ')
  expect(screen.queryByRole('listbox')).toBeNull()
})

it('offers nothing for an @ in the middle of a word, such as an email address', () => {
  render(<MentionPicker members={[{ id: 2, email: 'jane@example.com', first_name: 'Jane' }]} value="" onChange={() => {}}>{inputRef => <textarea aria-label="Comment" ref={inputRef} defaultValue="" />}</MentionPicker>)
  const box = screen.getByLabelText('Comment')
  box.value = 'mail me@ja'
  box.setSelectionRange(10, 10)
  fireEvent.input(box)
  expect(screen.queryByRole('listbox')).toBeNull()
})
