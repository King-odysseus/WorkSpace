import React from 'react'
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Clock, DollarSign, FileCheck2, Inbox, Lightbulb, ListChecks, MessageSquare, RefreshCw, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import Avatar from '../../components/Avatar.jsx'
import { FromChip, ModelChip, Notice, Panel, SourceChip, StatTile } from './parts.jsx'

/*
 * ZuriCopilot dashboard: what to do this week, and why, built from the
 * copilot's own memory of conversations, the Business DNA, documents, and the
 * workspace's tasks and capacity. Fictional data for the mockup.
 */

const directions = [
  {
    rank: 1,
    title: 'Lock the wholesale launch date before adding new products',
    why: 'Your vision doc says wholesale is the 12-month growth engine. Three chats this month stalled on the launch date.',
    from: ['Chat, 11-11-26', 'Chat, 13-11-26'],
    sources: ['Vision 2026, p.3', 'Q3 financials, p.2'],
    risk: 'A second product line now would split Sarah, who is already at 118% load.',
    owner: 'Sarah Okafor',
    first: 'Confirm the packaging supplier quote by Wednesday',
  },
  {
    rank: 2,
    title: 'Reply to the two cafe partners who have gone quiet',
    why: 'Both threads passed the 5-day follow-up mark. Partnerships were your stated second priority.',
    from: ['Email, 06-11-26', 'Email, 08-11-26'],
    sources: ['Contacts list'],
    risk: 'Low. Drafts are ready, nothing sends until you approve.',
    owner: 'Marcus Bell',
    first: 'Review and approve the 2 follow-up drafts',
  },
  {
    rank: 3,
    title: 'Pause the 20% holiday discount idea, or reframe it',
    why: 'It conflicts with the premium positioning in your brand guide. A gift-set bundle would fit the brand and the season.',
    from: ['Chat, 12-11-26'],
    sources: ['Brand guidelines, p.6', 'Local research, Nov'],
    risk: 'Margin drops about 6 points under the discount (estimate, verify).',
    owner: 'Priya Nair',
    first: 'Compare the discount and the gift-set bundle side by side',
  },
]

const learned = [
  { text: 'You decided to keep roasting in-house through 2027.', from: 'Chat, Tue', kind: 'Decision' },
  { text: 'You assumed wholesale buyers will pay a premium for single-origin.', from: 'Chat, Wed', kind: 'Assumption' },
  { text: 'Open question: who owns the new website photography?', from: 'Chat, Thu', kind: 'Open question' },
  { text: 'Your supplier lead time rose from 9 to 14 days.', from: 'Email, Thu', kind: 'Fact' },
]

const people = [
  { name: 'Sarah Okafor', load: 118, tasks: 11 },
  { name: 'Marcus Bell', load: 96, tasks: 8 },
  { name: 'Priya Nair', load: 74, tasks: 6 },
  { name: 'Dev Rao', load: 52, tasks: 4 },
]

const days = [
  { day: 'Mon', load: 62 },
  { day: 'Tue', load: 78 },
  { day: 'Wed', load: 91 },
  { day: 'Thu', load: 118 },
  { day: 'Fri', load: 104 },
]

function Direction({ item, onPlan }) {
  return (
    <article className="grid gap-4 rounded-control border border-border bg-surface p-5 @3xl:grid-cols-[auto_1fr_auto] @3xl:items-start">
      <span className="grid size-9 place-items-center rounded-full bg-navy text-sm font-bold text-white">{item.rank}</span>
      <div className="min-w-0 space-y-3">
        <h3 className="text-base font-semibold leading-snug text-text-primary">{item.title}</h3>
        <p className="text-sm leading-relaxed text-text-secondary"><span className="font-semibold text-text-primary">Why it fits: </span>{item.why}</p>
        <p className="text-sm leading-relaxed text-text-secondary"><span className="font-semibold text-text-primary">Risk: </span>{item.risk}</p>
        <div className="flex flex-wrap items-center gap-2">
          {item.from.map(label => <FromChip key={label}>{label}</FromChip>)}
          {item.sources.map(label => <SourceChip key={label}>{label}</SourceChip>)}
        </div>
        <p className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
          <ArrowRight size={14} className="text-text-muted" /> First step: <span className="font-medium text-text-primary">{item.first}</span>
          <span className="text-text-muted">- suggested owner</span>
          <span className="inline-flex items-center gap-1.5 font-medium text-text-primary"><Avatar name={item.owner} small />{item.owner}</span>
        </p>
      </div>
      <div className="flex gap-2 @3xl:flex-col">
        <Button size="sm" onClick={onPlan}>Turn into tasks</Button>
        <Button size="sm" variant="outline">Discuss in chat</Button>
      </div>
    </article>
  )
}

function CapacityRow({ person }) {
  const over = person.load > 100
  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
      <Avatar name={person.name} small />
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate font-medium text-text-primary">{person.name}</span>
          <span className="shrink-0 text-xs text-text-muted">{person.tasks} open tasks</span>
        </div>
        <div className="relative mt-1.5 h-2 rounded-full bg-surface-secondary" role="img" aria-label={`${person.name} is at ${person.load} percent of capacity`}>
          <div className={`h-full rounded-full ${over ? 'bg-warning' : 'bg-navy'}`} style={{ width: `${Math.min(person.load, 125) / 1.25}%` }} />
          <span className="absolute -top-1 bottom-[-4px] w-0.5 bg-text-muted" style={{ left: '80%' }} aria-hidden="true" title="100% of capacity" />
        </div>
      </div>
      <span className={`w-32 whitespace-nowrap text-right text-xs font-semibold ${over ? 'text-warning' : 'text-text-secondary'}`}>{person.load}%{over ? ' - over capacity' : ''}</span>
    </li>
  )
}

function WeekLoad() {
  const max = 130
  return (
    <div>
      <div className="relative flex h-40 items-end gap-4 border-b border-border px-2">
        <span className="absolute inset-x-0 border-t border-dashed border-border-strong" style={{ bottom: `${(100 / max) * 100}%` }} aria-hidden="true" />
        <span className="absolute left-0 -translate-y-full pb-0.5 text-[10px] text-text-muted" style={{ bottom: `${(100 / max) * 100}%` }}>100% capacity</span>
        {days.map(({ day, load }) => (
          <div key={day} className="flex flex-1 flex-col items-center justify-end gap-1" style={{ height: '100%' }} title={`${day}: ${load}% of team capacity`}>
            <span className={`text-xs font-semibold ${load > 100 ? 'text-warning' : 'text-text-secondary'}`}>{load}%</span>
            <div className={`w-full max-w-14 rounded-t-md ${load > 100 ? 'bg-warning' : 'bg-navy'}`} style={{ height: `${(load / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-4 px-2 text-xs text-text-muted">
        {days.map(({ day }) => <span key={day} className="flex-1 text-center">{day}</span>)}
      </div>
      <p className="mt-3 text-xs text-text-secondary">Thursday and Friday are over capacity. Moving the packaging review to Tuesday would clear Thursday.</p>
    </div>
  )
}

export default function Dashboard({ onPlan }) {
  return (
    <div className="@container space-y-6">
      <section className="relative overflow-hidden rounded-control bg-gradient-to-br from-navy to-navy-hover p-6 text-text-on-navy @3xl:p-8">
        <div className="pointer-events-none absolute -right-12 -top-16 size-60 rounded-full bg-bronze/20 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-bronze">Week of 16-11-26</p>
            <h2 className="text-2xl font-bold leading-tight @3xl:text-3xl">This week: protect the wholesale launch, and stop adding scope.</h2>
            <p className="mt-3 text-sm leading-relaxed text-white/75">Built from 14 conversations, 15 documents and 31 open tasks. Your team is over capacity on Thursday and Friday, so the plan below is deliberately small.</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Button variant="gold" size="sm"><RefreshCw size={14} /> Refresh analysis</Button>
            <span className="text-[11px] text-white/60">Updated today, 08:02</span>
            <ModelChip name="Claude Sonnet 5.5" kind="cloud" note="Strategy tasks use your strongest model" />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-4 @3xl:grid-cols-3 @6xl:grid-cols-6">
        <StatTile label="Due this week" value="12" sub="3 are high priority" icon={CalendarClock} />
        <StatTile label="Overdue" value="4" sub="2 more than last week" tone="bad" icon={Clock} />
        <StatTile label="Team load" value="107%" sub="Over capacity Thu-Fri" tone="warn" icon={Users} />
        <StatTile label="Waiting on you" value="5" sub="3 emails, 2 tasks" icon={Inbox} />
        <StatTile label="Decisions to review" value="2" sub="30-day check-ins" icon={FileCheck2} />
        <StatTile label="Model spend" value="$6.40" sub="of $20.00 this month" tone="good" icon={DollarSign} />
      </div>

      <Panel
        title="Recommended direction for this week"
        sub="Ranked. Each one cites where it came from, so you can check it."
        action={<Badge variant="secondary" className="px-3 py-1 text-xs">3 of 3 fit your vision</Badge>}
      >
        <div className="space-y-4">
          {directions.map(item => <Direction key={item.rank} item={item} onPlan={onPlan} />)}
        </div>
        <p className="mt-4 text-xs text-text-muted">Figures marked as estimates need checking. Nothing is created or sent until you approve it.</p>
      </Panel>

      <div className="grid gap-6 @3xl:grid-cols-2">
        <Panel title="What I learned from our conversations" sub="Saved to this business's memory. Edit or delete any of it." action={<Lightbulb size={18} className="text-text-muted" />}>
          <ul className="space-y-3">
            {learned.map(item => (
              <li key={item.text} className="flex items-start gap-3">
                <Badge variant="outline" className="mt-0.5 shrink-0">{item.kind}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text-primary">{item.text}</p>
                  <p className="mt-0.5 text-xs text-text-muted">{item.from}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Flags against your vision" sub="Where an idea or finding pulls away from what your documents say." action={<AlertTriangle size={18} className="text-warning" />}>
          <ul className="space-y-4">
            <li className="rounded-control border border-alert-warning-stroke bg-alert-warning-fill p-4">
              <p className="text-sm font-semibold text-alert-warning-text">20% holiday discount vs premium positioning</p>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">Your brand guide positions you as premium and says you do not compete on price. Proceed anyway, or adjust?</p>
              <div className="mt-3 flex flex-wrap gap-2"><SourceChip>Brand guidelines, p.6</SourceChip><Button size="sm" variant="outline">Review options</Button></div>
            </li>
            <li className="rounded-control border border-border bg-surface p-4">
              <p className="text-sm font-semibold text-text-primary">Not covered by your documents</p>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">Nothing says what wholesale minimum order size you will accept. I will ask rather than guess.</p>
              <Button size="sm" variant="outline" className="mt-3"><MessageSquare size={14} /> Answer in chat</Button>
            </li>
          </ul>
        </Panel>
      </div>

      <div className="grid gap-6 @3xl:grid-cols-[1.1fr_1fr]">
        <Panel title="Team capacity this week" sub="Workload against the hours each person set. Workload and process, not performance.">
          <ul className="space-y-4">{people.map(person => <CapacityRow key={person.name} person={person} />)}</ul>
          <div className="mt-5"><Notice>ZuriCopilot analyses workspace activity (tasks, assignments, capacity) to show workload. It does not score individual performance.</Notice></div>
        </Panel>
        <Panel title="Load by day" sub="Share of team capacity booked">
          <WeekLoad />
        </Panel>
      </div>

      <div className="grid gap-6 @3xl:grid-cols-2">
        <Panel title="Decisions to review" sub="You decided, then expected an outcome. How did it go?" action={<ListChecks size={18} className="text-text-muted" />}>
          <ul className="space-y-3">
            {[['Switch to a 14-day payment term for cafes', 'Expected: fewer late invoices. Decided 15-10-26.'], ['Hire part-time packing help', 'Expected: Thursday load under 100%. Decided 14-10-26.']].map(([title, sub]) => (
              <li key={title} className="flex items-center gap-3 rounded-control border border-border p-3">
                <CheckCircle2 size={18} className="shrink-0 text-text-muted" />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-text-primary">{title}</p><p className="text-xs text-text-muted">{sub}</p></div>
                <Button size="sm" variant="outline">Record outcome</Button>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Waiting for your approval" sub="Nothing leaves the app until you approve." action={<Badge className="px-3 py-1 text-xs">5</Badge>}>
          <ul className="space-y-3">
            {[['Email draft', 'Follow-up to Bluebird Cafe (no reply in 6 days)'], ['Email draft', 'Follow-up to Dockside Cafe (no reply in 8 days)'], ['Task for Sarah', 'Confirm packaging quote by Wednesday']].map(([kind, text]) => (
              <li key={text} className="flex items-center gap-3 rounded-control border border-border p-3">
                <Badge variant="secondary" className="shrink-0">{kind}</Badge>
                <p className="min-w-0 flex-1 truncate text-sm text-text-primary">{text}</p>
                <Button size="sm" variant="outline">Review</Button>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  )
}
