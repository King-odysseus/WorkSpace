# Cross-OS updates

## 2026-09-09 - Windows

- Updated background push handling so minimized or backgrounded browser windows request the native notification sound. The header notification badge is red when unread notifications exist and green when clear.
- Key files: `public/sw.js`, `src/main.jsx`, `src/lib/notification-worker.test.js`.
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
