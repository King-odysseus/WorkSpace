from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from .models import Workspace, Membership, WorkspaceNotification


class NotificationSummaryTests(TestCase):
    def test_requires_login(self):
        self.assertEqual(self.client.get(reverse('notification-summary')).status_code, 401)

    def test_counts_all_unread_only_for_current_member_across_workspaces(self):
        user = User.objects.create_user(username='badge-user')
        other = User.objects.create_user(username='badge-other')
        workspace = Workspace.objects.create(name='One', slug='badge-one')
        second = Workspace.objects.create(name='Two', slug='badge-two')
        removed = Workspace.objects.create(name='Left', slug='badge-left')
        for space in (workspace, second):
            Membership.objects.create(workspace=space, user=user)
        for _ in range(25):
            WorkspaceNotification.objects.create(workspace=workspace, recipient=user, kind='mention', title='Unread')
        newest = WorkspaceNotification.objects.create(workspace=second, recipient=user, kind='mention', title='Other workspace')
        WorkspaceNotification.objects.create(workspace=workspace, recipient=user, kind='mention', title='Read', read_at=timezone.now())
        WorkspaceNotification.objects.create(workspace=workspace, recipient=other, kind='mention', title='Private')
        WorkspaceNotification.objects.create(workspace=removed, recipient=user, kind='mention', title='No longer a member')
        self.client.force_login(user)
        response = self.client.get(reverse('notification-summary'))
        self.assertEqual(response.json(), {'unread_count': 26, 'latest_unread_id': newest.id})
        self.assertIn('no-store', response['Cache-Control'])
        WorkspaceNotification.objects.filter(recipient=user).update(read_at=timezone.now())
        self.assertEqual(self.client.get(reverse('notification-summary')).json(), {'unread_count': 0, 'latest_unread_id': 0})
