import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { TaskProgressBar, progressOptions, progressTone, taskProgressValue } from './TaskProgressBar.jsx'

it('reads 100 for a finished task whatever number it was saved with', () => {
  expect(taskProgressValue({ status: 'done', progress_percent: 0 })).toBe(100)
  expect(taskProgressValue({ is_done: true })).toBe(100)
  expect(taskProgressValue({ status: 'todo' })).toBe(0)
  expect(taskProgressValue({ status: 'todo', progress_percent: 250 })).toBe(100)
})

it('offers tens, and keeps a saved value that sits between them', () => {
  expect(progressOptions(30)).toHaveLength(11)
  expect(progressOptions(45)).toContain(45)
  expect(progressOptions(45).indexOf(45)).toBe(progressOptions(45).indexOf(40) + 1)
})

it('draws the track and the percent for a task that has not started', () => {
  render(<TaskProgressBar value={0} title="Draft" />)
  expect(screen.getByRole('progressbar', { name: 'Progress for Draft' })).toHaveAttribute('aria-valuenow', '0')
  expect(screen.getByText('0%')).toBeInTheDocument()
})

it('colours the bar by how far along the work is', () => {
  expect(progressTone(0).text).toBe('text-muted-foreground')
  expect(progressTone(20).fill).toBe('bg-danger')
  expect(progressTone(50).fill).toBe('bg-warning-fill')
  expect(progressTone(80).fill).toBe('bg-info')
  expect(progressTone(100).fill).toBe('bg-success')
})

it('turns the percent into a dropdown when there is a way to save it', () => {
  const changes = []
  render(<TaskProgressBar value={40} title="Draft" onChange={percent => changes.push(percent)} />)
  const select = screen.getByRole('combobox', { name: 'Percent complete for Draft' })
  expect(select).toHaveValue('40')
  fireEvent.change(select, { target: { value: '70' } })
  expect(changes).toEqual([70])
})
