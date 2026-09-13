// A member's own day planner. Deliberately separate from team tasks rather than
// a private flag on one: there is no board, report, reminder or notification in
// the app that can be pointed at this list, so there is no query that has to
// remember to filter it out.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, NotebookPen, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from './ui/button.jsx'
import { Card } from './ui/card.jsx'
import { EmptyState, WorkspaceViewHeading } from './workspace-ui.jsx'
import { formatDay, getCsrfToken, readJsonResponse, toDateKey } from '../lib/workspace-format.js'

function PersonalPlanner({ workspaceId }) {
  const [planners, setPlanners] = useState([])
  const [tasks, setTasks] = useState([])
  const [selectedPlannerId, setSelectedPlannerId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState('')
  const [addingPlanner, setAddingPlanner] = useState(false)
  const [plannerName, setPlannerName] = useState('')
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmingPlannerId, setConfirmingPlannerId] = useState(null)
  const [confirmingTaskId, setConfirmingTaskId] = useState(null)
  const [openNotesId, setOpenNotesId] = useState(null)
  const today = toDateKey(new Date())

  const request = useCallback(async (suffix, method, body) => {
    const response = await fetch(`/api/workspaces/${workspaceId}/personal${suffix}`, {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Id': String(workspaceId),
        'X-CSRFToken': await getCsrfToken(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    // readJsonResponse hands back a non-ok body instead of throwing, so the
    // message the server chose is the one the page shows.
    const data = await readJsonResponse(response, 'That did not work.')
    if (!response.ok) throw new Error(data?.error || 'That did not work.')
    return data
  }, [workspaceId])

  const replaceTask = useCallback((task) => {
    setTasks(current => current.map(item => (item.id === task.id ? task : item)))
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    request('/planners/', 'GET')
      .then(data => {
        if (cancelled) return
        setPlanners(data.planners || [])
        setTasks(data.tasks || [])
        setError('')
      })
      .catch(failure => { if (!cancelled) setError(failure.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [request])

  // Derived rather than stored. A stored open planner needs an effect to keep it
  // pointing at a planner that still exists, and that leaves a render where the
  // list has loaded but nothing is open - which reads as "no planners yet".
  const activePlanner = planners.find(planner => planner.id === selectedPlannerId) || planners[0] || null
  const activeId = activePlanner?.id ?? null
  const activeTasks = useMemo(() => tasks.filter(task => task.planner_id === activeId), [tasks, activeId])
  const openCountFor = useCallback(
    plannerId => tasks.filter(task => task.planner_id === plannerId && !task.is_done).length,
    [tasks],
  )
  const summary = useMemo(() => {
    if (!activeTasks.length) return 'Nothing planned yet.'
    const done = activeTasks.filter(task => task.is_done).length
    const overdue = activeTasks.filter(task => !task.is_done && task.due_date && task.due_date < today).length
    return overdue ? `${done} of ${activeTasks.length} done - ${overdue} overdue` : `${done} of ${activeTasks.length} done`
  }, [activeTasks, today])

  const run = async (work) => {
    setSaving(true)
    try {
      await work()
      setError('')
    } catch (failure) {
      setError(failure.message)
    } finally {
      setSaving(false)
    }
  }

  const submitPlanner = (event) => {
    event.preventDefault()
    const name = plannerName.trim()
    if (!name) return
    return run(async () => {
      const data = await request('/planners/', 'POST', { name })
      setPlanners(current => [...current, data.planner])
      setSelectedPlannerId(data.planner.id)
      setPlannerName('')
      setAddingPlanner(false)
    })
  }

  const submitRename = (event) => {
    event.preventDefault()
    const name = renameValue.trim()
    if (!name) return
    return run(async () => {
      const data = await request(`/planners/${renamingId}/`, 'PATCH', { name })
      setPlanners(current => current.map(planner => (planner.id === data.planner.id ? data.planner : planner)))
      setRenamingId(null)
    })
  }

  const deletePlanner = (planner) => run(async () => {
    await request(`/planners/${planner.id}/`, 'DELETE')
    setPlanners(current => current.filter(item => item.id !== planner.id))
    setTasks(current => current.filter(task => task.planner_id !== planner.id))
    setConfirmingPlannerId(null)
  })

  const submitTask = (event) => {
    event.preventDefault()
    const title = draft.trim()
    if (!title || !activeId) return
    return run(async () => {
      const data = await request('/tasks/', 'POST', { title, planner_id: activeId })
      setTasks(current => [...current, data.task])
      setDraft('')
    })
  }

  // Ticking is optimistic because it is the one action done in a burst, and a
  // round trip per tick makes a list feel broken. A failure puts the tick back.
  const toggleTask = async (task) => {
    const next = !task.is_done
    setTasks(current => current.map(item => (item.id === task.id ? { ...item, is_done: next } : item)))
    try {
      replaceTask((await request(`/tasks/${task.id}/`, 'PATCH', { is_done: next })).task)
      setError('')
    } catch (failure) {
      replaceTask(task)
      setError(failure.message)
    }
  }

  const patchTask = async (task, patch, optimistic) => {
    if (optimistic) setTasks(current => current.map(item => (item.id === task.id ? { ...item, ...patch } : item)))
    try {
      replaceTask((await request(`/tasks/${task.id}/`, 'PATCH', patch)).task)
      setError('')
      return true
    } catch (failure) {
      replaceTask(task)
      setError(failure.message)
      return false
    }
  }

  const deleteTask = (task) => run(async () => {
    await request(`/tasks/${task.id}/`, 'DELETE')
    setTasks(current => current.filter(item => item.id !== task.id))
    setConfirmingTaskId(null)
  })

  // Committing on blur rather than on every keystroke: a title is one edit, and
  // a request per character would put the caret behind the network.
  const commitTitle = async (task, input) => {
    const title = input.value.trim()
    if (!title || title === task.title) {
      input.value = task.title
      return
    }
    if (!await patchTask(task, { title })) input.value = task.title
  }

  const commitNotes = (task, input) => patchTask(task, { notes: input.value })

  return <section className="workspace-view personal-planner-view">
    <WorkspaceViewHeading title="My planner" subtitle="Your own list for planning the day. Private to you - nobody else in the workspace can see it." />
    {error && <p className="personal-planner-error" role="alert">{error}</p>}
    <div className="personal-planner-layout">
      <aside className="personal-planner-list" aria-label="My planners">
        {planners.map(planner => renamingId === planner.id
          ? <form className="personal-planner-rename" key={planner.id} onSubmit={submitRename}>
            <input autoFocus aria-label="Planner name" value={renameValue} onChange={event => setRenameValue(event.target.value)} />
            <Button type="submit" variant="ghost" size="icon-sm" aria-label="Save planner name" disabled={saving}><Check size={14} /></Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Cancel rename" onClick={() => setRenamingId(null)}><X size={14} /></Button>
          </form>
          : <div className={`personal-planner-item ${planner.id === activeId ? 'is-active' : ''}`} key={planner.id}>
            <button type="button" className="personal-planner-pick" onClick={() => setSelectedPlannerId(planner.id)} aria-current={planner.id === activeId}>
              <span className="personal-planner-name">{planner.name}</span>
              <span className="personal-planner-count">{openCountFor(planner.id)}</span>
            </button>
            {confirmingPlannerId === planner.id
              ? <span className="personal-planner-confirm">
                <Button type="button" variant="destructive" size="sm" disabled={saving} onClick={() => deletePlanner(planner)}>Delete</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingPlannerId(null)}>Cancel</Button>
              </span>
              : <span className="personal-planner-item-actions">
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Rename ${planner.name}`} onClick={() => { setRenamingId(planner.id); setRenameValue(planner.name) }}><Pencil size={13} /></Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${planner.name}`} onClick={() => setConfirmingPlannerId(planner.id)}><Trash2 size={13} /></Button>
              </span>}
          </div>)}
        {addingPlanner
          ? <form className="personal-planner-rename" onSubmit={submitPlanner}>
            <input autoFocus aria-label="New planner name" placeholder="Name this planner" value={plannerName} onChange={event => setPlannerName(event.target.value)} />
            <Button type="submit" variant="ghost" size="icon-sm" aria-label="Create planner" disabled={saving || !plannerName.trim()}><Check size={14} /></Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Cancel new planner" onClick={() => { setAddingPlanner(false); setPlannerName('') }}><X size={14} /></Button>
          </form>
          : <Button type="button" variant="ghost" size="sm" className="personal-planner-new" onClick={() => setAddingPlanner(true)}><Plus size={14} /> New planner</Button>}
      </aside>
      <div className="personal-planner-main">
        {loading
          ? <Card className="personal-planner-card"><EmptyState text="Loading your planner..." /></Card>
          : !activePlanner
            ? <Card className="personal-planner-card"><EmptyState text="Create a planner to start planning your day." /></Card>
            : <Card className="personal-planner-card">
              <header className="personal-planner-header">
                <div>
                  <h2>{activePlanner.name}</h2>
                  <p className="personal-planner-summary">{summary}</p>
                </div>
                <NotebookPen size={18} aria-hidden="true" />
              </header>
              <form className="personal-planner-composer" onSubmit={submitTask}>
                <input aria-label="Add to my day" placeholder="Add something to your day" value={draft} onChange={event => setDraft(event.target.value)} />
                <Button type="submit" disabled={saving || !draft.trim()}>Add</Button>
              </form>
              {activeTasks.length
                ? <ul className="personal-task-list">
                  {activeTasks.map(task => <li className={`personal-task ${task.is_done ? 'is-done' : ''}`} key={task.id}>
                    <button
                      type="button"
                      className="personal-task-tick"
                      onClick={() => toggleTask(task)}
                      aria-pressed={task.is_done}
                      aria-label={task.is_done ? `Reopen ${task.title}` : `Finish ${task.title}`}
                    >{task.is_done && <Check size={13} />}</button>
                    <div className="personal-task-body">
                      <input
                        className="personal-task-title"
                        aria-label={`Title for ${task.title}`}
                        defaultValue={task.title}
                        onBlur={event => commitTitle(task, event.target)}
                        onKeyDown={event => { if (event.key === 'Enter') event.target.blur() }}
                      />
                      <div className="personal-task-meta">
                        <input
                          type="date"
                          className="personal-task-date"
                          aria-label={`Due date for ${task.title}`}
                          value={task.due_date}
                          onChange={event => patchTask(task, { due_date: event.target.value }, true)}
                        />
                        <button type="button" className="personal-task-link" onClick={() => setOpenNotesId(current => (current === task.id ? null : task.id))}>
                          {task.notes ? 'Notes' : 'Add notes'}
                        </button>
                        {!task.is_done && task.due_date && task.due_date < today && <span className="personal-task-flag">Due {formatDay(task.due_date)}</span>}
                        {task.is_done && task.completed_at && <span className="personal-task-flag is-quiet">Done {formatDay(task.completed_at)}</span>}
                        {planners.length > 1 && <select
                          className="personal-task-move"
                          aria-label={`Planner for ${task.title}`}
                          value={task.planner_id}
                          onChange={event => patchTask(task, { planner_id: Number(event.target.value) }, true)}
                        >{planners.map(planner => <option value={planner.id} key={planner.id}>{planner.name}</option>)}</select>}
                      </div>
                      {openNotesId === task.id && <textarea
                        className="personal-task-notes"
                        aria-label={`Notes for ${task.title}`}
                        placeholder="Anything you want to remember about this"
                        defaultValue={task.notes}
                        onBlur={event => commitNotes(task, event.target)}
                      />}
                    </div>
                    {confirmingTaskId === task.id
                      ? <span className="personal-planner-confirm">
                        <Button type="button" variant="destructive" size="sm" disabled={saving} onClick={() => deleteTask(task)}>Delete</Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingTaskId(null)}>Cancel</Button>
                      </span>
                      : <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${task.title}`} onClick={() => setConfirmingTaskId(task.id)}><Trash2 size={13} /></Button>}
                  </li>)}
                </ul>
                : <EmptyState text="Nothing here yet. Add your first item above." />}
            </Card>}
      </div>
    </div>
  </section>
}

export default PersonalPlanner
