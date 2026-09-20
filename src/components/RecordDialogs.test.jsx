import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { mockApi, expectRequest } from '../test/setup-tests.js'
import { ProjectEditDialog } from './RecordDialogs.jsx'

const project = {
  id: 18,
  name: 'Mobile launch',
  description: 'Prepare the release.',
  due_date: '2026-10-15',
}

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
