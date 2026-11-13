import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BoardDateFilter from './BoardDateFilter.jsx'
import { rangeFor } from '../lib/date-ranges.js'

describe('date ranges', () => {
  // 2026-11-13 is a Friday.
  const today = '2026-11-13'
  it('works out days, weeks (Monday to Sunday) and months from today', () => {
    expect(rangeFor('today', today)).toEqual({ from: today, to: today, due: 'all' })
    expect(rangeFor('tomorrow', today)).toEqual({ from: '2026-11-14', to: '2026-11-14', due: 'all' })
    expect(rangeFor('this_week', today)).toEqual({ from: '2026-11-09', to: '2026-11-15', due: 'all' })
    expect(rangeFor('next_week', today)).toEqual({ from: '2026-11-16', to: '2026-11-22', due: 'all' })
    expect(rangeFor('this_month', today)).toEqual({ from: '2026-11-01', to: '2026-11-30', due: 'all' })
  })
  it('keeps overdue and no-due-date as the boards own filters, and any date as no filter', () => {
    expect(rangeFor('overdue', today)).toEqual({ from: '', to: '', due: 'overdue' })
    expect(rangeFor('none', today)).toEqual({ from: '', to: '', due: 'none' })
    expect(rangeFor('any', today)).toEqual({ from: '', to: '', due: 'all' })
  })
  it('handles a week that crosses a month and a year', () => {
    expect(rangeFor('this_week', '2026-12-31')).toEqual({ from: '2026-12-28', to: '2027-01-03', due: 'all' })
  })
})

describe('BoardDateFilter', () => {
  it('chooses a preset and reports its range', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<BoardDateFilter today="2026-11-13" preset="any" from="" to="" onChange={onChange} />)
    await user.click(screen.getByRole('combobox', { name: 'Due date' }))
    await user.click(await screen.findByRole('option', { name: 'This week' }))
    expect(onChange).toHaveBeenCalledWith({ preset: 'this_week', from: '2026-11-09', to: '2026-11-15', due: 'all' })
  })

  it('shows two date boxes for a custom range and reports each change', () => {
    const onChange = vi.fn()
    render(<BoardDateFilter today="2026-11-13" preset="custom" from="2026-11-02" to="" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Due to'), { target: { value: '2026-11-06' } })
    expect(onChange).toHaveBeenCalledWith({ preset: 'custom', from: '2026-11-02', to: '2026-11-06', due: 'all' })
  })

  it('has no date boxes unless a custom range is chosen', () => {
    render(<BoardDateFilter today="2026-11-13" preset="today" from="2026-11-13" to="2026-11-13" onChange={() => {}} />)
    expect(screen.queryByLabelText('Due from')).toBeNull()
  })
})
