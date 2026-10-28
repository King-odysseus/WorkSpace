import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { TaskProgressBar, progressOptions, taskProgressValue } from './TaskProgressBar.jsx'

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
  render(<TaskProgressBar value={0} label="Progress for Draft" />)
  expect(screen.getByRole('progressbar', { name: 'Progress for Draft' })).toHaveAttribute('aria-valuenow', '0')
  expect(screen.getByText('0%')).toBeInTheDocument()
})
