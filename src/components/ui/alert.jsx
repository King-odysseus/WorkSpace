import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

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
        <Icon size={compact ? 14 : 16} strokeWidth={2.2} />
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
