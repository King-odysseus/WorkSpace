# Cross-OS updates

## 2026-09-09 - Windows

- Added a Notification sound setting. Enabled sound now uses the native browser notification path whether WorkSpace is open, backgrounded, or minimized. The header bell shows a red unread count only; the installed-app badge shows the unread count and clears when there are none.
- Key files: `tasks/models.py`, `tasks/migrations/0063_notificationpreference_notification_sound.py`, `tasks/views.py`, `tasks/push.py`, `public/sw.js`, `src/main.jsx`, `src/components/SettingsView.jsx`.
- Other OS action: run `npm run build` and reload the installed app so it receives the updated service worker.
- Done on: Windows.

## 2026-09-07 - Windows

- Added check-in discussion threads, a large check-in detail dialog, and the `comment_check_ins` permission.
- Key files: `tasks/models.py`, `tasks/views.py`, `tasks/migrations/0061_checkincomment.py`, `src/components/RecordDialogs.jsx`, `src/main.jsx`.
- Other OS action: run `python manage.py migrate`, `npm run build`, and `python manage.py test tasks.test_checkin_comments`.
- Done on: Windows.

## 2026-09-07 - Windows

- Added a paginated Notifications history page and limited the header bell to five recent entries.
- Key files: `src/main.jsx`, `tasks/views.py`, `tasks/tests.py`.
- Other OS action: run `npm run build` and `python manage.py test tasks`.
- Done on: Windows.
