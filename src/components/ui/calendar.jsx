import * as React from 'react'
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { DayPicker, getDefaultClassNames } from 'react-day-picker'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = 'label',
  buttonVariant = 'ghost',
  formatters,
  components,
  ...props
}) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        'bg-card group/calendar p-3 [--cell-size:--spacing(9)]',
        className
      )}
      captionLayout={captionLayout}
      formatters={{
        formatMonthDropdown: date => date.toLocaleString('default', { month: 'short' }),
        ...formatters,
      }}
      classNames={{
        root: cn('w-fit', defaultClassNames.root),
        months: cn('flex gap-4 flex-col md:flex-row relative', defaultClassNames.months),
        month: cn('flex flex-col w-full gap-3', defaultClassNames.month),
        nav: cn('flex items-center gap-1 w-full absolute top-0 inset-x-0 justify-between', defaultClassNames.nav),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          'size-(--cell-size) aria-disabled:opacity-50 p-0 select-none',
          defaultClassNames.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          'size-(--cell-size) aria-disabled:opacity-50 p-0 select-none',
          defaultClassNames.button_next
        ),
        month_caption: cn(
          'flex items-center justify-center h-(--cell-size) w-full px-(--cell-size) text-sm font-bold text-foreground',
          defaultClassNames.month_caption
        ),
        dropdowns: cn('w-full flex items-center text-sm font-bold justify-center gap-1.5', defaultClassNames.dropdowns),
        weekdays: cn('flex', defaultClassNames.weekdays),
        weekday: cn(
          'text-muted-foreground flex-1 font-semibold text-[0.7rem] uppercase select-none',
          defaultClassNames.weekday
        ),
        week: cn('flex w-full mt-1.5', defaultClassNames.week),
        day: cn(
          'relative w-full h-full p-0 text-center aspect-square select-none group/day',
          '[&:first-child[data-selected=true]_button]:rounded-l-full [&:last-child[data-selected=true]_button]:rounded-r-full',
          defaultClassNames.day
        ),
        range_start: cn('rounded-l-full bg-accent/20', defaultClassNames.range_start),
        range_middle: cn('rounded-none bg-accent/10', defaultClassNames.range_middle),
        range_end: cn('rounded-r-full bg-accent/20', defaultClassNames.range_end),
        today: cn('bg-secondary text-secondary-foreground rounded-full data-[selected=true]:rounded-none', defaultClassNames.today),
        outside: cn('text-muted-foreground opacity-50 aria-selected:text-muted-foreground', defaultClassNames.outside),
        disabled: cn('text-muted-foreground opacity-40', defaultClassNames.disabled),
        hidden: cn('invisible', defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...rootProps }) => (
          <div data-slot="calendar" ref={rootRef} className={cn(className)} {...rootProps} />
        ),
        Chevron: ({ className, orientation, ...chevronProps }) => {
          if (orientation === 'left') return <ChevronLeftIcon className={cn('size-4', className)} {...chevronProps} />
          if (orientation === 'right') return <ChevronRightIcon className={cn('size-4', className)} {...chevronProps} />
          return <ChevronDownIcon className={cn('size-4', className)} {...chevronProps} />
        },
        DayButton: CalendarDayButton,
        ...components,
      }}
      {...props}
    />
  )
}

function CalendarDayButton({ className, day, modifiers, ...props }) {
  const defaultClassNames = getDefaultClassNames()
  const ref = React.useRef(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString()}
      data-selected-single={
        modifiers.selected && !modifiers.range_start && !modifiers.range_end && !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        'data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground data-[selected-single=true]:border-primary',
        'data-[range-middle=true]:bg-accent/15 data-[range-middle=true]:text-foreground data-[range-middle=true]:rounded-none',
        'data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[range-start=true]:rounded-l-full',
        'data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground data-[range-end=true]:rounded-r-full',
        'flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 rounded-full font-semibold leading-none',
        'group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:ring-[3px] group-data-[focused=true]/day:ring-accent/30 group-data-[focused=true]/day:border-accent',
        defaultClassNames.day,
        className
      )}
      {...props}
    />
  )
}

export { Calendar, CalendarDayButton }
