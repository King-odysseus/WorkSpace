import React from 'react'
import { ChevronLeft, ChevronRight, Moon, Share2, Trash2, Bell, Download, FileText, Image as ImageIcon, MonitorUp, Plus, Send, Smartphone, Sparkles, Upload, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CircularProgress } from '@/components/ui/circular-progress'
import { Bar, Chip, FilterPill, FilterRow, Hero, IconCircle, PageHead, Panel, Person, PillSearch, Section, Segmented, Tile, Toggle, hoverLift, soft } from './kit.jsx'

export function Calendar() {
  const events = { 3: ['Stand-up', 'info'], 9: ['Launch review', 'danger'], 12: ['Roadmap review', 'navy'], 17: ['1:1', 'info'], 24: ['Planning', 'success'] }
  const days = Array.from({ length: 30 }, (_, index) => index + 1)
  return (
    <>
      <PageHead eyebrow="Schedule" title="November 2026" actions={<><IconCircle label="Previous month"><ChevronLeft size={16} /></IconCircle><Button variant="secondary">Today</Button><IconCircle label="Next month"><ChevronRight size={16} /></IconCircle><Segmented options={['Month', 'Week', 'Day']} /><Button><Plus size={18} /> New event</Button></>} />
      <Panel className="p-4 @3xl:p-8">
        <div className="mb-2 grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase tracking-wide text-text-muted">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <span key={day}>{day}</span>)}</div>
        <div className="grid grid-cols-7 gap-2">
          {days.map(day => (
            <div key={day} className={`min-h-[64px] rounded-2xl p-2 @3xl:min-h-[88px] ${day === 12 ? 'bg-info-soft' : 'bg-surface-secondary/60'}`}>
              <span className={`grid size-7 place-items-center rounded-full text-sm ${day === 12 ? 'bg-navy font-bold text-white' : 'text-text-primary'}`}>{day}</span>
              {events[day] && <div className="mt-1 hidden @3xl:block"><Chip tone={events[day][1]}>{events[day][0]}</Chip></div>}
              {events[day] && <span className="mt-1 block size-2 rounded-full bg-info @3xl:hidden" />}
            </div>
          ))}
        </div>
      </Panel>
    </>
  )
}

export function Files() {
  const files = [['Launch brief.pdf', 'PDF · 1.2 MB', FileText], ['Roadmap.docx', 'Word · 380 KB', FileText], ['Hero shot.png', 'Image · 2.4 MB', ImageIcon], ['Demo recording.mp4', 'Video · 48 MB', Video]]
  return (
    <>
      <PageHead title="Files" sub="Everything shared in the workspace." actions={<Button><Upload size={18} /> Upload</Button>} />
      <FilterRow><FilterPill active>All files</FilterPill><FilterPill>Documents</FilterPill><FilterPill>Images</FilterPill><FilterPill>Sort: newest</FilterPill><Button variant="secondary">Select</Button></FilterRow>
      <Panel className="mb-6 flex flex-wrap items-center gap-6 p-6"><div className="min-w-[200px] flex-1"><div className="mb-2 flex justify-between text-sm"><span className="text-text-muted">Storage used</span><span className="font-semibold text-text-primary">1.8 of 10 GB</span></div><Bar value={18} tone="bg-bronze" /></div><PillSearch placeholder="Search files" className="min-w-[220px] flex-1" /></Panel>
      <div className="grid grid-cols-2 gap-6 @3xl:grid-cols-4">
        {files.map(([name, meta, Icon]) => (
          <Tile key={name}><span className="mb-4 grid size-14 place-items-center rounded-2xl bg-info-soft text-info"><Icon size={24} /></span><p className="truncate font-medium text-text-primary">{name}</p><p className="text-xs text-text-muted">{meta}</p><div className="mt-4 flex gap-2"><Button variant="secondary" size="sm">Preview</Button><Button variant="ghost" size="icon-sm" aria-label="Download"><Download size={16} /></Button><IconCircle label="Share"><Share2 size={15} /></IconCircle><IconCircle label="Delete"><Trash2 size={15} /></IconCircle></div></Tile>
        ))}
      </div>
    </>
  )
}

export function ImportData() {
  return (
    <>
      <PageHead title="Import data" sub="Bring tasks and projects in from a spreadsheet." />
      <div className="mb-8 flex flex-wrap gap-3">{['Upload', 'Match columns', 'Review', 'Done'].map((step, index) => <span key={step} className={`rounded-full px-5 py-2 text-sm font-medium ${index === 0 ? 'bg-navy text-white' : 'bg-surface text-text-muted ' + soft}`}>{index + 1}. {step}</span>)}</div>
      <Panel className="grid place-items-center gap-4 border-0 bg-gradient-to-br from-surface to-info-soft p-8 @3xl:p-12 text-center"><span className="grid size-16 place-items-center rounded-full bg-surface text-info shadow-[var(--shadow-soft)]"><Upload size={26} /></span><h2 className="text-xl font-semibold text-text-primary">Drop a CSV or Excel file here</h2><p className="max-w-sm text-sm text-text-secondary">We will read the columns and let you match them before anything is imported.</p><Button size="lg">Choose a file</Button></Panel>
    </>
  )
}

export function Reports() {
  const bars = [40, 65, 52, 80, 70, 92, 60]
  return (
    <>
      <PageHead eyebrow="Insights" title="Reports" sub="How the team is tracking this month." actions={<><Segmented options={['Week', 'Month', 'Quarter']} active={1} /><Button variant="secondary"><Download size={16} /> Export</Button></>} />
      <FilterRow><FilterPill>All projects</FilterPill><FilterPill>All teams</FilterPill><FilterPill>Compare to last period</FilterPill></FilterRow>
      <div className="mb-6 @3xl:mb-10 grid grid-cols-2 gap-4 @3xl:grid-cols-4">{[['Completed', '48', '+12%'], ['In progress', '17', ''], ['Overdue', '5', '-2'], ['On-time rate', '91%', '+4%']].map(([label, value, delta]) => <Tile key={label}><p className="text-sm text-text-muted">{label}</p><p className="mt-1 text-3xl font-bold text-text-primary">{value}</p>{delta && <p className="text-xs font-semibold text-success">{delta}</p>}</Tile>)}</div>
      <div className="grid gap-8 @3xl:grid-cols-[1.6fr_1fr]">
        <Panel className="p-5 @3xl:p-8"><h3 className="mb-6 font-semibold text-text-primary">Tasks completed per day</h3><div className="flex h-48 items-end gap-3">{bars.map((height, index) => <div key={index} className="flex flex-1 flex-col items-center gap-2"><div className="w-full rounded-full bg-gradient-to-t from-navy to-info" style={{ height: `${height}%` }} /><span className="text-xs text-text-muted">{['M', 'T', 'W', 'T', 'F', 'S', 'S'][index]}</span></div>)}</div></Panel>
        <Panel className="grid place-items-center p-5 @3xl:p-8"><CircularProgress value={91} size={170} stroke={16} caption="on time" /></Panel>
      </div>
    </>
  )
}

export function Activity() {
  const events = [['Dana Whitfield', 'completed Review onboarding copy', '2m ago'], ['Ada West', 'commented on Fix billing webhook retries', '18m ago'], ['Nate Foster', 'created task Check-in reminder', '1h ago'], ['Bella Ortiz', 'moved Draft launch post to In progress', '3h ago']]
  return (
    <>
      <PageHead title="Activity" sub="A running log of what changed." actions={<Segmented options={['All', 'Tasks', 'People']} />} />
      <FilterRow><FilterPill>Everyone</FilterPill><FilterPill>All event types</FilterPill><FilterPill>Last 7 days</FilterPill></FilterRow>
      <div className="space-y-4">{events.map(([who, what, when]) => <div key={what} className={`flex items-center gap-4 rounded-[20px] bg-surface px-5 py-4 ${soft}`}><Person name={who} /><p className="flex-1 text-sm text-text-primary"><strong>{who}</strong> {what}</p><span className="text-xs text-text-muted">{when}</span></div>)}</div>
    </>
  )
}

export function Notifications() {
  const items = [['Reminder: #design Review the launch deck', 'just now', true], ['Dana mentioned you in #general', '12m ago', true], ['Upcoming event: Roadmap review', '1h ago', false], ['Ada assigned you Audit billing emails', 'Yesterday', false]]
  return (
    <>
      <PageHead title="Notifications" actions={<><Segmented options={['All', 'Unread', 'Mentions']} /><Button variant="secondary"><Moon size={16} /> Snooze reminders</Button><Button variant="secondary">Mark all read</Button></>} />
      <Panel className="p-3">{items.map(([text, when, unread]) => <div key={text} className="flex items-start gap-3 rounded-2xl px-4 py-4 hover:bg-surface-secondary"><span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${unread ? 'bg-info' : 'bg-transparent'}`} /><span className="grid size-10 shrink-0 place-items-center rounded-full bg-info-soft text-info"><Bell size={18} /></span><div className="flex-1"><p className="text-sm text-text-primary">{text}</p><p className="text-xs text-text-muted">{when}</p></div></div>)}</Panel>
    </>
  )
}

export function Settings() {
  const rows = [['Task updates', 'Assignments, status and comments', true], ['Mentions and messages', 'Chats and channels', true], ['Calendar reminders', 'Upcoming events', false], ['Email digests', 'A weekly summary', false]]
  return (
    <>
      <PageHead title="Settings" sub="Profile, notifications and workspace preferences." />
      <div className="grid gap-8 @3xl:grid-cols-[220px_1fr]">
        <Panel className="space-y-1 p-3">{['Profile', 'Notifications', 'Workspace', 'Integrations', 'Security'].map((item, index) => <div key={item} className={`rounded-full px-5 py-2.5 text-sm font-medium ${index === 1 ? 'bg-navy text-white' : 'text-text-primary hover:bg-surface-secondary'}`}>{item}</div>)}</Panel>
        <Panel className="p-5 @3xl:p-8"><h2 className="mb-4 text-lg font-semibold text-text-primary">Notification preferences</h2><div className="divide-y-0 space-y-2">{rows.map(([name, hint, on]) => <div key={name} className="flex items-center justify-between gap-4 rounded-2xl bg-surface-secondary/60 px-5 py-4"><div><p className="text-sm font-medium text-text-primary">{name}</p><p className="text-xs text-text-muted">{hint}</p></div><Toggle on={on} /></div>)}</div><div className="mt-8 flex justify-end gap-3"><Button variant="secondary">Reset</Button><Button>Save changes</Button></div></Panel>
      </div>
    </>
  )
}

export function ScreenSharing() {
  return (
    <>
      <PageHead title="Screen sharing" sub="Show your screen to a teammate, or ask to see theirs." actions={<Button><MonitorUp size={18} /> Share my screen</Button>} />
      <Panel className="mb-6 @3xl:mb-10 grid min-h-[260px] place-items-center bg-gradient-to-br from-navy to-navy-hover text-white"><div className="text-center"><MonitorUp size={40} className="mx-auto mb-3 text-bronze" /><p className="font-semibold">No one is sharing right now</p></div></Panel>
      <div className="flex flex-wrap gap-3">{['Dana Whitfield', 'Ada West'].map(name => <div key={name} className={`flex items-center gap-3 rounded-full bg-surface py-2 pl-2 pr-5 ${soft}`}><Person name={name} /><span className="text-sm font-medium text-text-primary">{name}</span><Button size="sm" variant="secondary">Request</Button></div>)}</div>
    </>
  )
}

export function WhatsNew() {
  return (
    <>
      <PageHead title="What's new" sub="Recent improvements to WorkSpace." />
      <div className="space-y-5">{[['Pinned messages and a Starred list', 'Pin any message to a bar at the top of a channel, and star the ones you want to find again.', 'New'], ['Remind me', 'Get a nudge about any message or task at a time you pick.', 'New'], ['Read Word and PDF files in the app', 'Open documents without leaving WorkSpace.', 'Improved']].map(([title, text, tag]) => <Panel key={title} className={`p-5 @3xl:p-8 ${hoverLift}`}><div className="mb-2 flex items-center gap-3"><h3 className="font-semibold text-text-primary">{title}</h3><Chip tone={tag === 'New' ? 'bronze' : 'info'}>{tag}</Chip></div><p className="text-sm text-text-secondary">{text}</p></Panel>)}</div>
    </>
  )
}

export function InstallApp() {
  return (
    <div className="space-y-8 @3xl:space-y-12">
      <Hero eyebrow="Get the app" title="Install WorkSpace" text="Add it to your home screen or desktop for faster launch and notifications." actions={<Button variant="gold" size="lg"><Download size={18} /> Install</Button>} aside={<span className="grid size-28 place-items-center rounded-[32px] bg-white/10"><Smartphone size={48} /></span>} />
      <div className="grid gap-6 @3xl:grid-cols-3">{[['iPhone', 'Tap Share, then Add to Home Screen.'], ['Android', 'Tap Install app in the browser menu.'], ['Desktop', 'Click the install icon in the address bar.']].map(([name, text]) => <Tile key={name}><h3 className="mb-1 font-semibold text-text-primary">{name}</h3><p className="text-sm text-text-secondary">{text}</p></Tile>)}</div>
    </div>
  )
}

export function Help() {
  return (
    <>
      <PageHead title="Help" sub="Guides and answers." />
      <PillSearch placeholder="Search help articles" className="mb-6 max-w-xl" />
      <div className="grid gap-6 @3xl:grid-cols-2">{[['Getting started', 'Set up your workspace and invite the team.'], ['Tasks and planning', 'Create, assign and track work.'], ['Channels and chats', 'Pins, stars, reminders and search.'], ['Admin and billing', 'Roles, permissions and plans.']].map(([title, text]) => <Tile key={title}><h3 className="mb-1 font-semibold text-text-primary">{title}</h3><p className="text-sm text-text-secondary">{text}</p></Tile>)}</div>
    </>
  )
}

export function Assistant() {
  return (
    <div className="mx-auto flex min-h-[520px] max-w-3xl flex-col">
      <div className="mb-6 text-center"><span className="mx-auto mb-3 grid size-14 place-items-center rounded-full bg-gradient-to-br from-navy to-info text-white shadow-[var(--shadow-lift)]"><Sparkles size={24} /></span><h1 className="text-2xl font-bold text-text-primary">How can I help, Nate?</h1><div className="mt-5 flex justify-center gap-3"><Button variant="secondary" size="sm">New chat</Button><Button variant="secondary" size="sm">History</Button></div></div>
      <div className="mb-6 flex flex-wrap justify-center gap-2">{['Summarise #general', 'What is due this week?', 'Draft a status update'].map(text => <span key={text} className={`rounded-full bg-surface px-4 py-2 text-sm text-text-primary ${soft}`}>{text}</span>)}</div>
      <div className="flex-1 space-y-4"><div className="ml-auto max-w-[75%] rounded-[22px] rounded-br-md bg-navy px-5 py-3 text-sm text-white">What is due this week?</div><div className="max-w-[80%] rounded-[22px] rounded-bl-md bg-surface px-5 py-3 text-sm text-text-primary shadow-[var(--shadow-soft)]">You have four tasks due today, including the Q4 roadmap copy, and one overdue item: the billing webhook retries.</div></div>
      <div className={`mt-4 flex items-center gap-2 rounded-full bg-surface py-2 pl-5 pr-2 ${soft}`}><span className="flex-1 text-sm text-text-muted">Ask anything</span><Button size="icon" aria-label="Send"><Send size={18} /></Button></div>
    </div>
  )
}

