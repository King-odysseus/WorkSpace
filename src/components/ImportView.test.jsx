import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ImportView from './ImportView.jsx'

function jsonResponse(data, ok = true) {
  return {
    ok,
    headers: { get: () => 'application/json' },
    json: vi.fn().mockResolvedValue(data),
  }
}

async function chooseWorkbook(user) {
  document.cookie = 'csrftoken=test-token'
  const input = document.querySelector('input[type="file"]')
  await user.upload(input, new File(['task,owner\nDemo,Nate'], 'workspace-tasks.csv', { type: 'text/csv' }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

describe('ImportView', () => {
  it('keeps unsupported import sources disabled while allowing workbook preview', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      preview: {
        preview_id: 7,
        checksum: 'abcdef1234567890',
        summary: { total_rows: 12, creates: 9, updates: 3, exceptions: 0 },
        exceptions: [],
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<ImportView workspaceId={4} role="owner" />)

    expect(screen.getByText('Trello or Asana').closest('button')).toBeDisabled()
    expect(screen.getByText('JSON export').closest('button')).toBeDisabled()
    expect(screen.getByText('Workspace archive').closest('button')).toBeDisabled()

    await chooseWorkbook(user)
    await user.click(screen.getByRole('button', { name: 'Preview import' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/workspaces/4/imports/preview/')
    expect(await screen.findByRole('heading', { name: 'Preview results' })).toBeVisible()
    expect(screen.getByText('12 rows - checksum abcdef123456...')).toBeVisible()
    expect(screen.getByText('No validation exceptions found. The file is ready to import.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Commit reviewed import' })).toBeEnabled()
  })

  it('commits only the exact workbook that was previewed', async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        preview: {
          preview_id: 11,
          checksum: 'preview-checksum',
          summary: { total_rows: 4, creates: 2, updates: 2, exceptions: 0 },
          exceptions: [],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ result: { created: 2, updated: 2, exceptions: [] } }))
    vi.stubGlobal('fetch', fetchMock)

    render(<ImportView workspaceId={9} role="manager" />)
    await chooseWorkbook(user)
    await user.click(screen.getByRole('button', { name: 'Preview import' }))
    await user.click(await screen.findByRole('button', { name: 'Commit reviewed import' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const [url, options] = fetchMock.mock.calls[1]
    expect(url).toBe('/api/workspaces/9/imports/commit/')
    expect(options.body.get('preview_id')).toBe('11')
    expect(options.body.get('preview_checksum')).toBe('preview-checksum')
    expect(screen.getByText('2 created, 2 updated.')).toBeVisible()
  })

  it('allows members to review a file without exposing the commit action', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      preview: {
        preview_id: 12,
        checksum: 'member-preview',
        summary: { total_rows: 2, creates: 1, updates: 1, exceptions: 1 },
        exceptions: [{ row: 2, field: 'owner', message: 'Could not match owner.' }],
      },
    })))

    render(<ImportView workspaceId={3} role="member" />)
    await chooseWorkbook(user)
    await user.click(screen.getByRole('button', { name: 'Preview import' }))

    expect(await screen.findByText('Only owners and managers can commit imports.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Commit reviewed import' })).not.toBeInTheDocument()
    expect(screen.getByText('Preview only')).toBeVisible()
    expect(screen.getByText('Could not match owner.')).toBeVisible()
  })
})
