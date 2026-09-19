import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SearchInput } from './search-input.jsx'

describe('SearchInput', () => {
  it('hides the clear action until there is something to clear', async () => {
    const user = userEvent.setup()
    render(<SearchInput label="Search tasks" />)

    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'brand')
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument()
  })

  it('clears the field and reports the empty value to the caller', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SearchInput label="Search tasks" defaultValue="brand" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(onChange).toHaveBeenLastCalledWith({ target: { value: '' } })
  })

  it('stays controlled when the caller owns the value', () => {
    render(<SearchInput label="Search tasks" value="brand" onChange={() => {}} />)
    expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toHaveValue('brand')
  })
})
