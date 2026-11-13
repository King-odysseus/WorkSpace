// "Show me this task on its board": a task named in a list elsewhere (the Team page, for
// one) asks the shell to open the board it sits on, narrowed to its project, and flash
// the card so it can be found. The shell owns the task list, so it answers the event.
export const OPEN_TASK_BOARD_EVENT = 'workspace:open-task-board'

export function openTaskBoard(taskId) {
  window.dispatchEvent(new CustomEvent(OPEN_TASK_BOARD_EVENT, { detail: { taskId: Number(taskId) } }))
}

// Called once the board is on screen: scroll the task card into view and mark it for a moment.
export function flashTaskCard(taskId, tries = 12) {
  const card = document.querySelector('[data-task-id="' + taskId + '"]')
  if (!card) {
    if (tries > 0) setTimeout(() => flashTaskCard(taskId, tries - 1), 150)
    return
  }
  card.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' })
  card.classList.add('is-found')
  setTimeout(() => card.classList.remove('is-found'), 3200)
}
