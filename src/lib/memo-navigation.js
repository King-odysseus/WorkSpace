// Hand-off for "open this memo", which a memo notification and the announcement
// banner both carry. The Memos page is lazy about mounting, so the target is kept
// here and the page claims it when it appears. If the page is already on screen
// the event tells it to look again.
let pendingMemoId = null

export const OPEN_MEMO_EVENT = 'workspace:open-memo'

export function requestMemo(memoId) {
  pendingMemoId = memoId == null ? null : Number(memoId)
  window.dispatchEvent(new Event(OPEN_MEMO_EVENT))
}

export function takePendingMemo() {
  const memoId = pendingMemoId
  pendingMemoId = null
  return Number.isFinite(memoId) ? memoId : null
}
