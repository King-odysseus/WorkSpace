import * as React from 'react'
import { cn } from '@/lib/utils'
import { initialsFor } from '@/lib/workspace-format.js'

// Stacked avatar row from the C5 gap list: 36px circles, 12px overlap, a 2px
// surface ring so neighbours stay readable where they cross, and a +N chip for
// whoever did not fit.
//
// Later circles paint over earlier ones, which is what makes the ring read as a
// notch cut out of the person underneath rather than a halo around the person
// on top.

const RING = 'ring-2 ring-card'

function AvatarGroupItem({ className, size = 36, style, children, ...props }) {
  return (
    <span
      data-slot="avatar-group-item"
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-muted-foreground',
        RING,
        className
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34), ...style }}
      {...props}
    >
      {children}
    </span>
  )
}

// `people` is the app's usual { name, avatarUrl } shape. `total` overrides the
// count the +N chip reports, for when the caller only fetched a page of them.
function AvatarGroup({ people = [], max = 4, total, size = 36, className, ...props }) {
  const shown = people.slice(0, max)
  const remainder = (total ?? people.length) - shown.length

  return (
    <span data-slot="avatar-group" className={cn('flex items-center', className)} {...props}>
      {shown.map((person, index) => (
        <AvatarGroupItem
          key={person.id ?? person.name ?? index}
          size={size}
          title={person.name}
          className="bg-secondary"
          style={{ marginLeft: index === 0 ? 0 : -12, zIndex: index + 1 }}
        >
          {person.avatarUrl
            ? <img src={person.avatarUrl} alt="" className="size-full object-cover" />
            : initialsFor(person.name)}
        </AvatarGroupItem>
      ))}
      {remainder > 0 && (
        <AvatarGroupItem
          size={size}
          className="bg-secondary text-xs font-medium text-secondary-foreground"
          style={{ marginLeft: shown.length === 0 ? 0 : -12, zIndex: shown.length + 1 }}
        >
          +{remainder}
        </AvatarGroupItem>
      )}
    </span>
  )
}

export { AvatarGroup, AvatarGroupItem }
