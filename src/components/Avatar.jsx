import { initialsFor, PRESENCE_LABEL } from '../lib/workspace-format.js'

// Person chip used everywhere a name appears: photo when there is one, initials
// otherwise, with an optional presence dot.
export default function Avatar({ name, avatarUrl, presence, color = 'blue', small = false, className = '' }) {
  return <span className={`avatar ${color} ${small ? 'small' : ''} ${className}`}>
    {avatarUrl ? <img src={avatarUrl} alt="" /> : initialsFor(name)}
    {presence && <span className={`presence-dot presence-${presence}`} title={PRESENCE_LABEL[presence] || presence} />}
  </span>
}
