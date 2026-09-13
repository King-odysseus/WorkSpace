import { cn } from '@/lib/utils'

function Skeleton({ className, variant = 'line', ...props }) {
  return (
    <span
      data-slot="skeleton"
      data-variant={variant}
      aria-hidden="true"
      className={cn('workspace-skeleton', `workspace-skeleton-${variant}`, className)}
      {...props}
    />
  )
}

function SkeletonGroup({ className, label = 'Loading content', children, ...props }) {
  return (
    <div
      data-slot="skeleton-group"
      className={cn('workspace-skeleton-group', className)}
      role="status"
      aria-label={label}
      aria-live="polite"
      {...props}
    >
      {children}
      <span className="sr-only">{label}</span>
    </div>
  )
}

export { Skeleton, SkeletonGroup }
