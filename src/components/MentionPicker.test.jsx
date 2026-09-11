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
