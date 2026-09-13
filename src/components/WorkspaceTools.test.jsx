import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AssistantFlyout, FilesWorkspaceView } from './WorkspaceTools.jsx'
import { expectRequest, mockApi } from '../test/setup-tests.js'

afterEach(() => {
  vi.useRealTimers()
  window.localStorage.clear()
})

const document = {
  id: 5,
  title: 'Launch brief',
  kind: 'document',
  content: { html: '<p>Draft copy</p>', text: 'Draft copy' },
  updated_at: '2026-09-12T10:00:00Z',
  created_by: 1,
  permission: 'edit',
}

const saveAttempts = fetchMock =>
  fetchMock.mock.calls.filter(
    ([url, init = {}]) =>
      String(url).includes('/documents/5/') && init.method === 'PATCH',
  )

it('tries a failed autosave once instead of retrying on a loop', async () => {
  // A failed save leaves the document dirty, which re-ran the autosave effect,
  // and every run scheduled the next one, so the endpoint was hammered about
  // once a second forever while the edits never landed.
  const fetchMock = mockApi({
    '/documents/5/comments/': { comments: [] },
    '/documents/5/shares/': { shares: [] },
    '/documents/5/': { status: 500, body: { error: 'Saving is unavailable.' } },
    '/documents/': { documents: [document] },
    '/files/': { files: [] },
    '/members/': { members: [] },
  })

  render(<FilesWorkspaceView workspaceId={4} currentUserId={1} />)
  fireEvent.click(await screen.findByRole('button', { name: /Launch brief/ }))
  const title = await screen.findByDisplayValue('Launch brief')

  vi.useFakeTimers()
  fireEvent.change(title, { target: { value: 'Launch brief v2' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(30000) })

  expect(saveAttempts(fetchMock)).toHaveLength(1)
  expect(screen.getByText('Saving is unavailable.')).toBeInTheDocument()
})

it('saves again once the content changes after a failure', async () => {
  const fetchMock = mockApi({
    '/documents/5/comments/': { comments: [] },
    '/documents/5/shares/': { shares: [] },
    '/documents/5/': { status: 500, body: { error: 'Saving is unavailable.' } },
    '/documents/': { documents: [document] },
    '/files/': { files: [] },
    '/members/': { members: [] },
  })

  render(<FilesWorkspaceView workspaceId={4} currentUserId={1} />)
  fireEvent.click(await screen.findByRole('button', { name: /Launch brief/ }))
  const title = await screen.findByDisplayValue('Launch brief')

  vi.useFakeTimers()
  fireEvent.change(title, { target: { value: 'Launch brief v2' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(saveAttempts(fetchMock)).toHaveLength(1)

  fireEvent.change(title, { target: { value: 'Launch brief v3' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })

  expect(saveAttempts(fetchMock)).toHaveLength(2)
})

it('minimizes the assistant without hiding its launcher', async () => {
  mockApi({
    '/api/workspaces/4/ai/settings/': {
      settings: { ai_default_provider: 'openai', ai_enabled_providers: ['openai'] },
      providers: { openai: true },
    },
  })
  const onClose = vi.fn()
  const onMinimize = vi.fn()

  render(
    <AssistantFlyout
      workspaceId={4}
      onClose={onClose}
      onMinimize={onMinimize}
    />,
  )

  fireEvent.click(await screen.findByRole('button', { name: 'Minimize Zuri' }))

  expect(onMinimize).toHaveBeenCalledTimes(1)
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Hide Zuri button' })).not.toBeInTheDocument()
})

it('shows a workspace action for confirmation before reporting success', async () => {
  const fetchMock = mockApi({
    '/api/workspaces/4/ai/settings/': {
      settings: { ai_default_provider: 'openai', ai_enabled_providers: ['openai'] },
      providers: { openai: true },
    },
    '/api/workspaces/4/ai/chat/': {
      answer: 'I prepared that action for your confirmation.',
      pending_action: {
        id: 7,
        kind: 'task.create',
        summary: 'Create task "Launch notes"',
        status: 'pending',
      },
    },
    '/api/workspaces/4/ai/actions/7/': {
      action: {
        id: 7,
        kind: 'task.create',
        summary: 'Create task "Launch notes"',
        status: 'executed',
      },
    },
  })

  render(<AssistantFlyout workspaceId={4} onClose={vi.fn()} />)
  const input = await screen.findByLabelText('Message to Zuri')
  fireEvent.change(input, { target: { value: 'Create a task called Launch notes.' } })
  fireEvent.submit(input.closest('form'))

  expect(await screen.findByText('Create task "Launch notes"')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Confirm/ }))

  expect(await screen.findByText('Done. Create task "Launch notes"')).toBeInTheDocument()
  expectRequest(fetchMock, '/api/workspaces/4/ai/actions/7/', 'POST')
})
