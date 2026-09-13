import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

function Select(props) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectValue(props) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

// Preserve the existing controlled form handlers while rendering the app menu.
// Children may be <option>, <optgroup label> of <option>, or fragments of either;
// optgroups become real menu groups so grouped lists keep their heading.
// onCloseAutoFocus is forwarded so callers embedded in a focus-sensitive surface
// (the rich-text toolbar, where the caret must stay in the editor) can stop the
// trigger claiming focus back when the menu closes.
function AppSelect({ children, value, onChange, name, disabled, required, className, onCloseAutoFocus, ...props }) {
  const flatten = nodes => React.Children.toArray(nodes).flatMap(child => {
    if (!React.isValidElement(child)) return []
    if (child.type === React.Fragment) return flatten(child.props.children)
    if (child.type === 'optgroup') return [{ group: child.props.label, options: flatten(child.props.children).flatMap(entry => entry.options || []) }]
    return [{ options: [child] }]
  })
  const entries = flatten(children)
  const options = entries.flatMap(entry => entry.options)
  const emptyLabel = options.find(option => String(option.props.value ?? '') === '')?.props.children
  const item = option => <SelectItem key={option.key ?? String(option.props.value)} value={String(option.props.value ?? '') || '__empty_option__'} disabled={option.props.disabled}>{option.props.children}</SelectItem>
  return <Select name={name} value={String(value ?? '')} disabled={disabled} required={required}
    onValueChange={next => { const target = { name, value: next === '__empty_option__' ? '' : next }; onChange?.({ target, currentTarget: target }) }}>
    <SelectTrigger {...props} className={cn('app-select-trigger', className)}><SelectValue placeholder={emptyLabel || 'Select an option'} /></SelectTrigger>
    <SelectContent onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onCloseAutoFocus={onCloseAutoFocus}>
      {entries.map((entry, index) => entry.group
        ? <SelectPrimitive.Group key={`group-${index}`}><SelectGroupLabel>{entry.group}</SelectGroupLabel>{entry.options.map(item)}</SelectPrimitive.Group>
        : entry.options.map(item))}
    </SelectContent>
  </Select>
}

function SelectTrigger({ className, children, size = 'default', ...props }) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        'border-input bg-card text-foreground data-[placeholder]:text-muted-foreground flex w-fit items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs font-semibold outline-none data-[size=sm]:h-8 data-[size=default]:h-9 focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:opacity-60',
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-3.5" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({ className, children, position = 'popper', ...props }) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        className={cn(
          'bg-popover text-popover-foreground relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] overflow-hidden rounded-xl border border-border shadow-[0_18px_40px_rgb(2_5_31_/20%)]',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          position === 'popper' && 'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
          className
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1.5">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({ className, children, ...props }) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "focus:bg-muted relative flex w-full cursor-pointer items-center gap-2 rounded-lg py-2 pr-8 pl-2.5 text-xs font-semibold outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <span className="absolute right-2.5 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-3.5" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectGroupLabel({ children }) {
  return <SelectPrimitive.Label className="text-muted-foreground px-2.5 py-1.5 text-[10px] font-bold tracking-wide uppercase">{children}</SelectPrimitive.Label>
}

export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem, SelectGroupLabel, AppSelect }
