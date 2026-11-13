import { useCallback } from 'react'
import { getCsrfToken } from './workspace-format.js'

// One way to call the workspace's own JSON API from the newer pages (requests,
// time off, where we work). A non-ok answer throws the server's own message, so
// the page can show it as it is.
export async function workspaceCall(workspaceId, path, method = 'GET', body) {
  const response = await fetch(`/api/workspaces/${workspaceId}/${path}`, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Workspace-Id': String(workspaceId),
      ...(method === 'GET' ? {} : { 'X-CSRFToken': await getCsrfToken() }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'That did not work. Try again.')
  return data
}

export function useWorkspaceCall(workspaceId) {
  return useCallback((path, method, body) => workspaceCall(workspaceId, path, method, body), [workspaceId])
}

export const fmtDate = (iso, options = { dateStyle: 'medium' }) => new Date(`${iso}T00:00:00`).toLocaleDateString([], options)
export const isoDate = date => {
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
