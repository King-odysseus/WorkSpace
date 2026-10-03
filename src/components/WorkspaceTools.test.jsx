import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AssistantFlyout, AssistantPage, FilesWorkspaceView, describeDocument } from './WorkspaceTools.jsx'
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

it('opens the exact document named by a notification', async () => {
  const onHandled = vi.fn()
  mockApi({
    '/documents/5/comments/': { comments: [] },
    '/documents/5/shares/': { shares: [] },
    '/documents/': { documents: [{ ...document, id: 3, title: 'Another file' }, document] },
    '/files/': { files: [] },
    '/members/': { members: [] },
  })

  render(
    <FilesWorkspaceView
      workspaceId={4}
      currentUserId={1}
      notificationDocumentId={5}
      onNotificationDocumentHandled={onHandled}
    />,
  )

  expect(await screen.findByDisplayValue('Launch brief')).toBeInTheDocument()
  await waitFor(() => expect(onHandled).toHaveBeenCalledTimes(1))
})

it('exposes an accessible name for the file search field', async () => {
  mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/members/': { members: [] },
  })

  render(<FilesWorkspaceView workspaceId={4} currentUserId={1} />)

  expect(await screen.findByRole('textbox', { name: 'Search files' })).toBeInTheDocument()
})

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
  const dialog = screen.getByRole('dialog')
  expect(dialog).not.toHaveClass('top-1/2', 'left-1/2', '-translate-x-1/2', '-translate-y-1/2')
  expect(dialog.parentElement).toHaveAttribute('data-slot', 'dialog-dock-layer')

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
      pending_actions: [{
        id: 7,
        kind: 'task.create',
        summary: 'Create task "Launch notes"',
        status: 'pending',
      }],
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

it('says an image goes as a picture and shows what is attached', async () => {
  const fetchMock = mockApi({
    '/api/workspaces/4/ai/settings/': {
      settings: { ai_default_provider: 'openai', ai_enabled_providers: ['openai'] },
      providers: { openai: true },
    },
    '/api/workspaces/4/files/': {
      file: { id: 9, original_name: 'dashboard.png', url: '/api/workspace-files/9/download/' },
    },
    '/api/workspaces/4/ai/chat/': {
      answer: 'It is a chart.',
      document: { name: 'dashboard.png', ok: true, image: true },
    },
  })

  render(<AssistantFlyout workspaceId={4} onClose={vi.fn()} />)

  const picker = await screen.findByLabelText('Attach a document for Zuri to read')
  fireEvent.change(picker, { target: { files: [new File(['x'], 'dashboard.png', { type: 'image/png' })] } })

  // The chip previews the picture, and the notice says what will happen to it -
  // an image cannot be redacted the way document text is.
  const chip = (await screen.findByText('dashboard.png')).closest('.ai-chat-attachment')
  expect(chip.querySelector('.ai-chat-attachment-thumb')).not.toBeNull()
  expect(screen.getByText(/sent to the AI provider as a picture, and is not redacted/)).toBeInTheDocument()

  const input = screen.getByLabelText('Message to Zuri')
  fireEvent.change(input, { target: { value: 'What does this show?' } })
  fireEvent.submit(input.closest('form'))

  expect(await screen.findByText('Sent dashboard.png to Zuri as an image.')).toBeInTheDocument()
  // The turn keeps the picture it was sent with, so the transcript shows it.
  const turn = (await screen.findByText('What does this show?')).closest('.ai-chat-turn')
  expect(turn.querySelector('.ai-chat-thumb')).not.toBeNull()
  expectRequest(fetchMock, '/api/workspaces/4/ai/chat/', 'POST')
})

it('leaves a document attachment described the way it always was', async () => {
  mockApi({
    '/api/workspaces/4/ai/settings/': {
      settings: { ai_default_provider: 'openai', ai_enabled_providers: ['openai'] },
      providers: { openai: true },
    },
    '/api/workspaces/4/files/': {
      file: { id: 9, original_name: 'contacts.txt', url: '/api/workspace-files/9/download/' },
    },
    '/api/workspaces/4/ai/chat/': {
      answer: 'Two names.',
      document: { name: 'contacts.txt', ok: true, redacted: { EMAIL: 1 }, truncated: false },
    },
  })

  render(<AssistantFlyout workspaceId={4} onClose={vi.fn()} />)

  const picker = await screen.findByLabelText('Attach a document for Zuri to read')
  fireEvent.change(picker, { target: { files: [new File(['x'], 'contacts.txt', { type: 'text/plain' })] } })

  expect(await screen.findByText('contacts.txt')).toBeInTheDocument()
  // No picture notice, no preview: this one is redacted as text.
  expect(screen.queryByText(/sent to the AI provider as a picture/)).not.toBeInTheDocument()
  expect(screen.queryByRole('img')).not.toBeInTheDocument()

  const input = screen.getByLabelText('Message to Zuri')
  fireEvent.submit(input.closest('form'))

  expect(await screen.findByText('Read contacts.txt. 1 piece of personal data replaced with placeholders.')).toBeInTheDocument()
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

it('confirms a proposed list in one step and accounts for every entry', async () => {
  const fetchMock = mockApi({
    '/api/workspaces/4/ai/settings/': {
      settings: { ai_default_provider: 'openai', ai_enabled_providers: ['openai'] },
      providers: { openai: true },
    },
    '/api/workspaces/4/ai/chat/': {
      answer: 'I prepared three tasks for your confirmation.',
      pending_actions: [
        { id: 7, kind: 'task.create', summary: 'Create task "Write the brief"', status: 'pending' },
        { id: 8, kind: 'task.create', summary: 'Create task "Book the venue"', status: 'pending' },
        { id: 9, kind: 'task.create', summary: 'Create task "Send the invites"', status: 'pending' },
      ],
    },
    '/api/workspaces/4/ai/actions/7/': { action: { id: 7, summary: 'Create task "Write the brief"', status: 'executed' } },
    '/api/workspaces/4/ai/actions/8/': { action: { id: 8, summary: 'Create task "Book the venue"', status: 'executed' } },
    '/api/workspaces/4/ai/actions/9/': { action: { id: 9, summary: 'Create task "Send the invites"', status: 'executed' } },
  })

  render(<AssistantFlyout workspaceId={4} onClose={vi.fn()} onMinimize={vi.fn()} />)
  const input = await screen.findByLabelText('Message to Zuri')
  fireEvent.change(input, { target: { value: 'Add my three launch tasks.' } })
  fireEvent.submit(input.closest('form'))

  // The whole list is offered at once rather than one entry per round trip.
  expect(await screen.findByText('Create task "Write the brief"')).toBeInTheDocument()
  expect(screen.getByText('3 proposed actions')).toBeInTheDocument()
  expect(window.localStorage.getItem('workspace-ai-action:4')).toContain('Send the invites')

  fireEvent.click(screen.getByRole('button', { name: /Confirm all/ }))

  expect(await screen.findByText(/Done\. 3 actions:/)).toBeInTheDocument()
  expect(screen.getByText(/Write the brief/)).toBeInTheDocument()
  expectRequest(fetchMock, '/api/workspaces/4/ai/actions/7/', 'POST')
  expectRequest(fetchMock, '/api/workspaces/4/ai/actions/8/', 'POST')
  expectRequest(fetchMock, '/api/workspaces/4/ai/actions/9/', 'POST')

  await waitFor(() => expect(screen.queryByText('3 proposed actions')).not.toBeInTheDocument())
  expect(window.localStorage.getItem('workspace-ai-action:4')).toBeNull()
})

it('keeps the entries that failed out of the cleared list and reports them', async () => {
  mockApi({
    '/api/workspaces/4/ai/settings/': {
      settings: { ai_default_provider: 'openai', ai_enabled_providers: ['openai'] },
      providers: { openai: true },
    },
    '/api/workspaces/4/ai/chat/': {
      answer: 'I prepared two tasks for your confirmation.',
      pending_actions: [
        { id: 7, kind: 'task.create', summary: 'Create task "Keep this one"', status: 'pending' },
        { id: 8, kind: 'task.create', summary: 'Create task "Rejected one"', status: 'pending' },
      ],
    },
    '/api/workspaces/4/ai/actions/7/': { action: { id: 7, summary: 'Create task "Keep this one"', status: 'executed' } },
    '/api/workspaces/4/ai/actions/8/': { status: 403, body: { error: 'You do not have permission to create tasks.' } },
  })

  render(<AssistantFlyout workspaceId={4} onClose={vi.fn()} onMinimize={vi.fn()} />)
  const input = await screen.findByLabelText('Message to Zuri')
  fireEvent.change(input, { target: { value: 'Add two tasks.' } })
  fireEvent.submit(input.closest('form'))

  expect(await screen.findByText('Create task "Keep this one"')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Confirm all/ }))

  expect(await screen.findByText(/Done\. 1 of 2 actions:/)).toBeInTheDocument()
  expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission to create tasks.')
})

it('renders Zuri\'s markdown as text rather than showing the markers', async () => {
  mockApi({
    '/api/workspaces/4/ai/settings/': {
      settings: { ai_default_provider: 'openai', ai_enabled_providers: ['openai'] },
      providers: { openai: true },
    },
  })
  window.localStorage.setItem('workspace-ai-chat:4', JSON.stringify([
    { role: 'assistant', content: 'Two are overdue:\n\n### The project tasks\n1. **Design UI** — 18 Sep\n2. **create website UI** — 1 Oct' },
  ]))

  render(<AssistantFlyout workspaceId={4} onClose={vi.fn()} onMinimize={vi.fn()} />)

  const heading = await screen.findByRole('heading', { name: 'The project tasks' })
  expect(heading.tagName).toBe('H3')
  expect(screen.getByText('Design UI').tagName).toBe('STRONG')
  const bubble = screen.getByText('Two are overdue:').closest('.ai-chat-bubble')
  expect(bubble).toHaveClass('is-rich')
  // The markers themselves are gone from what the reader sees, and the two
  // lines became a real list.
  expect(bubble.textContent).not.toContain('**')
  expect(bubble.querySelector('ol')).not.toBeNull()
  expect(bubble.querySelectorAll('ol li')).toHaveLength(2)
})

it('leaves the reader\'s own turn as the text they typed', async () => {
  mockApi({
    '/api/workspaces/4/ai/settings/': {
      settings: { ai_default_provider: 'openai', ai_enabled_providers: ['openai'] },
      providers: { openai: true },
    },
  })
  window.localStorage.setItem('workspace-ai-chat:4', JSON.stringify([
    { role: 'user', content: 'Move **everything** in Daily Operation TIJHA back two weeks' },
  ]))

  render(<AssistantFlyout workspaceId={4} onClose={vi.fn()} onMinimize={vi.fn()} />)

  const bubble = (await screen.findByText(/Daily Operation TIJHA/)).closest('.ai-chat-bubble')
  expect(bubble.textContent).toBe('Move **everything** in Daily Operation TIJHA back two weeks')
  expect(bubble.querySelector('strong')).toBeNull()
})

it('offers the conversation a page of its own', async () => {
  mockApi({
    '/api/workspaces/4/ai/settings/': {
      settings: { ai_default_provider: 'openai', ai_enabled_providers: ['openai'] },
      providers: { openai: true },
    },
  })
  const onExpand = vi.fn()

  render(<AssistantFlyout workspaceId={4} onClose={vi.fn()} onMinimize={vi.fn()} onExpand={onExpand} />)

  fireEvent.click(await screen.findByRole('button', { name: 'Expand Zuri' }))

  expect(onExpand).toHaveBeenCalledTimes(1)
})

it('carries the same conversation onto the Zuri page', async () => {
  mockApi({
    '/api/workspaces/4/ai/settings/': {
      settings: { ai_default_provider: 'openai', ai_enabled_providers: ['openai'] },
      providers: { openai: true },
    },
  })
  window.localStorage.setItem('workspace-ai-chat:4', JSON.stringify([
    { role: 'user', content: 'What needs my attention?' },
    { role: 'assistant', content: '**Design UI** is overdue.' },
  ]))

  render(<AssistantPage workspaceId={4} />)

  expect(await screen.findByRole('heading', { name: 'Zuri' })).toBeInTheDocument()
  expect(screen.getByText('What needs my attention?')).toBeInTheDocument()
  expect(screen.getByText('Design UI').tagName).toBe('STRONG')
  // The page owns the composer, the same one the dock shows.
  const input = screen.getByLabelText('Message to Zuri')
  expect(input.closest('.ai-chat-composer')).not.toBeNull()
  expect(screen.getByRole('button', { name: 'Clear conversation' })).toBeEnabled()
})

it('stays open when the user clicks somewhere else in the app', async () => {
  // The dock is a non-modal Radix dialog, and non-modal still dismisses on any
  // outside interaction - so clicking a nav tab closed the assistant outright.
  mockApi({
    '/api/workspaces/4/ai/settings/': {
      settings: { ai_default_provider: 'openai', ai_enabled_providers: ['openai'] },
      providers: { openai: true },
    },
  })
  const onClose = vi.fn()

  render(
    <>
      <button type="button">My tasks</button>
      <AssistantFlyout workspaceId={4} onClose={onClose} onMinimize={vi.fn()} />
    </>,
  )
  await screen.findByRole('button', { name: 'Minimize Zuri' })

  const navTab = screen.getByRole('button', { name: 'My tasks' })
  // A click outside is a pointerdown followed by a click; Radix listens for
  // both, and attaches its listener a tick after mount.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  fireEvent.pointerDown(navTab, { button: 0 })
  fireEvent.click(navTab)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Minimize Zuri' })).toBeInTheDocument()
})

it('still closes the assistant on Escape', async () => {
  mockApi({
    '/api/workspaces/4/ai/settings/': {
      settings: { ai_default_provider: 'openai', ai_enabled_providers: ['openai'] },
      providers: { openai: true },
    },
  })
  const onClose = vi.fn()

  render(<AssistantFlyout workspaceId={4} onClose={onClose} onMinimize={vi.fn()} />)
  await screen.findByRole('button', { name: 'Minimize Zuri' })

  // Escape is read by Radix off the dialog's own document, which in this
  // environment is not the stub bound to the global `document`.
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

  await waitFor(() => expect(onClose).toHaveBeenCalled())
})

it('clears the stored transcript and any waiting proposal after a confirmation', async () => {
  mockApi({
    '/api/workspaces/4/ai/settings/': {
      settings: { ai_default_provider: 'openai', ai_enabled_providers: ['openai'] },
      providers: { openai: true },
    },
  })
  window.localStorage.setItem('workspace-ai-chat:4', JSON.stringify([
    { role: 'user', content: 'Create a task called Launch notes.' },
    { role: 'assistant', content: 'I prepared that action for your confirmation.' },
  ]))
  window.localStorage.setItem('workspace-ai-action:4', JSON.stringify([{
    id: 7,
    kind: 'task.create',
    summary: 'Create task "Launch notes"',
    status: 'pending',
  }]))

  render(<AssistantFlyout workspaceId={4} onClose={vi.fn()} onMinimize={vi.fn()} />)

  expect(await screen.findByText('Create a task called Launch notes.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Clear conversation' }))

  // Nothing is wiped until the confirmation is answered.
  const clear = await screen.findByRole('button', { name: 'Clear' })
  expect(window.localStorage.getItem('workspace-ai-chat:4')).toContain('Launch notes')
  expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument()

  fireEvent.click(clear)

  await waitFor(() => expect(screen.queryByText('Create a task called Launch notes.')).not.toBeInTheDocument())
  expect(screen.queryByText('Create task "Launch notes"')).not.toBeInTheDocument()
  expect(screen.getByText('Start a conversation')).toBeInTheDocument()
  expect(window.localStorage.getItem('workspace-ai-chat:4')).toBe('[]')
  expect(window.localStorage.getItem('workspace-ai-action:4')).toBeNull()
  // With nothing left to clear, the control is inert rather than hidden.
  expect(screen.getByRole('button', { name: 'Clear conversation' })).toBeDisabled()
})

it('keeps the transcript when the clear confirmation is declined', async () => {
  mockApi({
    '/api/workspaces/4/ai/settings/': {
      settings: { ai_default_provider: 'openai', ai_enabled_providers: ['openai'] },
      providers: { openai: true },
    },
  })
  window.localStorage.setItem('workspace-ai-chat:4', JSON.stringify([
    { role: 'user', content: 'Create a task called Launch notes.' },
  ]))

  render(<AssistantFlyout workspaceId={4} onClose={vi.fn()} onMinimize={vi.fn()} />)

  expect(await screen.findByText('Create a task called Launch notes.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Clear conversation' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Keep' }))

  await waitFor(() => expect(screen.queryByRole('button', { name: 'Keep' })).not.toBeInTheDocument())
  expect(screen.getByText('Create a task called Launch notes.')).toBeInTheDocument()
  expect(window.localStorage.getItem('workspace-ai-chat:4')).toContain('Launch notes')
})

const uploadedFile = {
  id: 9,
  original_name: 'Quarterly review.pdf',
  mime_type: 'application/pdf',
  size: 2048,
  url: '/api/workspace-files/9/download/',
  uploaded_by: 'Nate Foster',
  created_at: '2026-09-12T10:00:00Z',
}

it('opens an uploaded file inside the app instead of a browser tab', async () => {
  // window.open left the app altogether - on mobile it hands the file to the
  // system browser - so there was nothing to press to come back.
  const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
  mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [uploadedFile] },
    '/members/': { members: [] },
  })

  render(<FilesWorkspaceView workspaceId={4} currentUserId={1} />)
  fireEvent.click(await screen.findByRole('button', { name: /^Quarterly review/ }))

  expect(await screen.findByRole('dialog', { name: 'Preview of Quarterly review.pdf' })).toBeInTheDocument()
  expect(openSpy).not.toHaveBeenCalled()
  openSpy.mockRestore()
})

it('returns to the app from a document, not only to the file list', async () => {
  const onExit = vi.fn()
  mockApi({
    '/documents/5/comments/': { comments: [] },
    '/documents/5/shares/': { shares: [] },
    '/documents/': { documents: [document] },
    '/files/': { files: [] },
    '/members/': { members: [] },
  })

  render(<FilesWorkspaceView workspaceId={4} currentUserId={1} onExit={onExit} exitLabel="Back to Today" />)
  fireEvent.click(await screen.findByRole('button', { name: /^Launch brief/ }))
  await screen.findByDisplayValue('Launch brief')

  // The editor's own control still reaches the file list, so the way back to the
  // app has to be a second, separate control.
  expect(screen.getByRole('button', { name: 'All files' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Back to Today' }))

  expect(onExit).toHaveBeenCalledTimes(1)
})
