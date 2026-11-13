import React, { useEffect, useState } from 'react'
import { getCsrfToken } from '../lib/workspace-format.js'

// Owners and managers can choose not to check in. Turning it on takes you out of
// the pending list, the daily reminder and the check-in counts for the workspace;
// it never hides anyone else's. Members are expected to check in, so this renders
// nothing for them (and the server refuses them in any case).
export default function CheckInOptOut({ workspaceId, role, onChanged }) {
  const [skips, setSkips] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const eligible = role === 'owner' || role === 'manager'

  useEffect(() => {
    if (!eligible || !workspaceId) return undefined
    const controller = new AbortController()
    fetch(`/api/workspaces/${workspaceId}/check-in-preference/`, { credentials: 'include', signal: controller.signal, headers: { 'X-Workspace-Id': String(workspaceId) } })
      .then(response => (response.ok ? response.json() : Promise.reject(new Error('Your check-in setting could not be loaded.'))))
      .then(payload => setSkips(Boolean(payload.skips_check_ins)))
      .catch(loadError => { if (loadError.name !== 'AbortError') setError(loadError.message) })
    return () => controller.abort()
  }, [workspaceId, eligible])

  if (!eligible) return null

  const toggle = async () => {
    if (saving || skips === null) return
    const next = !skips
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/check-in-preference/`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) },
        body: JSON.stringify({ skips_check_ins: next }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Your check-in setting could not be saved.')
      setSkips(Boolean(payload.skips_check_ins))
      onChanged?.()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="settings-row settings-control-row">
        <div>
          <strong>Daily check-ins</strong>
          <span>Turn this on if you do not need to check in. You will not be listed as pending, reminded, or counted in the check-in totals.</span>
        </div>
        <label className="checkin-optout-switch">
          <input type="checkbox" role="switch" checked={Boolean(skips)} disabled={saving || skips === null} onChange={toggle} aria-label="Skip my daily check-ins" />
          <span>{skips ? 'Skipping check-ins' : 'Checking in'}</span>
        </label>
      </div>
      {error && <p className="memo-error" role="alert">{error}</p>}
    </>
  )
}
