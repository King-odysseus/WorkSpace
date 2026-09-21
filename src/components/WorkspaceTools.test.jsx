import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AssistantFlyout, FilesWorkspaceView, describeDocument } from './WorkspaceTools.jsx'
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

it('presents the assistant as opposing chat bubbles and exposes window controls', async () => {
  mockApi({
    '/api/workspaces/4/ai/settings/': {
      settings: { ai_default_provider: 'openai', ai_enabled_providers: ['openai'] },
      providers: { openai: true },
    },
    '/api/workspaces/4/ai/chat/': { answer: 'The workspace is on track.' },
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

  expect(await screen.findByRole('button', { name: 'Minimize Zuri' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Close Zuri' })).toBeInTheDocument()

  const input = await screen.findByLabelText('Message to Zuri')
  fireEvent.change(input, { target: { value: 'How are we doing?' } })
  fireEvent.submit(input.closest('form'))

  expect(await screen.findByText('The workspace is on track.')).toBeInTheDocument()
  expect(screen.getByText('How are we doing?').closest('.ai-chat-row')).toHaveClass('is-user')
  expect(screen.getByText('The workspace is on track.').closest('.ai-chat-row')).toHaveClass('is-assistant')

  fireEvent.click(screen.getByRole('button', { name: 'Close Zuri' }))
  expect(onClose).toHaveBeenCalled()
  expect(onMinimize).not.toHaveBeenCalled()
})

it('keeps new assistant messages inside the transcript scroller', async () => {
  mockApi({
    '/api/workspaces/4/ai/settings/': {
      settings: { ai_default_provider: 'openai', ai_enabled_providers: ['openai'] },
      providers: { openai: true },
    },
    '/api/workspaces/4/ai/chat/': { answer: 'The latest workspace update is ready.' },
  })

  render(<AssistantFlyout workspaceId={4} onClose={vi.fn()} />)

  const transcript = await screen.findByRole('log', { name: 'Zuri conversation' })
  Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 720 })
  const input = screen.getByLabelText('Message to Zuri')
  fireEvent.change(input, { target: { value: 'What changed?' } })
  fireEvent.submit(input.closest('form'))

  expect(await screen.findByText('The latest workspace update is ready.')).toBeInTheDocument()
  await waitFor(() => expect(transcript.scrollTop).toBe(720))
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

it('describes what happened to an attached document, including what was withheld', () => {
  expect(describeDocument(null)).toBe('')
  expect(describeDocument({ name: 'report.pdf', ok: true })).toBe('Read report.pdf.')
  expect(describeDocument({ name: 'report.pdf', ok: true, redacted: { EMAIL: 1 } })).toBe(
    'Read report.pdf. 1 piece of personal data replaced with placeholders.',
  )
  expect(
    describeDocument({ name: 'report.pdf', ok: true, redacted: { EMAIL: 2, PHONE: 1 }, truncated: true }),
  ).toBe('Read report.pdf. 3 pieces of personal data replaced with placeholders, and only the first part was read because the file is very long.')
  expect(describeDocument({ name: 'scan.pdf', ok: false, reason: 'That PDF has no text layer.' })).toBe(
    'scan.pdf: That PDF has no text layer.',
  )
})

it('sends an attached file with the question and reports what Zuri made of it', async () => {
  const fetchMock = mockApi({
    '/api/workspaces/4/ai/settings/': {
      settings: { ai_default_provider: 'openai', ai_enabled_providers: ['openai'] },
      providers: { openai: true },
    },
    '/api/workspaces/4/files/': { file: { id: 9, original_name: 'quarterly.pdf' } },
    '/api/workspaces/4/ai/chat/': {
      answer: 'Revenue rose 4%.',
      document: { name: 'quarterly.pdf', ok: true, redacted: { EMAIL: 2 }, truncated: false },
    },
  })

  render(<AssistantFlyout workspaceId={4} onClose={vi.fn()} />)

  const picker = await screen.findByLabelText('Attach a document for Zuri to read')
  const input = screen.getByLabelText('Message to Zuri')
  expect(picker.closest('.ai-chat-input-shell')).toBe(input.closest('.ai-chat-input-shell'))
  expect(input.closest('.ai-chat-input-shell')).not.toBeNull()
  fireEvent.change(picker, { target: { files: [new File(['x'], 'quarterly.pdf', { type: 'application/pdf' })] } })

  // The chip confirms the upload landed before the user commits to sending.
  expect(await screen.findByText('quarterly.pdf')).toBeInTheDocument()

  // A file on its own is a complete request, so the send button is live with an
  // empty box and the question is filled in for the model.
  expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()
  fireEvent.submit(input.closest('form'))

  expect(
    await screen.findByText('Read quarterly.pdf. 2 pieces of personal data replaced with placeholders.'),
  ).toBeInTheDocument()
  expect(await screen.findByText('Revenue rose 4%.')).toBeInTheDocument()
  expect(await screen.findByText('Summarise quarterly.pdf')).toBeInTheDocument()

  const [, init] = expectRequest(fetchMock, '/api/workspaces/4/ai/chat/', 'POST')
  expect(JSON.parse(init.body)).toMatchObject({ message: 'Summarise quarterly.pdf', file_id: 9 })
  // Cleared once the turn succeeds, so the next question is not about the file.
  expect(screen.queryByText('quarterly.pdf')).not.toBeInTheDocument()
})

it('keeps the attachment when the turn fails so it can be retried', async () => {
  mockApi({
    '/api/workspaces/4/ai/settings/': {
      settings: { ai_default_provider: 'openai', ai_enabled_providers: ['openai'] },
      providers: { openai: true },
    },
    '/api/workspaces/4/files/': { file: { id: 9, original_name: 'quarterly.pdf' } },
    '/api/workspaces/4/ai/chat/': { status: 503, body: { error: 'Zuri is unavailable.' } },
  })

  render(<AssistantFlyout workspaceId={4} onClose={vi.fn()} />)

  const picker = await screen.findByLabelText('Attach a document for Zuri to read')
  fireEvent.change(picker, { target: { files: [new File(['x'], 'quarterly.pdf', { type: 'application/pdf' })] } })
  expect(await screen.findByText('quarterly.pdf')).toBeInTheDocument()

  const input = screen.getByLabelText('Message to Zuri')
  fireEvent.submit(input.closest('form'))

  expect(await screen.findByRole('alert')).toHaveTextContent('Zuri is unavailable.')
  expect(screen.getByText('quarterly.pdf')).toBeInTheDocument()
})
