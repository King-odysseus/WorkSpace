import * as React from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

// Search field from the C5 gap list: 42px tall, 12px control radius, a leading
// search glyph and a clear action that only exists once there is a value.
//
// Uncontrolled by default so callers can drop it in for local filtering, but
// it forwards `value`/`onChange` straight through, so a controlled caller works
// the same way. Clearing fires onChange with an empty value either way.
function SearchInput({ value, defaultValue, onChange, onClear, className, label = 'Search', ...props }) {
  const [internal, setInternal] = React.useState(defaultValue ?? '')
  const controlled = value !== undefined
  const current = controlled ? value : internal

  const commit = next => {
    if (!controlled) setInternal(next)
    onChange?.({ target: { value: next } })
  }

  const clear = () => {
    commit('')
    onClear?.()
  }

  return (
    <div
      data-slot="search-input"
      className={cn(
        'flex h-[42px] items-center gap-2.5 rounded-control border border-border bg-card px-3 transition-colors focus-within:border-info focus-within:ring-[3px] focus-within:ring-info/25',
        className
      )}
    >
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        type="search"
        value={current}
        aria-label={label}
        onChange={event => commit(event.target.value)}
        className="min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none"
        {...props}
      />
      {current !== '' && current != null && (
        <button
          type="button"
          data-slot="search-input-clear"
          onClick={clear}
          className="grid size-5 shrink-0 place-items-center rounded-badge text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-info/35"
        >
          <X className="size-4" />
          <span className="sr-only">Clear search</span>
        </button>
      )}
    </div>
  )
}

export { SearchInput }
