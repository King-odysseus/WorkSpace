import json
from datetime import datetime, time, timedelta, timezone as datetime_timezone
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import Membership, NotificationPreference, Workspace, WorkspaceNotification
from .views import create_notification


class QuietNotificationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='quiet@example.com', password='secure-pass-123')
        self.workspace = Workspace.objects.create(name='Quiet team', slug='quiet-team')
        Membership.objects.create(workspace=self.workspace, user=self.user, role='owner')
        self.client.force_login(self.user)

    def test_overnight_quiet_hours_use_selected_timezone(self):
        preference = NotificationPreference.objects.create(
            workspace=self.workspace, user=self.user,
            quiet_start=time(22), quiet_end=time(8), quiet_timezone='Europe/London',
        )
        self.assertTrue(preference.quiet_now(datetime(2026, 7, 1, 22, 0, tzinfo=datetime_timezone.utc)))
        self.assertFalse(preference.quiet_now(datetime(2026, 7, 1, 8, 0, tzinfo=datetime_timezone.utc)))

    @patch('tasks.views.send_push_to_user')
    @patch('tasks.views.send_reminder_email')
    def test_quiet_hours_keep_unread_alert_but_mute_external_delivery(self, email, push):
        NotificationPreference.objects.create(
            workspace=self.workspace, user=self.user,
            quiet_start=time(0), quiet_end=time(23, 59), quiet_timezone='UTC',
        )
        with patch('tasks.models.timezone.now', return_value=datetime(2026, 1, 1, 12, tzinfo=datetime_timezone.utc)):
            alert = create_notification(self.workspace.id, self.user, 'calendar_reminder', 'Meeting soon', notify_webhooks=False)
        self.assertIsNone(alert.read_at)
        self.assertTrue(WorkspaceNotification.objects.filter(id=alert.id).exists())
        email.assert_not_called()
        push.assert_not_called()

    def test_api_validates_quiet_window_and_snooze(self):
        url = reverse('notification-preference-detail', args=[self.workspace.id])
        invalid = self.client.patch(url, data=json.dumps({'quiet_start': '22:00'}), content_type='application/json')
        self.assertEqual(invalid.status_code, 400)
        response = self.client.patch(url, data=json.dumps({'quiet_start': '22:00', 'quiet_end': '08:00', 'quiet_timezone': 'Europe/London'}), content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['preferences']['quiet_start'], '22:00')
        until = (timezone.now() + timedelta(hours=1)).isoformat()
        response = self.client.patch(url, data=json.dumps({'reminders_snoozed_until': until}), content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(NotificationPreference.objects.get(user=self.user).reminder_snoozed())

    @patch('tasks.views.send_push_to_user')
    @patch('tasks.views.send_reminder_email')
    def test_snooze_mutes_reminders_but_keeps_other_activity(self, email, push):
        NotificationPreference.objects.create(
            workspace=self.workspace, user=self.user,
            reminders_snoozed_until=timezone.now() + timedelta(hours=1),
        )
        reminder = create_notification(self.workspace.id, self.user, 'overdue_reminder', 'Late task', notify_webhooks=False)
        self.assertIsNone(reminder.read_at)
        email.assert_not_called()
        push.assert_not_called()
        create_notification(self.workspace.id, self.user, 'task_status', 'Task changed', notify_webhooks=False)
        push.assert_called_once()
