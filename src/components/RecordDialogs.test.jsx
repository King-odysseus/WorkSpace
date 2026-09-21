import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { mockApi, expectRequest } from '../test/setup-tests.js'
import { CheckInDetailDialog, ProjectEditDialog } from './RecordDialogs.jsx'

const project = {
  id: 18,
  name: 'Mobile launch',
  description: 'Prepare the release.',
  due_date: '2026-10-15',
}

const checkIn = {
  id: 31,
  user_id: 7,
  user_name: 'Amara Okafor',
  user_initials: 'AO',
  date: '2026-09-21',
  completed: 'Confirmed the launch roster and closed the review notes.',
  next_steps: 'Share the handoff summary with the project team.',
  blockers: 'Waiting on final legal approval for the supplier terms.',
}

const members = [
  { id: 7, first_name: 'Amara', last_name: 'Okafor', email: 'amara@example.com', avatar_url: '/amara.png' },
  { id: 8, first_name: 'Priya', last_name: 'Shah', email: 'priya@example.com' },
]

it('renders the check-in detail as a structured discussion with blocker styling', async () => {
  mockApi({
    '/api/workspaces/4/check-ins/31/comments/': {
      comments: [{
        id: 91,
        check_in_id: 31,
        author_id: 8,
        author_name: 'Priya Shah',
        body: 'I can take the legal follow-up if that helps.',
        created_at: '2026-09-21T10:08:00Z',
      }],
    },
  })

  render(
    <CheckInDetailDialog
      checkIn={checkIn}
      workspaceId={4}
      members={members}
      currentUserId={7}
      canComment
      canEdit
      onClose={vi.fn()}
      onEdit={vi.fn()}
    />,
  )

  const dialog = await screen.findByRole('dialog', { name: 'Amara Okafor' })
  expect(dialog).toHaveClass('checkin-detail-dialog')
  expect(screen.getByText('Monday, 21 September')).toBeInTheDocument()
  expect(screen.getByText('Submitted')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled()
  expect(screen.getByText(checkIn.blockers).closest('.checkin-detail-summary-row')).toHaveClass('is-blocker')
  expect(document.querySelector('.task-drawer')).not.toBeInTheDocument()

  const comment = await screen.findByText('I can take the legal follow-up if that helps.')
  expect(comment.closest('article')).toHaveClass('checkin-detail-comment')
  expect(comment.closest('article').querySelector('time')).toHaveAttribute('dateTime', '2026-09-21T10:08:00Z')
})

it('shows the designed empty state and disables edit for another member', async () => {
  mockApi({ '/api/workspaces/4/check-ins/31/comments/': { comments: [] } })

  render(
    <CheckInDetailDialog
      checkIn={checkIn}
      workspaceId={4}
      members={members}
      currentUserId={8}
      canComment
      canEdit={false}
      onClose={vi.fn()}
      onEdit={vi.fn()}
    />,
  )

  expect(await screen.findByText('No comments yet')).toBeInTheDocument()
  expect(screen.getByText('Add an update or offer help with the blocker.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
})

it('posts a comment through the fixed composer and renders it in the discussion', async () => {
  const posted = {
    id: 92,
    check_in_id: 31,
    author_id: 8,
    author_name: 'Priya Shah',
    body: 'I will follow up with legal today.',
    created_at: '2026-09-21T10:22:00Z',
  }
  const fetchMock = vi.fn(async (input, init = {}) => {
    const url = String(input)
    const body = url.includes('/api/auth/csrf/')
      ? { status: 'ok' }
      : init.method === 'POST'
        ? { comment: posted }
        : { comments: [] }
    return {
      ok: true,
      status: init.method === 'POST' ? 201 : 200,
      headers: { get: () => 'application/json' },
      json: async () => body,
      text: async () => JSON.stringify(body),
    }
  })
  vi.stubGlobal('fetch', fetchMock)

  render(
    <CheckInDetailDialog
      checkIn={checkIn}
      workspaceId={4}
      members={members}
      currentUserId={8}
      canComment
      canEdit={false}
      onClose={vi.fn()}
      onEdit={vi.fn()}
    />,
  )

  await screen.findByText('No comments yet')
  const textarea = screen.getByLabelText('Add a comment')
  fireEvent.change(textarea, { target: { value: posted.body } })
  fireEvent.submit(screen.getByRole('button', { name: 'Post comment' }).closest('form'))

  expect(await screen.findByText(posted.body)).toBeInTheDocument()
  await waitFor(() => expect(textarea).toHaveValue(''))
  const [, request] = expectRequest(fetchMock, '/api/workspaces/4/check-ins/31/comments/', 'POST')
  expect(JSON.parse(request.body)).toEqual({ body: posted.body })
})

it('replaces the composer with a permission state when comments are not allowed', async () => {
  mockApi({ '/api/workspaces/4/check-ins/31/comments/': { comments: [] } })

  render(
    <CheckInDetailDialog
      checkIn={checkIn}
      workspaceId={4}
      members={members}
      currentUserId={8}
      canComment={false}
      canEdit={false}
      onClose={vi.fn()}
      onEdit={vi.fn()}
    />,
  )

  expect(await screen.findByText('You do not have permission to comment on check-ins.')).toBeInTheDocument()
  expect(screen.queryByLabelText('Add a comment')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Post comment' })).not.toBeInTheDocument()
})

it('renders project editing as a centered composer modal', async () => {
  const fetchMock = mockApi({
    '/api/workspaces/4/projects/18/': { project: { ...project, name: 'Mobile launch updated' } },
  })
  const onClose = vi.fn()
  const onUpdated = vi.fn()

  render(
    <ProjectEditDialog
      project={project}
      workspaceId={4}
      onClose={onClose}
      onUpdated={onUpdated}
    />,
  )

  const dialog = await screen.findByRole('dialog', { name: 'Edit project' })
  expect(dialog).toHaveClass('composer-modal')
  expect(document.querySelector('.task-drawer')).not.toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mobile launch updated' } })
  fireEvent.submit(screen.getByRole('button', { name: 'Save project' }).closest('form'))

  await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ name: 'Mobile launch updated' })))
  const [, request] = expectRequest(fetchMock, '/api/workspaces/4/projects/18/', 'PATCH')
  expect(JSON.parse(request.body)).toEqual({
    name: 'Mobile launch updated',
    description: 'Prepare the release.',
    due_date: '2026-10-15',
  })
  expect(onClose).toHaveBeenCalledTimes(1)
})
