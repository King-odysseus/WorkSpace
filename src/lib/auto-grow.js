// A text box that grows with what is typed, up to a limit, then scrolls. One
// helper so the Zuri composer, chat composers and the form text areas behave the
// same way. The height is reset first so deleting lines shrinks the box again.
export const AUTO_GROW_MAX = 220

export function fitTextarea(element, max = AUTO_GROW_MAX) {
  if (!element) return
  element.style.height = 'auto'
  const wanted = element.scrollHeight
  if (!wanted) return
  element.style.height = `${Math.min(wanted, max)}px`
  element.style.overflowY = wanted > max ? 'auto' : 'hidden'
}

const GROWING = [
  '.ai-chat-input', '.chat-compose-input textarea', '.checkin-detail-composer textarea',
  '.memo-form textarea', '.request-form textarea', '.memo-response textarea',
  '.day-plan-edit-form textarea', '.personal-task-notes', '.composer-modal textarea',
].join(',')

// Typing in any of those areas resizes it, whichever component owns it.
export function installAutoGrow(root = document) {
  const handle = event => {
    const target = event.target
    if (target instanceof HTMLTextAreaElement && target.matches(GROWING)) fitTextarea(target)
  }
  root.addEventListener('input', handle)
  root.addEventListener('focusin', handle)
  return () => {
    root.removeEventListener('input', handle)
    root.removeEventListener('focusin', handle)
  }
}
