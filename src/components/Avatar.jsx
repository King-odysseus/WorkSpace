import { useState } from 'react'
import { UserRound } from 'lucide-react'
import { initialsFor, PRESENCE_LABEL } from '../lib/workspace-format.js'

// Person chip used everywhere a name appears: photo when there is one, initials
// otherwise, with an optional presence dot.
export default function Avatar({ name, avatarUrl, presence, color = 'blue', small = false, className = '' }) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState('')
  const initials = String(name || '').trim() ? initialsFor(name) : ''
  const showImage = Boolean(avatarUrl) && failedAvatarUrl !== avatarUrl

  return <span className={`avatar ${color} ${small ? 'small' : ''} ${className}`.trim()} aria-hidden="true">
    {showImage
      ? <img src={avatarUrl} alt="" onError={() => setFailedAvatarUrl(avatarUrl)} />
      : initials
        ? <span className="avatar-initials">{initials}</span>
        : <UserRound className="avatar-fallback-icon" aria-hidden="true" />}
    {presence && <span className={`presence-dot presence-${presence}`} title={PRESENCE_LABEL[presence] || presence} />}
  </span>
}
