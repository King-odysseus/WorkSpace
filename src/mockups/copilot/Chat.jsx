import React, { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Cloud, Eye, FileText, HardDrive, Image as ImageIcon, Lock, Paperclip, Pencil, Plus, Search, Send, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import Avatar from '../../components/Avatar.jsx'
import { ModelChip, SourceChip } from './parts.jsx'

/*
 * ZuriCopilot chat for one business: thread list, conversation, and the
 * business memory beside it. Shows which model answered, which documents were
 * used, what was sent to the cloud, and holds every outbound action for
 * approval. Fictional content for the mockup.
 */

const threads = [
  { id: 1, title: 'Holiday promotion', when: 'Today', active: true },
  { id: 2, title: 'Wholesale launch date', when: 'Today' },
  { id: 3, title: 'Supplier lead times', when: 'Yesterday' },
  { id: 4, title: 'Website photography', when: 'Thu' },
  { id: 5, title: 'Hiring packing help', when: '14-10-26' },
]

const models = [
  { name: 'Claude Sonnet 5.5', kind: 'cloud', caps: 'Tools, vision, web search, 200K', default: true },
  { name: 'DeepSeek V4 Flash', kind: 'cloud', caps: 'Tools, 128K, fast and cheap' },
  { name: 'llama3.1:8b (Ollama)', kind: 'local', caps: 'Chat only, 8K. Simple tool mode' },
  { name: 'qwen2.5:14b (Ollama)', kind: 'local', caps: 'Tools (basic), 32K' },
]

function ModelPicker() {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState(models[0])
  return (
    <div className="relative">
      <button type="button" aria-expanded={open} aria-label="Choose model for this chat" onClick={() => setOpen(value => !value)} className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-medium text-text-primary hover:bg-surface-hover">
        {picked.kind === 'local' ? <HardDrive size={14} /> : <Cloud size={14} />}
        {picked.name}
        <ChevronDown size={14} className="text-text-muted" />
      </button>
      {open && (
        <div role="listbox" aria-label="Models" className="absolute right-0 top-11 z-20 w-80 rounded-control border border-border bg-surface p-2 shadow-card">
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Models for this chat</p>
          {models.map(model => (
            <button key={model.name} type="button" role="option" aria-selected={picked.name === model.name} onClick={() => { setPicked(model); setOpen(false) }} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-surface-hover">
              <span className="mt-0.5 text-text-muted">{model.kind === 'local' ? <HardDrive size={15} /> : <Cloud size={15} />}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium text-text-primary">{model.name}{model.default && <Badge variant="accent">Default</Badge>}</span>
                <span className="block text-xs text-text-muted">{model.kind === 'local' ? 'Local' : 'Cloud'} - {model.caps}</span>
              </span>
              {picked.name === model.name && <Check size={15} className="mt-1 text-navy" />}
            </button>
          ))}
          <p className="border-t border-border-light px-3 pb-1 pt-3 text-xs text-text-muted">Changing this only affects this chat. Defaults live in Models.</p>
        </div>
      )}
    </div>
  )
}

function UserMessage({ children }) {
  return (
    <div className="flex justify-end gap-3">
      <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-navy px-4 py-3 text-sm leading-relaxed text-white">{children}</div>
      <Avatar name="Nate Foster" small />
    </div>
  )
}

function AssistantMessage({ model, children, footer, streaming = false }) {
  return (
    <div className="flex gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-navy text-white"><Sparkles size={15} /></span>
      <div className="min-w-0 max-w-[88%] space-y-3">
        <div className="rounded-2xl rounded-tl-md border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-text-primary">
          <div className="space-y-3">{children}</div>
          {streaming && <span className="mt-1 inline-block h-4 w-0.5 animate-pulse bg-navy align-middle" aria-label="Writing" />}
        </div>
        <div className="flex flex-wrap items-center gap-2">{model}{footer}</div>
      </div>
    </div>
  )
}

function ConflictFlag() {
  return (
    <div className="rounded-control border border-alert-warning-stroke bg-alert-warning-fill p-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-alert-warning-text"><AlertTriangle size={15} /> This goes against your brand guide</p>
      <p className="mt-1 text-sm leading-relaxed text-text-secondary">A 20% discount is price-led, but your brand guide positions Harbor as premium and says you do not compete on price. Proceed anyway, or adjust?</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline">Proceed anyway</Button>
        <Button size="sm" variant="outline">Show alternatives</Button>
        <SourceChip>Brand guidelines, p.6</SourceChip>
      </div>
    </div>
  )
}

function CloudEgress() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-secondary px-2.5 py-1 text-[11px] text-text-secondary">
      <Eye size={11} /> 3 excerpts sent to the cloud
      <button type="button" className="font-semibold text-info underline-offset-2 hover:underline">Preview</button>
    </span>
  )
}

function FallbackNotice() {
  return (
    <div className="flex items-start gap-3 rounded-control border border-alert-info-stroke bg-alert-info-fill px-3 py-2.5 text-xs leading-relaxed text-alert-info-text">
      <HardDrive size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p>Claude did not respond, so your fallback model answered: <strong>llama3.1:8b (Ollama, local)</strong>. Nothing was sent to the cloud. Answers may be simpler.</p>
    </div>
  )
}

function ProposedTask() {
  return (
    <div className="rounded-control border border-border bg-surface-secondary p-4" role="group" aria-label="Proposed task awaiting approval">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Proposed task</p>
        <Badge variant="outline">Needs your approval</Badge>
      </div>
      <p className="mt-2 text-sm font-semibold text-text-primary">Compare the 20% discount with a gift-set bundle</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-text-muted">Assignee</dt><dd className="flex items-center gap-1.5 text-text-primary"><Avatar name="Priya Nair" small /> Priya Nair</dd>
        <dt className="text-text-muted">Due</dt><dd className="text-text-primary">20-11-26</dd>
        <dt className="text-text-muted">Priority</dt><dd className="text-text-primary">Medium</dd>
        <dt className="text-text-muted">Linked</dt><dd className="text-text-primary">Brand guidelines, Q3 financials</dd>
      </dl>
      <p className="mt-3 text-xs text-text-muted">Assigning a task to someone else always needs your approval.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm"><Check size={14} /> Approve</Button>
        <Button size="sm" variant="outline"><Pencil size={14} /> Edit</Button>
        <Button size="sm" variant="ghost"><X size={14} /> Reject</Button>
      </div>
    </div>
  )
}

function Memory() {
  return (
    <aside aria-label="Business memory" className="hidden w-[300px] shrink-0 space-y-5 overflow-y-auto border-l border-border bg-surface px-5 py-5 @6xl:block">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">Business DNA</h2>
        <dl className="mt-3 space-y-3 text-xs">
          {[['Positioning', 'Premium, small-batch, single-origin.'], ['Voice', 'Warm, direct, never salesy.'], ['Will not do', 'Compete on price. Sell through marketplaces.'], ['Priorities', 'Wholesale launch, cafe partnerships.']].map(([term, text]) => (
            <div key={term}><dt className="font-semibold text-text-muted">{term}</dt><dd className="mt-0.5 leading-relaxed text-text-primary">{text}</dd></div>
          ))}
        </dl>
        <Button size="sm" variant="outline" className="mt-3 w-full">Edit DNA</Button>
      </div>

      <div className="border-t border-border-light pt-5">
        <h2 className="text-sm font-semibold text-text-primary">Used in this chat</h2>
        <ul className="mt-3 space-y-2 text-xs">
          {[['Brand guidelines', 'p.6'], ['Q3 financials', 'p.2'], ['Local research, Nov', 'Section 3']].map(([name, where]) => (
            <li key={name} className="flex items-center gap-2 text-text-primary"><FileText size={13} className="text-text-muted" /><span className="flex-1 truncate">{name}</span><span className="text-text-muted">{where}</span></li>
          ))}
        </ul>
      </div>

      <div className="border-t border-border-light pt-5">
        <h2 className="text-sm font-semibold text-text-primary">Remembered from this chat</h2>
        <ul className="mt-3 space-y-2 text-xs leading-relaxed text-text-primary">
          <li className="rounded-xl bg-surface-secondary px-3 py-2">October sales were soft, about 9% under plan (estimate).</li>
          <li className="rounded-xl bg-surface-secondary px-3 py-2">You want a seasonal offer that still reads as premium.</li>
        </ul>
      </div>

      <div className="border-t border-border-light pt-5 text-xs text-text-muted">
        <p className="flex items-center gap-2"><Lock size={12} /> Stored on this device only. Other businesses cannot see this memory.</p>
      </div>
    </aside>
  )
}

export default function Chat() {
  return (
    <div className="@container flex h-full min-h-0">
      <aside aria-label="Conversations" className="hidden w-[250px] shrink-0 flex-col border-r border-border bg-surface @3xl:flex">
        <div className="space-y-3 p-4">
          <Button className="w-full"><Plus size={16} /> New chat</Button>
          <label className="flex h-10 items-center gap-2 rounded-full border border-border bg-surface px-4 text-text-muted focus-within:ring-[3px] focus-within:ring-info/30">
            <Search size={15} aria-hidden="true" />
            <input type="text" aria-label="Search chats" placeholder="Search chats" style={{ border: 0, boxShadow: 'none', background: 'transparent', outline: 0, padding: 0, height: 'auto' }} className="min-w-0 flex-1 text-sm text-text-primary placeholder:text-text-muted" />
          </label>
        </div>
        <ul className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {threads.map(thread => (
            <li key={thread.id}>
              <button type="button" aria-current={thread.active ? 'true' : undefined} className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-sm ${thread.active ? 'bg-selected font-semibold text-text-primary' : 'text-text-secondary hover:bg-surface-hover'}`}>
                <span className="truncate">{thread.title}</span><span className="shrink-0 text-[11px] text-text-muted">{thread.when}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="border-t border-border-light px-4 py-3 text-[11px] leading-relaxed text-text-muted">Full history is saved here, plus a running summary of decisions so I remember without rereading.</p>
      </aside>

      <section aria-label="Conversation" className="flex min-w-0 flex-1 flex-col bg-surface-secondary">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-6 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-text-primary">Holiday promotion</h2>
            <p className="text-xs text-text-muted">Harbor Coffee Roasters - cloud allowed - 3 documents in use</p>
          </div>
          <ModelPicker />
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6">
          <UserMessage>Should we run a 20% discount for the holidays? Sales were soft in October.</UserMessage>

          <AssistantMessage
            model={<ModelChip name="Claude Sonnet 5.5" kind="cloud" />}
            footer={<><CloudEgress /><SourceChip>Brand guidelines, p.6</SourceChip><SourceChip>Q3 financials, p.2</SourceChip></>}
          >
            <p>October sales were about 9% under plan (an estimate based on your Q3 financials, so please verify). A discount would likely lift volume, but it would cost roughly 6 margin points.</p>
            <ConflictFlag />
            <p>A bundle keeps the premium story and protects margin. I can compare the two for you.</p>
          </AssistantMessage>

          <UserMessage>Okay, what else could work? Add whatever you suggest as a task for Friday, assign to Priya.</UserMessage>

          <AssistantMessage
            model={<ModelChip name="llama3.1:8b" kind="local" note="Fallback model, running on this device" />}
            footer={<SourceChip>Local research, Nov - Section 3</SourceChip>}
          >
            <FallbackNotice />
            <p>Two options fit your brand and the season: a gift-set bundle of three single-origins, or a limited holiday roast with a clear end date. Both avoid a price cut. I have drafted a task to compare them with the discount.</p>
            <ProposedTask />
          </AssistantMessage>

          <AssistantMessage model={<ModelChip name="Claude Sonnet 5.5" kind="cloud" />} streaming>
            <p>One more thing worth checking before Friday: your documents do not say what margin floor you will accept on seasonal offers. What is the lowest margin you are comfortable with</p>
          </AssistantMessage>
        </div>

        <div className="border-t border-border bg-surface px-6 py-4">
          <div className="rounded-control border border-border bg-surface p-3 focus-within:ring-[3px] focus-within:ring-info/30">
            <textarea aria-label="Message ZuriCopilot" rows={2} placeholder="Ask about this business, or say what to do next..." style={{ border: 0, boxShadow: 'none', background: 'transparent', outline: 0, padding: 0, resize: 'none' }} className="w-full text-sm text-text-primary placeholder:text-text-muted" />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Attach a document"><Paperclip size={16} /></Button>
                <Button variant="ghost" size="icon-sm" aria-label="Attach an image"><ImageIcon size={16} /></Button>
                <span className="ml-2 text-xs text-text-muted">Only relevant excerpts go to cloud models.</span>
              </div>
              <Button size="sm"><Send size={14} /> Send</Button>
            </div>
          </div>
        </div>
      </section>

      <Memory />
    </div>
  )
}
