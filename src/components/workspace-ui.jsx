// Shared presentational building blocks: the standard view heading, the themed
// date/select fields the forms use instead of native inputs, the empty-state
// placeholder, and the app's replacement for window.confirm().

import { Button } from './ui/button.jsx'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover.jsx'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './ui/select.jsx'
import { Calendar as DatePicker } from './ui/calendar.jsx'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog.jsx'
import { Brush, CalendarDays, Plus } from 'lucide-react'
import { formatCalendarDate, toDateKey } from '../lib/workspace-format.js'

function WorkspaceViewHeading({ title, subtitle, action, onAction }) {
  return <div className="workspace-view-heading"><div><p className="eyebrow">Workspace operations</p><h1>{title}</h1><p className="subtitle">{subtitle}</p></div>{action && <Button onClick={onAction}><Plus size={17} /> {action}</Button>}</div>
}

function SelectField({ label, name, value, onChange, options }) {
  return <label>{label}<Select value={String(value)} onValueChange={selected => onChange({ target: { name, value: selected } })}>
    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
    <SelectContent>{options.map(([optionValue, optionLabel]) => <SelectItem key={optionValue} value={optionValue}>{optionLabel}</SelectItem>)}</SelectContent>
  </Select></label>
}

function DateTimeField({ label, name, value, onChange, required }) {
  const [datePart, timePart] = value ? value.split('T') : ['', '']
  const dateObj = datePart ? new Date(`${datePart}T00:00:00`) : undefined
  const commit = (nextDate, nextTime) => onChange({ target: { name, value: `${nextDate ?? datePart ?? toDateKey(new Date())}T${nextTime ?? timePart ?? '09:00'}` } })
  return <label>{label}<div className="datetime-field">
    <Popover>
      <PopoverTrigger asChild><Button type="button" variant="outline" className="datetime-trigger w-full justify-start rounded-lg font-medium"><CalendarDays size={14} />{dateObj ? formatCalendarDate(dateObj, { dateStyle: 'medium' }) : 'Select date'}</Button></PopoverTrigger>
      <PopoverContent className="w-auto p-0 z-[80]" align="start" onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}><DatePicker mode="single" selected={dateObj} defaultMonth={dateObj} onSelect={picked => picked && commit(toDateKey(picked), null)} /></PopoverContent>
    </Popover>
    <input className="datetime-time" type="time" value={timePart || ''} onChange={change => commit(null, change.target.value)} required={required} />
  </div></label>
}

// Date-only equivalent of DateTimeField - same Popover + Calendar trigger, used
// wherever the app previously rendered a plain <input type="date"> (which shows
// the browser's own native calendar chrome instead of the app's styling).
function DateField({ label, name, value, onChange, required, disabled, placeholder = 'Select date' }) {
  const dateObj = value ? new Date(`${value}T00:00:00`) : undefined
  const commit = picked => onChange({ target: { name, value: picked } })
  return <label>{label}<Popover>
    <PopoverTrigger asChild><Button type="button" variant="outline" disabled={disabled} className="date-field-trigger w-full justify-start rounded-lg font-medium"><CalendarDays size={14} />{dateObj ? formatCalendarDate(dateObj, { dateStyle: 'medium' }) : placeholder}</Button></PopoverTrigger>
    <PopoverContent className="w-auto p-0 z-[80]" align="start" onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}><DatePicker mode="single" selected={dateObj} defaultMonth={dateObj} onSelect={picked => picked && commit(toDateKey(picked))} /></PopoverContent>
  </Popover>
  {required && <input type="text" className="date-field-required-shadow" value={value || ''} required onChange={() => {}} tabIndex={-1} aria-hidden="true" />}
  </label>
}

function EmptyState({ text }) {
  return <div className="empty-workspace"><div className="empty-workspace-icon" aria-hidden="true"><Brush size={18} /></div><p>{text}</p></div>
}

// Replaces window.confirm() everywhere in the app with a dialog styled like the
// rest of the UI. App owns the single instance; confirmAction() resolves the
// promise once the user picks Cancel or the (destructive, by default) action.
function ConfirmDialog({ state, onClose }) {
  const respond = value => { state?.resolve(value); onClose() }
  return <Dialog open={!!state} onOpenChange={open => { if (!open) respond(false) }}>
    <DialogContent showCloseButton={false} className="confirm-dialog">
      <DialogHeader>
        <DialogTitle>{state?.title || 'Are you sure?'}</DialogTitle>
        <DialogDescription>{state?.message}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => respond(false)}>{state?.cancelLabel || 'Cancel'}</Button>
        <Button type="button" variant="destructive" onClick={() => respond(true)}>{state?.confirmLabel || 'Delete'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

export { WorkspaceViewHeading, SelectField, DateTimeField, DateField, EmptyState, ConfirmDialog }
