# Cross-OS updates

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
