// "Plan my day" lives on Today but the plan lives on My planner. The planner view
// mounts after the click, so the request waits here until it claims it (the same
// hand-off memo-navigation.js and chat-navigation.js use).
let pending = false

export function requestDayPlan() {
  pending = true
}

export function takePendingDayPlan() {
  const was = pending
  pending = false
  return was
}
