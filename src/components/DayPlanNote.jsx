import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles, Trash2 } from 'lucide-react'
import { Button } from './ui/button.jsx'
import { Card } from './ui/card.jsx'
import { getCsrfToken, readJsonResponse, toDateKey } from '../lib/workspace-format.js'
import { takePendingDayPlan } from '../lib/day-plan-navigation.js'

// Zuri's plan for the day, kept as a note at the bottom of My planner. It is a
// note and not a planner item: nothing that counts planner work (the Today ring,
// the planner totals) ever reads it, and the person can delete it at any time.
export function buildPlanPrompt(openPersonalTitles, today, dailyMinutes) {
  const hours = dailyMinutes ? Math.round((dailyMinutes / 60) * 10) / 10 : 0
  const length = hours
    ? `My working day is ${hours} hours long (Settings), so plan no more than ${hours} hours of work in total, and say what to move if it does not fit.`
    : ''
  const own = openPersonalTitles.length
    ? `My private planner items still open: ${openPersonalTitles.slice(0, 40).map(title => `"${title}"`).join('; ')}.`
    : 'I have no open items in my private planner.'
  return [
    `Plan my working day for ${today}.`,
    length,
    'Use the tasks assigned to me in the workspace that are overdue, due today or in progress, plus my planner items below.',
    own,
    'Give a short schedule as plain lines like "09:00-11:00 Task name (2h)". Say how long each task should take, group small ones together, and put breaks in (just 5 minutes about every 90 minutes). Do not schedule a lunch break: lunch is already covered by my employer, outside the hours I am planning.',
    'Put the most important or most overdue work first. If it cannot all fit in one day, say what to move to another day.',
    'Reply with the plan only, in plain text without markdown. Do not propose any changes to tasks: the actions must be null.',
  ].join(' ')
}

export default function DayPlanNote({ workspaceId, openPersonalTitles }) {
  const today = toDateKey(new Date())
  const [note, setNote] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [dailyMinutes, setDailyMinutes] = useState(0)
  const [leaveShare, setLeaveShare] = useState(0)
  const minutesRef = useRef(0)
  minutesRef.current = dailyMinutes
  const titlesRef = useRef(openPersonalTitles)
  titlesRef.current = openPersonalTitles

  const call = useCallback(async (url, method, body) => {
    const response = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': String(workspaceId), 'X-CSRFToken': await getCsrfToken() },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await readJsonResponse(response, 'That did not work.')
    if (!response.ok) throw new Error(data?.error || 'That did not work.')
    return data
  }, [workspaceId])

  const save = useCallback(async (body) => {
    const data = await call(`/api/workspaces/${workspaceId}/personal/day-plan/`, 'PUT', { date: today, body })
    setNote(data.note)
    return data.note
  }, [call, workspaceId, today])

  const generate = useCallback(async () => {
    setBusy('Zuri is planning your day...')
    setError('')
    try {
      const data = await call(`/api/workspaces/${workspaceId}/ai/chat/`, 'POST', { message: buildPlanPrompt(titlesRef.current, today, minutesRef.current), history: [] })
      const plan = String(data.answer || '').trim()
      if (!plan) throw new Error('Zuri did not return a plan. Try again.')
      await save(plan)
    } catch (failure) {
      setError(failure.message || 'Zuri could not plan your day.')
    } finally {
      setBusy('')
    }
  }, [call, save, today, workspaceId])

  useEffect(() => {
    if (!workspaceId) return undefined
    let cancelled = false
    call(`/api/workspaces/${workspaceId}/personal/day-plan/?date=${today}`, 'GET')
      .then(data => {
        if (cancelled) return
        setNote(data.note)
        const share = Number(data.leave_share) || 0
        setLeaveShare(share)
        setDailyMinutes(Number(data.daily_minutes) || 0)
        // A half day off halves the hours there are to plan.
        minutesRef.current = Math.round((Number(data.daily_minutes) || 0) * (1 - share))
        setLoaded(true)
        if (takePendingDayPlan() && share < 1) generate()
      })
      .catch(failure => { if (!cancelled) { setError(failure.message); setLoaded(true) } })
    return () => { cancelled = true }
    // generate is stable per workspace; today only changes at midnight.
  }, [workspaceId, today]) // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async () => {
    setBusy('Deleting...')
    setError('')
    try {
      await call(`/api/workspaces/${workspaceId}/personal/day-plan/?date=${today}`, 'DELETE')
      setNote(null)
      setEditing(false)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy('')
    }
  }

  const saveEdit = async () => {
    if (!draft.trim()) return
    setBusy('Saving...')
    setError('')
    try {
      await save(draft.trim())
      setEditing(false)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <Card className="day-plan-note" aria-label="Day plan">
      <header className="day-plan-header">
        <div>
          <h2><Sparkles size={16} aria-hidden="true" /> Day plan</h2>
          <p>Zuri&apos;s suggestion for today. It is a note: it does not count in your progress ring.</p>
        </div>
        <div className="day-plan-actions">
          <Button type="button" variant="outline" size="sm" disabled={Boolean(busy) || leaveShare >= 1} onClick={generate}>{note ? 'Plan again' : 'Plan my day with Zuri'}</Button>
          {note && <button type="button" className="day-plan-delete" aria-label="Delete day plan" title="Delete day plan" disabled={Boolean(busy)} onClick={remove}><Trash2 size={15} /></button>}
        </div>
      </header>
      {leaveShare >= 1 && <p className="day-plan-status">You are on approved leave today, so there is nothing to plan.</p>}
      {leaveShare > 0 && leaveShare < 1 && <p className="day-plan-status">You have half a day off today, so Zuri plans around the other half.</p>}
      {busy && <p className="day-plan-status" role="status">{busy}</p>}
      {error && <p className="day-plan-error" role="alert">{error}</p>}
      {note && !editing && <>
        <pre className="day-plan-body">{note.body}</pre>
        <button type="button" className="day-plan-edit" onClick={() => { setDraft(note.body); setEditing(true) }}>Edit</button>
      </>}
      {editing && <div className="day-plan-edit-form">
        <textarea aria-label="Day plan text" value={draft} onChange={event => setDraft(event.target.value)} rows={8} />
        <div><Button type="button" size="sm" onClick={saveEdit} disabled={Boolean(busy) || !draft.trim()}>Save</Button> <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button></div>
      </div>}
      {loaded && !note && !busy && !error && <p className="day-plan-empty">No plan for today yet.</p>}
    </Card>
  )
}
