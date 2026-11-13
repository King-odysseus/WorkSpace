import { useCallback, useEffect, useState } from 'react'
import { workspaceCall } from './workspace-api.js'

// The numbers beside Memos/Requests and Time off in the sidebar: things waiting
// for this person. Memos/Requests counts request memos they have not answered and
// (for people who answer requests) requests waiting for them; Time off counts
// leave waiting for their decision. A plain read every minute, when the window
// regains focus, and whenever a page there changes something.
export const COUNTS_CHANGED = 'workspace:counts-changed'
const REFRESH_MS = 60000

export function announceCountsChanged() {
  window.dispatchEvent(new Event(COUNTS_CHANGED))
}

export default function useNavCounts(workspaceId, userId) {
  const [counts, setCounts] = useState({ memos: 0, timeOff: 0 })
  const load = useCallback(async () => {
    if (!workspaceId) return
    const [memos, requests, leave] = await Promise.all([
      workspaceCall(workspaceId, 'memos/', 'GET').catch(() => null),
      workspaceCall(workspaceId, 'requests/', 'GET').catch(() => null),
      workspaceCall(workspaceId, 'time-off/', 'GET').catch(() => null),
    ])
    const needsAnswer = (memos?.memos || []).filter(memo => memo.kind === 'request' && memo.author_id !== userId && !memo.my_response).length
    const waiting = requests?.can_manage ? (requests.requests || []).filter(item => item.status === 'pending' && item.requester_id !== userId).length : 0
    setCounts({ memos: needsAnswer + waiting, timeOff: leave?.can_approve ? (leave.to_decide || []).length : 0 })
  }, [workspaceId, userId])

  useEffect(() => {
    setCounts({ memos: 0, timeOff: 0 })
    if (!workspaceId) return undefined
    load()
    const timer = setInterval(load, REFRESH_MS)
    window.addEventListener('focus', load)
    window.addEventListener(COUNTS_CHANGED, load)
    window.addEventListener('workspace:memos-changed', load)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', load)
      window.removeEventListener(COUNTS_CHANGED, load)
      window.removeEventListener('workspace:memos-changed', load)
    }
  }, [workspaceId, load])
  return counts
}

// Renders nothing. It sits inside the signed-in app and hands the counts up, so the
// sidebar (built before the app knows it is signed in) can read them from state.
export function NavCountsFeeder({ workspaceId, userId, onChange }) {
  const counts = useNavCounts(workspaceId, userId)
  useEffect(() => { onChange(counts) }, [counts, onChange])
  return null
}
