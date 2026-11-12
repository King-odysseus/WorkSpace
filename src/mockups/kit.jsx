import React from 'react'
import { Check, ChevronDown, MoreHorizontal, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import Avatar from '../components/Avatar.jsx'

/*
 * Building blocks for the soft-surface proposal. Everything is real Tailwind
 * tokens (navy, bronze, surface, text-*) plus the two proposed shadows set on
 * the mockup root (--shadow-soft, --shadow-lift). Nothing here draws a hairline:
 * depth and tint do the separating.
 */
export const soft = 'shadow-[var(--shadow-soft)]'
export const lift = 'shadow-[var(--shadow-lift)]'
export const hoverLift = 'transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]'

export function Panel({ className = '', children, ...props }) {
  return <div className={`rounded-[28px] bg-surface ${soft} ${className}`} {...props}>{children}</div>
}

export function Tile({ className = '', children }) {
  return <div className={`rounded-3xl bg-surface p-5 ${soft} @3xl:p-7 ${hoverLift} ${className}`}>{children}</div>
}

export function Section({ title, action, children, className = '' }) {
  return (
    <section className={className}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1 @3xl:mb-6">
        <h2 className="whitespace-nowrap text-lg font-semibold text-text-primary">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function PageHead({ eyebrow, title, sub, actions }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4 @3xl:mb-12 @3xl:gap-6">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">{eyebrow}</p>}
        <h1 className="text-2xl font-bold leading-tight text-text-primary @3xl:text-3xl">{title}</h1>
        {sub && <p className="mt-2 max-w-xl text-sm leading-relaxed text-text-secondary">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  )
}

// One surface, no nested border: the wrapper carries the fill and shadow, and
// the input is stripped of the app's global field border (set inline, because
// the global field rule is unlayered and would otherwise win over a class).
export function PillSearch({ placeholder = 'Search', className = '' }) {
  return (
    <label className={`flex h-12 min-w-0 items-center gap-3 rounded-full bg-surface px-5 ${soft} focus-within:ring-[3px] focus-within:ring-info/30 ${className}`}>
      <Search size={18} className="shrink-0 text-text-muted" aria-hidden="true" />
      <input
        type="text"
        aria-label={placeholder}
        placeholder={placeholder}
        style={{ border: 0, boxShadow: 'none', background: 'transparent', outline: 0, padding: 0, height: 'auto' }}
        className="min-w-0 flex-1 text-sm text-text-primary placeholder:text-text-muted"
      />
    </label>
  )
}

export function Segmented({ options, active = 0 }) {
  return (
    <div className={`inline-flex rounded-full bg-surface-secondary p-1`}>
      {options.map((option, index) => (
        <span key={option} className={`rounded-full px-4 py-1.5 text-sm font-medium ${index === active ? `bg-surface text-text-primary ${soft}` : 'text-text-muted'}`}>{option}</span>
      ))}
    </div>
  )
}

export function Chip({ tone = 'info', children }) {
  const tones = {
    info: 'bg-info-soft text-info', danger: 'bg-danger-soft text-danger', success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning', muted: 'bg-surface-secondary text-text-secondary', navy: 'bg-navy text-white', bronze: 'bg-bronze/20 text-navy',
  }
  return <Badge className={`${tones[tone]} border-transparent px-3 py-1 text-xs font-semibold`}>{children}</Badge>
}

export function Person({ name, small = true }) {
  return <Avatar name={name} small={small} />
}

export function Check_({ done }) {
  return <span className={`grid size-7 shrink-0 place-items-center rounded-full ${done ? 'bg-navy text-white' : 'bg-surface-secondary text-transparent'}`}><Check size={14} /></span>
}

export function TaskRow({ title, meta, tag, tone = 'info', done = false, who, status }) {
  return (
    <div className={`flex items-center gap-4 rounded-[20px] bg-surface px-4 py-4 ${soft} @3xl:px-6 @3xl:py-6 ${hoverLift}`}>
      <Check_ done={done} />
      <div className="min-w-0 flex-1">
        <p className={`truncate font-medium ${done ? 'text-text-muted line-through' : 'text-text-primary'}`}>{title}</p>
        {meta && <p className="truncate text-sm text-text-muted">{meta}</p>}
      </div>
      {who && <Person name={who} />}
      {tag && <Chip tone={tone}>{tag}</Chip>}
      {status && <span className="hidden items-center gap-1.5 rounded-full bg-surface-secondary px-4 py-2 text-xs font-medium text-text-primary @3xl:inline-flex">{status}<ChevronDown size={13} className="opacity-60" /></span>}
      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${title}`}><MoreHorizontal size={18} /></Button>
    </div>
  )
}

export function Hero({ eyebrow, title, text, actions, aside }) {
  return (
    <div className={`relative overflow-hidden rounded-[32px] bg-gradient-to-br from-navy to-navy-hover p-6 text-text-on-navy ${lift} @xl:p-9 @3xl:p-14`}>
      <div className="pointer-events-none absolute -right-16 -top-20 size-72 rounded-full bg-bronze/20 blur-3xl" aria-hidden="true" />
      <div className="relative flex flex-wrap items-center justify-between gap-6 @xl:gap-8">
        <div className="max-w-xl">
          {eyebrow && <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-bronze">{eyebrow}</p>}
          <h1 className="text-2xl font-bold leading-tight @xl:text-3xl @3xl:text-4xl">{title}</h1>
          {text && <p className="mt-3 text-sm leading-relaxed text-white/75 @xl:mt-5 @xl:text-base">{text}</p>}
          {actions && <div className="mt-6 flex flex-wrap gap-3 @xl:mt-10 @xl:gap-4">{actions}</div>}
        </div>
        {aside}
      </div>
    </div>
  )
}

export function Bar({ value, tone = 'bg-navy' }) {
  return <div className="h-2.5 overflow-hidden rounded-full bg-surface-secondary"><div className={`h-full rounded-full ${tone}`} style={{ width: `${value}%` }} /></div>
}

export function Toggle({ on = false }) {
  return <span className={`relative inline-block h-7 w-12 shrink-0 rounded-full ${on ? 'bg-navy' : 'bg-surface-secondary'}`}><span className={`absolute top-1 size-5 rounded-full bg-white ${soft} ${on ? 'left-6' : 'left-1'}`} /></span>
}

// A pill-shaped dropdown trigger, the stand-in for the app's filter selects.
export function FilterPill({ children, active = false }) {
  return <span className={`inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-medium ${active ? 'bg-navy text-white' : `bg-surface text-text-primary ${soft}`}`}>{children}<ChevronDown size={15} className="opacity-60" /></span>
}

export function FilterRow({ children }) {
  return <div className="mb-10 flex flex-wrap items-center gap-4">{children}</div>
}

export function IconCircle({ label, children }) {
  return <Button variant="secondary" size="icon-sm" aria-label={label} className="shadow-[var(--shadow-soft)]">{children}</Button>
}
