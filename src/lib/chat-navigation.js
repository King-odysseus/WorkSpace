// Hand-off for "open a direct conversation with this member" requests coming
// from another view.
//
// The Chats view is lazy-loaded, so it mounts after the navigation commits. The
// Today dashboard and the Team board used to fire a `chat:direct` window event
// on setTimeout(0) and hope the listener existed by then; on a first visit the
// chunk is still being fetched, the event landed on nothing, and the message
// silently failed to open. Callers now stash the target here and the Chats view
// claims it on mount.
let pendingDirectMemberId = null;

export function requestDirectMessage(memberId) {
  pendingDirectMemberId = memberId;
}

export function takePendingDirectMessage() {
  const memberId = pendingDirectMemberId;
  pendingDirectMemberId = null;
  return memberId;
}
