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

// Hand-off for "open this existing thread" requests, which is what a chat
// notification carries. Distinct from the member hand-off above because the
// notification already names the conversation (its id) or the channel (its
// name), so no conversation has to be created and no member looked up. A
// message id rides along when the alert is about one message, so the thread can
// open on it rather than wherever the reader last was.
let pendingChatThread = null;

export function requestChatThread(targetType, targetId, messageId) {
  if (targetId === undefined || targetId === null || targetId === '') return;
  pendingChatThread = {
    targetType,
    targetId: String(targetId),
    messageId: messageId === undefined || messageId === null || messageId === '' ? '' : String(messageId),
  };
}

export function takePendingChatThread() {
  const thread = pendingChatThread;
  pendingChatThread = null;
  return thread;
}
