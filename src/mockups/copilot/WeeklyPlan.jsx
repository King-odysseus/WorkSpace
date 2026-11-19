import React, { useState } from 'react'
import { AlertTriangle, ArrowRight, Check, CheckCircle2, ClipboardCheck, Pause, Pencil, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import Avatar from '../../components/Avatar.jsx'
import { FromChip, ModelChip, Notice, Panel, SourceChip } from './parts.jsx'

/*
 * Weekly plan: the agreed direction broken into this week's team tasks,
 * matched to each person's capacity, then held for the owner's approval.
 * Approved tasks are created through the workspace's existing task endpoints,
 * so they appear in Planner and My tasks like any other task.
 */

const CAPACITY_HOURS = 40
const people = [
  { name: 'Sarah Okafor', base: 47.2 },
  { name: 'Marcus Bell', base: 38.4 },
  { name: 'Priya Nair', base: 29.6 },
  { name: 'Dev Rao', base: 20.8 },
]

export const PLAN_TASKS = [
  { id: 1, who: 'Sarah Okafor', title: 'Confirm the packaging supplier quote', due: '18-11-26', priority: 'High', project: 'Wholesale launch', hours: 3, why: 'The launch date depends on this quote.' },
  { id: 2, who: 'Marcus Bell', title: 'Review and send the 2 cafe follow-up emails', due: '16-11-26', priority: 'High', project: 'Cafe partnerships', hours: 1, why: 'Both threads passed 5 days with no reply.' },
  { id: 3, who: 'Marcus Bell', title: 'Call the Bluebird Cafe owner', due: '17-11-26', priority: 'Medium', project: 'Cafe partnerships', hours: 0.5, why: 'A call usually lands better than a third email.' },
  { id: 4, who: 'Priya Nair', title: 'Outline the wholesale launch announcement', due: '18-11-26', priority: 'Medium', project: 'Wholesale launch', hours: 3, why: 'Needed before the date is announced.' },
  { id: 5, who: 'Priya Nair', title: 'Compare the 20% discount with a gift-set bundle', due: '20-11-26', priority: 'Medium', project: 'Holiday promotion', hours: 4, why: 'Resolves the brand conflict flagged in chat.' },
  { id: 6, who: 'Dev Rao', title: 'Review the pack design options', due: '19-11-26', priority: 'Medium', project: 'Wholesale launch', hours: 4, why: 'Moved from Sarah to keep her under 115%.', moved: true },
  { id: 7, who: 'Dev Rao', title: 'List the photos needed for the wholesale page', due: '20-11-26', priority: 'Low', project: 'Wholesale launch', hours: 2, why: 'Open question from Thursday: nobody owns photography.' },
]

const pauses = [
  { id: 'a', title: 'Update the newsletter template', hours: 2 },
  { id: 'b', title: 'Reorder shipping labels', hours: 3 },
]

const priorityTone = { High: 'text-danger', Medium: 'text-text-secondary', Low: 'text-text-muted' }

export default function WeeklyPlan({ created, onApprove, onViewPlanner }) {
  const [included, setIncluded] = useState(() => new Set(PLAN_TASKS.map(task => task.id)))
  const [paused, setPaused] = useState(() => new Set(['a', 'b']))

  const toggle = (set, setter, id) => setter(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })
  const selected = PLAN_TASKS.filter(task => included.has(task.id))
  const pausedHours = pauses.filter(item => paused.has(item.id)).reduce((sum, item) => sum + item.hours, 0)

  const loadFor = person => {
    const added = selected.filter(task => task.who === person.name).reduce((sum, task) => sum + task.hours, 0)
    const relief = person.name === 'Sarah Okafor' ? pausedHours : 0
    return Math.round(((person.base + added - relief) / CAPACITY_HOURS) * 100)
  }

  if (created) {
    return (
      <div className="@container mx-auto max-w-3xl space-y-5 py-8">
        <div className="rounded-control border border-alert-success-stroke bg-alert-success-fill p-6">
          <p className="flex items-center gap-2 text-lg font-semibold text-alert-success-text"><CheckCircle2 size={20} /> {created.length} tasks created for the week of 16-11-26</p>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">They are ordinary workspace tasks now. Assignees have been notified the usual way, and they can see them in Planner and My tasks without the desktop app. {pausedHours ? `${pausedHours}h of Sarah's work was paused as agreed.` : ''}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={onViewPlanner}>View in Planner <ArrowRight size={14} /></Button>
            <Button variant="outline">Back to dashboard</Button>
          </div>
        </div>
        <Notice icon={ClipboardCheck}>Logged to the decision journal: direction "Lock the wholesale launch date" agreed 14-11-26, with a 30-day review set.</Notice>
      </div>
    )
  }

  return (
    <div className="@container space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">Week of 16-11-26 - draft for your approval</p>
          <h2 className="text-2xl font-bold text-text-primary">Turn the agreed direction into this week's team tasks</h2>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">Matched to each person's hours, leave and current load. Nothing is created until you approve.</p>
        </div>
        <ModelChip name="Claude Sonnet 5.5" kind="cloud" note="Planning uses your strongest model" />
      </section>

      <Panel title="Direction agreed with you" sub="Recorded in the decision journal when you approve this plan." action={<Badge variant="accent" className="px-3 py-1">Agreed 14-11-26</Badge>}>
        <p className="text-base font-semibold text-text-primary">Lock the wholesale launch date before adding new products</p>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">Why it fits: your vision doc names wholesale as the 12-month growth engine, and three chats this month stalled on the launch date.</p>
        <div className="mt-3 flex flex-wrap gap-2"><FromChip>Chat, 11-11-26</FromChip><FromChip>Chat, 13-11-26</FromChip><SourceChip>Vision 2026, p.3</SourceChip><SourceChip>Q3 financials, p.2</SourceChip></div>
      </Panel>

      <div className="grid gap-6 @3xl:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {people.map(person => {
            const load = loadFor(person)
            const over = load > 100
            const tasks = PLAN_TASKS.filter(task => task.who === person.name)
            return (
              <section key={person.name} className="rounded-control border border-border bg-surface">
                <header className="flex flex-wrap items-center gap-3 border-b border-border-light px-5 py-3">
                  <Avatar name={person.name} small />
                  <h3 className="text-sm font-semibold text-text-primary">{person.name}</h3>
                  <span className="text-xs text-text-muted">{tasks.length} proposed {tasks.length === 1 ? 'task' : 'tasks'}</span>
                  <div className="ml-auto flex items-center gap-3">
                    <div className="h-2 w-28 rounded-full bg-surface-secondary" role="img" aria-label={`${person.name} would be at ${load} percent of capacity`}>
                      <div className={`h-full rounded-full ${over ? 'bg-warning' : 'bg-navy'}`} style={{ width: `${Math.min(load, 125) / 1.25}%` }} />
                    </div>
                    <span className={`w-36 whitespace-nowrap text-right text-xs font-semibold ${over ? 'text-warning' : 'text-text-secondary'}`}>{load}% of capacity{over ? ' - over' : ''}</span>
                  </div>
                </header>
                <ul className="divide-y divide-border-light">
                  {tasks.map(task => {
                    const on = included.has(task.id)
                    return (
                      <li key={task.id} className={`flex items-start gap-3 px-5 py-3.5 ${on ? '' : 'opacity-50'}`}>
                        <button type="button" role="checkbox" aria-checked={on} aria-label={`Include ${task.title}`} onClick={() => toggle(included, setIncluded, task.id)} className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border ${on ? 'border-navy bg-navy text-white' : 'border-border-strong bg-surface text-transparent'}`}><Check size={13} /></button>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-text-primary">{task.title}</p>
                          <p className="mt-0.5 text-xs text-text-muted">{task.why}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            <Badge variant="outline">Due {task.due}</Badge>
                            <span className={`font-semibold ${priorityTone[task.priority]}`}>{task.priority}</span>
                            <span className="text-text-muted">{task.project} - about {task.hours}h</span>
                            {task.moved && <Badge variant="secondary">Moved from Sarah</Badge>}
                          </div>
                        </div>
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${task.title}`}><Pencil size={15} /></Button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>

        <aside className="space-y-4">
          <section className="rounded-control border border-alert-warning-stroke bg-alert-warning-fill p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-alert-warning-text"><AlertTriangle size={15} /> Sarah is over capacity</h3>
            <p className="mt-2 text-xs leading-relaxed text-text-secondary">She is at 118% before this plan. I gave her only the task the launch depends on, and suggest pausing two lower-value jobs. Untick to keep them.</p>
            <ul className="mt-3 space-y-2">
              {pauses.map(item => (
                <li key={item.id} className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2.5">
                  <button type="button" role="checkbox" aria-checked={paused.has(item.id)} aria-label={`Pause ${item.title}`} onClick={() => toggle(paused, setPaused, item.id)} className={`grid size-5 shrink-0 place-items-center rounded-md border ${paused.has(item.id) ? 'border-navy bg-navy text-white' : 'border-border-strong bg-surface text-transparent'}`}><Pause size={11} /></button>
                  <span className="min-w-0 flex-1 text-xs text-text-primary">{item.title}</span>
                  <span className="text-xs text-text-muted">{item.hours}h</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-control border border-border bg-surface p-5">
            <h3 className="text-sm font-semibold text-text-primary">What happens on approval</h3>
            <ol className="mt-3 space-y-2 text-xs leading-relaxed text-text-secondary">
              <li>1. Tasks are created in this workspace through the normal task system.</li>
              <li>2. Each assignee is notified the usual way.</li>
              <li>3. The direction is saved to your decision journal with a 30-day review.</li>
              <li>4. I check progress midweek and flag anything stalled.</li>
            </ol>
          </section>
        </aside>
      </div>

      <div className="sticky bottom-0 z-10 -mx-2 flex flex-wrap items-center justify-between gap-3 rounded-control border border-border bg-surface px-5 py-4 shadow-card">
        <p className="flex items-center gap-2 text-sm text-text-secondary"><ShieldCheck size={16} className="text-text-muted" /> <span><strong className="text-text-primary">{selected.length} tasks</strong> for {new Set(selected.map(task => task.who)).size} people. Assigning to others needs your approval.</span></p>
        <div className="flex gap-2">
          <Button variant="ghost">Discard draft</Button>
          <Button variant="outline">Ask for changes</Button>
          <Button disabled={!selected.length} onClick={() => onApprove(selected)}><Check size={15} /> Approve and create {selected.length} tasks</Button>
        </div>
      </div>
    </div>
  )
}
