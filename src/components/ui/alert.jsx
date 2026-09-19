import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

// C1 draws info and danger with the same flag-outline glyph and lets the copy
// carry the difference. That reads poorly at a glance, and C1's own rule is
// that a tone is never signalled by colour alone, so the four distinct icons
// stay. Everything else about the alert follows C1: the ramp, the 20px icon,
// and the 14/13 text pair.
const alertIcons = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
}

function Alert({ tone = 'info', title, className, compact = false, action, children, ...props }) {
  const Icon = alertIcons[tone] || alertIcons.info
  const role = props.role || (tone === 'danger' || tone === 'warning' ? 'alert' : 'status')

  return (
    <div
      data-slot="alert"
      data-tone={tone}
      className={cn('workspace-alert', compact && 'is-compact', className)}
      role={role}
      {...props}
    >
      <span className="workspace-alert-icon" aria-hidden="true">
        <Icon size={compact ? 16 : 20} strokeWidth={2} />
      </span>
      <div className="workspace-alert-copy">
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {action && <div className="workspace-alert-action">{action}</div>}
    </div>
  )
}

export { Alert }
