REMINDER_EMAIL_KINDS = frozenset({'calendar_reminder', 'due_soon_reminder', 'overdue_reminder', 'stale_update_reminder'})
REMINDER_KINDS = REMINDER_EMAIL_KINDS | {'check_in_reminder', 'blocked_alert'}
