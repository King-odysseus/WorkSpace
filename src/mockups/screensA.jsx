import React from 'react'
import { Clock, Search, MoreHorizontal, Pencil, Trash2, UserPlus, CalendarDays, ChevronRight, Flame, FolderOpen, Hash, Lock, Paperclip, Pin, Plus, Send, Smile, Sparkles, Target, Check, Star, Repeat } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CircularProgress } from '@/components/ui/circular-progress'
import { Bar, Chip, FilterPill, FilterRow, Hero, IconCircle, PageHead, Panel, Person, PillSearch, Section, Segmented, TaskRow, Tile, hoverLift, soft } from './kit.jsx'

// Container-query breakpoints (@3xl = 48rem) are used instead of viewport ones,
// so the same screen lays out correctly in the desktop and the phone frame.

export function SignIn() {
  const field = 'h-12 w-full rounded-full bg-surface-secondary px-5 text-sm text-text-primary placeholder:text-text-muted'
  const bare = { border: 0, boxShadow: 'none', outline: 0 }
  return (
    <div className="grid min-h-[620px] place-items-center rounded-[36px] bg-gradient-to-br from-surface-secondary to-info-soft p-5 @3xl:p-8">
      <Panel className="w-full max-w-[420px] p-9 shadow-[var(--shadow-lift)]">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">Team operations</p>
        <h1 className="text-3xl font-bold text-text-primary">Welcome back</h1>
        <p className="mb-7 mt-1 text-sm text-text-secondary">Sign in to see your team pulse and priorities.</p>
        <label className="mb-4 block text-xs font-semibold text-text-primary">Email<input style={bare} className={`${field} mt-1.5 block`} placeholder="you@company.com" /></label>
        <label className="mb-6 block text-xs font-semibold text-text-primary">Password<input style={bare} className={`${field} mt-1.5 block`} type="password" placeholder="At least 8 characters" /></label>
        <Button size="lg" className="w-full shadow-[var(--shadow-soft)]">Sign in</Button>
        <Button size="lg" variant="secondary" className="mt-3 w-full">Continue with Google</Button>
        <p className="mt-5 text-center text-sm text-info">New to WorkSpace? Create an account</p>
      </Panel>
    </div>
  )
}

export function Today() {
  return (
    <div className="space-y-8 @3xl:space-y-12">
      <Hero
        eyebrow="Thursday, 12 November" title="Good afternoon, Nate"
        text="Four tasks are due today and one is overdue. The Q4 roadmap review starts at 16:30."
        actions={<><Button variant="gold" size="lg"><Sparkles size={18} /> Plan my day</Button><Button variant="ghost" size="lg" className="bg-white/10 text-white hover:bg-white/20"><CalendarDays size={18} /> Calendar</Button></>}
        aside={<CircularProgress value={62} size={140} stroke={14} caption="done today" className="text-bronze [&_*]:text-white" />}
      />
      <div className="grid grid-cols-2 gap-4 @3xl:grid-cols-4">
        {[['Due today', '4', Target, 'bg-info-soft text-info'], ['Overdue', '1', Flame, 'bg-danger-soft text-danger'], ['Done this week', '12', Check, 'bg-success-soft text-success'], ['Open projects', '3', FolderOpen, 'bg-warning-soft text-warning']].map(([label, value, Icon, tone]) => (
          <Tile key={label} className="flex items-center gap-4"><span className={`grid size-12 shrink-0 place-items-center rounded-full ${tone}`}><Icon size={20} /></span><div><p className="text-2xl font-bold leading-none text-text-primary">{value}</p><p className="mt-1 text-sm text-text-muted">{label}</p></div></Tile>
        ))}
      </div>
      <div className="grid gap-8 @3xl:grid-cols-[1.6fr_1fr]">
        <div className={`flex items-center gap-3 rounded-full bg-surface py-3 pl-6 pr-3 ${soft}`}><Plus size={18} className="text-text-muted" /><span className="flex-1 text-sm text-text-muted">Add a task for today</span><Button size="sm">Add</Button></div>
        <div className={`flex items-center justify-between gap-4 rounded-full bg-surface py-3 pl-6 pr-3 ${soft}`}><span className="flex items-center gap-3 text-sm text-text-primary"><Clock size={18} className="text-info" /><strong>3h 12m</strong> today</span><Button size="sm" variant="secondary">Clock out</Button></div>
      </div>
      <div className="grid gap-8 @3xl:grid-cols-[1.6fr_1fr]">
        <Section title="Up next" action={<Button variant="ghost" size="sm">See all</Button>}>
          <div className="space-y-4">
            <TaskRow title="Finalise Q4 roadmap copy" meta="Due today · Roadmap" tag="High" tone="danger" />
            <TaskRow title="Fix billing webhook retries" meta="Overdue · Platform" tag="Overdue" tone="navy" />
            <TaskRow title="Review onboarding copy" meta="Due today · Growth" tag="Normal" />
          </div>
        </Section>
        <Section title="Schedule">
          <Panel className="space-y-1 p-3">
            {[['16:30', 'Roadmap review', 'Room 2'], ['17:15', '1:1 with Dana', 'Video'], ['18:00', 'Wrap up', '']].map(([time, name, where]) => (
              <div key={name} className="flex items-center gap-4 rounded-2xl px-4 py-3 hover:bg-surface-secondary"><span className="w-12 text-sm font-semibold text-text-primary">{time}</span><div><p className="text-sm font-medium text-text-primary">{name}</p>{where && <p className="text-xs text-text-muted">{where}</p>}</div></div>
            ))}
          </Panel>
        </Section>
      </div>
    </div>
  )
}

export function MyTasks() {
  return (
    <>
      <PageHead title="My tasks" sub="Everything assigned to you across projects." actions={<Button><Plus size={18} /> New task</Button>} />
      <div className="mb-8 flex flex-wrap items-center gap-4"><PillSearch placeholder="Search my tasks" className="min-w-[220px] flex-1" /><Segmented options={['All', 'Today', 'Overdue']} /><FilterPill>Project</FilterPill><FilterPill>Priority</FilterPill><Button variant="secondary">Select</Button></div>
      <div className="space-y-8 @3xl:space-y-12">
        <Section title="Overdue"><div className="space-y-4"><TaskRow title="Fix billing webhook retries" meta="Was due 19 Nov · Platform" tag="Overdue" tone="danger" who="Nate Foster" status="To do" /></div></Section>
        <Section title="Today"><div className="space-y-4"><TaskRow title="Finalise Q4 roadmap copy" meta="Roadmap" tag="High" tone="danger" who="Nate Foster" /><TaskRow title="Review onboarding copy" meta="Growth" tag="Normal" who="Nate Foster" /></div></Section>
        <Section title="Later"><div className="space-y-4"><TaskRow title="Draft the launch announcement" meta="Due 24 Nov · Marketing" tag="Low" tone="muted" who="Nate Foster" /><TaskRow title="Book the planning room" meta="Done · Operations" tag="Done" tone="success" done who="Nate Foster" /></div></Section>
      </div>
    </>
  )
}

export function MyPlanner() {
  return (
    <>
      <PageHead title="My planner" sub="Your own list for planning the day. Private to you." />
      <div className="grid gap-8 @3xl:grid-cols-[260px_1fr]">
        <Panel className="space-y-2 p-4">
          {[['My day', 3, true], ['This week', 2], ['Someday', 1]].map(([name, count, on]) => (
            <div key={name} className={`flex items-center justify-between rounded-full px-5 py-3 text-sm font-medium ${on ? 'bg-navy text-white' : 'text-text-primary hover:bg-surface-secondary'}`}>{name}<span className={`grid size-6 place-items-center rounded-full text-xs ${on ? 'bg-white/20' : 'bg-surface-secondary'}`}>{count}</span></div>
          ))}
          <Button variant="ghost" size="sm" className="w-full justify-start"><Plus size={16} /> New planner</Button>
        </Panel>
        <div className="space-y-4">
          <div className={`flex items-center gap-3 rounded-full bg-surface py-2 pl-5 pr-2 ${soft}`}><Plus size={18} className="text-text-muted" /><span className="flex-1 text-sm text-text-muted">Add something to your day</span><Button size="sm">Add</Button></div>
          <TaskRow title="Finalise Q4 roadmap copy" meta="Due 21 Sep · Notes" />
          <TaskRow title="Fix billing webhook retries" meta="Due 19 Sep · Notes" tag="Overdue" tone="danger" />
          <TaskRow title="Book the planning room" meta="Done 20 Sep" done />
        </div>
      </div>
    </>
  )
}

export function DailyOps() {
  const routines = [['Morning stand-up', 'Weekdays 09:00', 80, true], ['Inbox zero', 'Daily', 40, false], ['Weekly metrics review', 'Fridays', 100, true], ['Backup verification', 'Daily', 60, false]]
  return (
    <>
      <PageHead eyebrow="Operations" title="Daily operations" sub="Recurring routines the team runs every day." actions={<Button><Plus size={18} /> New routine</Button>} />
      <div className="grid gap-6 @3xl:grid-cols-2">
        {routines.map(([name, cadence, pct, done]) => (
          <Tile key={name}><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-text-primary">{name}</h3><p className="flex items-center gap-1.5 text-sm text-text-muted"><Repeat size={14} /> {cadence}</p></div><Chip tone={done ? 'success' : 'warning'}>{done ? 'Done today' : 'Pending'}</Chip></div><div className="mt-5"><Bar value={pct} tone={done ? 'bg-success' : 'bg-navy'} /></div><div className="mt-3 flex items-center justify-between"><p className="text-xs text-text-muted">{pct}% of this week</p><Button size="sm" variant="secondary">{done ? "View log" : "Mark done"}</Button></div></Tile>
        ))}
      </div>
    </>
  )
}

export function Team() {
  const people = [['Nate Foster', 'Owner', 70, 'Available'], ['Dana Whitfield', 'Manager', 90, 'In a meeting'], ['Ada West', 'Member', 45, 'Available'], ['Bella Ortiz', 'Member', 20, 'Away']]
  return (
    <>
      <PageHead eyebrow="People" title="Team" sub="Who is working on what, and how loaded they are." actions={<Button><Plus size={18} /> Invite</Button>} />
      <FilterRow><PillSearch placeholder="Find a teammate" className="min-w-[220px] flex-1" /><FilterPill>All roles</FilterPill><FilterPill>Availability</FilterPill></FilterRow>
      <div className="grid gap-6 @3xl:grid-cols-2">
        {people.map(([name, role, load, status]) => (
          <Tile key={name}><div className="flex items-center gap-4"><Person name={name} small={false} /><div className="flex-1"><h3 className="font-semibold text-text-primary">{name}</h3><p className="text-sm text-text-muted">{role} · {status}</p></div><Chip tone={load > 80 ? 'danger' : 'muted'}>{load}% loaded</Chip><IconCircle label={`Actions for ${name}`}><MoreHorizontal size={16} /></IconCircle></div><div className="mt-4"><Bar value={load} tone={load > 80 ? 'bg-danger' : 'bg-navy'} /></div></Tile>
        ))}
      </div>
    </>
  )
}

export function Channels() {
  return (
    <div className="grid gap-8 @3xl:grid-cols-[240px_1fr]">
      <Panel className="space-y-1 p-3">
        <p className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">Channels</p>
        {[['general', true], ['design'], ['engineering'], ['launch-plan', false, true]].map(([name, on, locked]) => (
          <div key={name} className={`flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium ${on ? 'bg-navy text-white' : 'text-text-primary hover:bg-surface-secondary'}`}>{locked ? <Lock size={14} /> : <Hash size={14} />}{name}</div>
        ))}
      </Panel>
      <Panel className="flex min-h-[520px] flex-col @3xl:min-h-[680px] p-6">
        <div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Hash size={18} /> general</h2><div className="flex items-center gap-2"><Chip tone="muted">12 members</Chip><IconCircle label="Search this channel"><Search size={16} /></IconCircle><Button variant="ghost" size="icon-sm" aria-label="Starred"><Star size={18} /></Button><IconCircle label="Channel details"><MoreHorizontal size={16} /></IconCircle></div></div>
        <div className="mb-4 flex items-center gap-3 rounded-full bg-bronze/15 px-4 py-2 text-sm text-text-primary"><Pin size={14} className="text-bronze" /><span className="truncate">Launch checklist is in the Files tab</span><Chip tone="muted">1 of 2</Chip></div>
        <div className="flex-1 space-y-4">
          {[['Dana Whitfield', 'Roadmap review moved to 16:30, room 2.', false], ['Nate Foster', 'Thanks. I will bring the Q4 copy.', true], ['Ada West', 'Can someone check the billing retries before then?', false]].map(([who, text, mine]) => (
            <div key={text} className={`flex items-end gap-3 ${mine ? 'flex-row-reverse' : ''}`}><Person name={who} /><div className={`max-w-[75%] rounded-[22px] px-5 py-3 text-sm ${mine ? 'rounded-br-md bg-navy text-white' : `rounded-bl-md bg-surface-secondary text-text-primary`}`}>{text}</div></div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-2">{["Reply (2)", "React", "Star", "Pin", "Remind me", "Edit", "Delete"].map(action => <span key={action} className="rounded-full bg-surface-secondary px-4 py-1.5 text-xs font-medium text-text-secondary">{action}</span>)}</div>
        <div className={`mt-4 flex items-center gap-2 rounded-full bg-surface py-2 pl-5 pr-2 ${soft}`}><span className="flex-1 text-sm text-text-muted">Message #general</span><Button variant="ghost" size="icon-sm" aria-label="Attach"><Paperclip size={18} /></Button><Button variant="ghost" size="icon-sm" aria-label="Emoji"><Smile size={18} /></Button><Button size="icon" aria-label="Send"><Send size={18} /></Button></div>
      </Panel>
    </div>
  )
}

export function Chats() {
  return (
    <div className="grid gap-8 @3xl:grid-cols-[300px_1fr]">
      <Panel className="space-y-2 p-4">
        <div className="flex items-center gap-3"><PillSearch placeholder="Find a person" className="h-11 flex-1" /><IconCircle label="New chat"><Plus size={16} /></IconCircle><IconCircle label="New group"><UserPlus size={16} /></IconCircle></div>
        {[['Dana Whitfield', 'See you at 16:30', 2], ['Ada West', 'Pushed the fix', 0], ['Message yourself', 'Reminder: renew domain', 0]].map(([name, last, unread], index) => (
          <div key={name} className={`flex items-center gap-3 rounded-full px-3 py-2.5 ${index === 0 ? 'bg-surface-secondary' : 'hover:bg-surface-secondary'}`}><Person name={name} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-text-primary">{name}</p><p className="truncate text-xs text-text-muted">{last}</p></div>{unread > 0 && <span className="grid size-5 place-items-center rounded-full bg-info text-[10px] font-bold text-white">{unread}</span>}</div>
        ))}
      </Panel>
      <Panel className="flex min-h-[460px] flex-col @3xl:min-h-[680px] p-6">
        <div className="mb-4 flex items-center gap-3"><Person name="Dana Whitfield" /><div><p className="font-semibold text-text-primary">Dana Whitfield</p><p className="text-xs text-success">Available</p></div></div>
        <div className="flex-1 space-y-4"><div className="max-w-[75%] rounded-[22px] rounded-bl-md bg-surface-secondary px-5 py-3 text-sm text-text-primary">Can you send the roadmap deck before the review?</div><div className="ml-auto max-w-[75%] rounded-[22px] rounded-br-md bg-navy px-5 py-3 text-sm text-white">Sending it now.</div></div>
        <div className={`mt-4 flex items-center gap-2 rounded-full bg-surface py-2 pl-5 pr-2 ${soft}`}><span className="flex-1 text-sm text-text-muted">Write a message</span><Button size="icon" aria-label="Send"><Send size={18} /></Button></div>
      </Panel>
    </div>
  )
}

export function FollowUp() {
  const items = [['Confirm vendor contract renewal', 'Dana Whitfield', 'Due tomorrow', 'warning'], ['Send revised budget to finance', 'Nate Foster', 'Overdue', 'danger'], ['Collect feedback on onboarding', 'Ada West', 'Due Friday', 'info']]
  return (
    <>
      <PageHead title="Follow-up" sub="Loose ends that need an owner and a date." actions={<Button><Plus size={18} /> New follow-up</Button>} />
      <FilterRow><PillSearch placeholder="Search follow-ups" className="min-w-[220px] flex-1" /><FilterPill>Open</FilterPill><FilterPill>Owner</FilterPill><FilterPill>Due date</FilterPill></FilterRow>
      <div className="space-y-4">
        {items.map(([note, who, due, tone]) => (
          <div key={note} className={`flex flex-wrap items-center gap-4 rounded-[20px] bg-surface px-5 py-4 ${soft} ${hoverLift}`}><Person name={who} /><div className="min-w-[180px] flex-1"><p className="font-medium text-text-primary">{note}</p><p className="text-sm text-text-muted">Owner: {who}</p></div><Chip tone={tone}>{due}</Chip><Button variant="outline" size="sm" className="border-transparent bg-surface-secondary">Mark done</Button><IconCircle label="Edit follow-up"><Pencil size={15} /></IconCircle><IconCircle label="Delete follow-up"><Trash2 size={15} /></IconCircle></div>
        ))}
      </div>
    </>
  )
}

export function CheckIns() {
  return (
    <div className="space-y-8 @3xl:space-y-12">
      <Hero eyebrow="Daily check-in" title="How is your day going?" text="Share what you finished, what is next and anything blocking you. It takes a minute." actions={<Button variant="gold" size="lg">Start check-in</Button>} aside={<Chip tone="bronze">3 of 5 teammates checked in</Chip>} />
      <Section title="Recent check-ins" action={<div className="flex gap-3"><FilterPill>Last 7 days</FilterPill><FilterPill>Everyone</FilterPill></div>}>
        <div className="space-y-4">
          {[['Ada West', 'Wrote the audit', 'Waiting on legal review'], ['Bella Ortiz', 'Finished the walkthrough', '']].map(([who, done, blocker]) => (
            <Panel key={who} className="p-5 @3xl:p-8"><div className="mb-3 flex items-center gap-3"><Person name={who} /><p className="font-semibold text-text-primary">{who}</p><span className="text-xs text-text-muted">Today</span></div><p className="text-sm text-text-primary"><strong>Done:</strong> {done}</p>{blocker && <p className="mt-2 text-sm text-danger"><strong>Blocked:</strong> {blocker}</p>}</Panel>
          ))}
        </div>
      </Section>
    </div>
  )
}

export function Planner() {
  const cols = [['Backlog', [['Draft launch post', 'Low'], ['Audit billing emails', 'Normal']]], ['In progress', [['Finalise Q4 roadmap copy', 'High'], ['Fix webhook retries', 'High']]], ['Done', [['Book the planning room', 'Done']]]]
  return (
    <>
      <PageHead title="Planner" sub="Drag work between buckets." actions={<><Button variant="outline" className="border-transparent bg-surface shadow-[var(--shadow-soft)]">Views</Button><Button><Plus size={18} /> New bucket</Button></>} />
      <FilterRow><PillSearch placeholder="Search tasks" className="min-w-[220px] flex-1" /><FilterPill>All projects</FilterPill><FilterPill>Workstream</FilterPill><FilterPill>Status</FilterPill><FilterPill>Priority</FilterPill><FilterPill>Assignee</FilterPill><FilterPill>Due date</FilterPill><Button variant="secondary">Select</Button><Button variant="secondary">Archived</Button></FilterRow>
      <div className="grid gap-6 @3xl:grid-cols-3">
        {cols.map(([name, cards]) => (
          <div key={name} className="rounded-[28px] bg-surface-secondary p-3"><div className="mb-3 flex items-center justify-between px-3 pt-1"><h3 className="font-semibold text-text-primary">{name}</h3><span className="grid size-6 place-items-center rounded-full bg-surface text-xs text-text-muted">{cards.length}</span></div>
            <div className="space-y-4">{cards.map(([title, tag]) => <div key={title} className={`rounded-3xl bg-surface p-4 ${soft} ${hoverLift}`}><p className="mb-3 text-sm font-medium text-text-primary">{title}</p><div className="flex items-center justify-between"><Chip tone={tag === 'High' ? 'danger' : tag === 'Done' ? 'success' : 'muted'}>{tag}</Chip><Person name="Nate Foster" /></div></div>)}</div></div>
        ))}
      </div>
    </>
  )
}

export function Projects() {
  const projects = [['Safron Website', 'Refresh the marketing site and onboarding flow.', 'At risk', 'warning', 25, 3, 0, 0], ['Q4 Product Roadmap', 'Finalise direction, milestones and launch narrative.', 'Off track', 'danger', 25, 3, 1, 1]]
  return (
    <>
      <PageHead eyebrow="Portfolio" title="Projects" sub="Ownership, progress, risk and budget across every initiative." actions={<Button><Plus size={18} /> New project</Button>} />
      <div className="mb-8 flex flex-wrap items-center gap-4"><PillSearch placeholder="Search projects" className="min-w-[220px] flex-1" /><FilterPill>All statuses</FilterPill><FilterPill>All health</FilterPill><FilterPill>Due date</FilterPill><Segmented options={['Grid', 'List']} /></div>
      <div className="grid gap-8 @3xl:grid-cols-2">
        {projects.map(([name, note, status, tone, pct, open, blocked, overdue]) => (
          <Panel key={name} className={`p-5 @3xl:p-8 ${hoverLift}`}>
            <div className="flex items-start justify-between gap-4"><h3 className="text-xl font-semibold text-text-primary">{name}</h3><Chip tone={tone}>{status}</Chip></div>
            <p className="mt-2 text-sm text-text-secondary">{note}</p>
            <div className="mt-6"><div className="mb-2 flex justify-between text-sm"><span className="text-text-muted">Progress</span><span className="font-semibold text-text-primary">{pct}%</span></div><Bar value={pct} /></div>
            <div className="mt-5 grid grid-cols-3 gap-3">{[['Open', open], ['Blocked', blocked], ['Overdue', overdue]].map(([label, count]) => <div key={label} className="rounded-2xl bg-surface-secondary px-4 py-3"><p className={`text-lg font-bold ${count && label !== 'Open' ? 'text-danger' : 'text-text-primary'}`}>{count}</p><p className="text-xs text-text-muted">{label}</p></div>)}</div>
            <div className="mt-6 flex items-center justify-between"><span className="text-xs text-text-muted">Updated 10m ago</span><div className="flex items-center gap-3"><IconCircle label="Edit project"><Pencil size={15} /></IconCircle><IconCircle label="More project actions"><MoreHorizontal size={15} /></IconCircle><Button>Open project <ChevronRight size={16} /></Button></div></div>
          </Panel>
        ))}
      </div>
    </>
  )
}

