const ACTIVITY_KIND_LABELS = {
  task_created: 'Task created',
  task_status: 'Task status',
  task_due_date: 'Task due date',
  task_assigned: 'Task assigned',
  task_comment: 'Task comment',
  task_attachment: 'Task attachment',
  task_archived: 'Task archived',
  task_permanently_deleted: 'Task deleted',
  project_created: 'Project created',
  project_updated: 'Project updated',
  project_deleted: 'Project deleted',
  check_in_created: 'Check-in submitted',
  check_in_comment: 'Check-in comment',
  follow_up_created: 'Follow-up created',
  follow_up_comment: 'Follow-up comment',
  follow_up_status: 'Follow-up status',
  follow_up_assigned: 'Follow-up assigned',
  follow_up_due_date: 'Follow-up due date',
  follow_up_task: 'Follow-up task',
  calendar_created: 'Calendar event created',
  calendar_updated: 'Calendar event updated',
  calendar_deleted: 'Calendar event deleted',
  invitation_sent: 'Member invited',
  invitation_resent: 'Invitation resent',
  invitation_accepted: 'Invitation accepted',
  invitation_declined: 'Invitation declined',
  invitation_cancelled: 'Invitation cancelled',
  member_left: 'Member left',
  chat_message: 'Chat message',
  workspace_archived: 'Workspace archived',
  workspace_restored: 'Workspace restored',
};

function titleCaseKind(kind) {
  return String(kind || 'workspace_activity')
    .replaceAll('_', ' ')
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function activityKindLabel(kind) {
  return ACTIVITY_KIND_LABELS[kind] || titleCaseKind(kind);
}

function activityMessageParts(message, actorName = 'System') {
  const actor = String(actorName || 'System').trim() || 'System';
  const fullMessage = String(message || '').trim();
  const prefix = `${actor} `;
  if (fullMessage.toLowerCase().startsWith(prefix.toLowerCase())) {
    return { actor, detail: fullMessage.slice(prefix.length).trimStart() };
  }
  return { actor, detail: fullMessage };
}

export { activityKindLabel, activityMessageParts };
