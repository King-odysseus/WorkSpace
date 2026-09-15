import json

from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase
from django.urls import reverse
from django.utils import timezone
from .models import NotificationPreference, Workspace, Membership, WorkspaceNotification
from .push import normalize_vapid_private_key


class VapidPrivateKeyTests(SimpleTestCase):
    def test_normalizes_a_pem_private_key_for_pywebpush(self):
        pem = '\n'.join((
            '-----BEGIN PRIVATE KEY-----',
            'AQIDBAUGBwg=',
            '-----END PRIVATE KEY-----',
        ))
        self.assertEqual(normalize_vapid_private_key(pem), 'AQIDBAUGBwg=')

    def test_leaves_an_already_normalized_key_untouched(self):
        self.assertEqual(normalize_vapid_private_key(' AQIDBAUGBwg= '), 'AQIDBAUGBwg=')


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
        newest_unread = WorkspaceNotification.objects.create(workspace=second, recipient=user, kind='mention', title='Other workspace')
        NotificationPreference.objects.create(
            workspace=second, user=user,
            notification_sound=False, notification_sound_name='bell', notification_volume=35,
        )
        WorkspaceNotification.objects.create(workspace=workspace, recipient=user, kind='mention', title='Read', read_at=timezone.now())
        WorkspaceNotification.objects.create(workspace=workspace, recipient=other, kind='mention', title='Private')
        WorkspaceNotification.objects.create(workspace=removed, recipient=user, kind='mention', title='No longer a member')
        newest_read = WorkspaceNotification.objects.create(
            workspace=second, recipient=user, kind='mention', title='Already read arrival', read_at=timezone.now(),
        )
        self.client.force_login(user)
        response = self.client.get(reverse('notification-summary'))
        self.assertEqual(response.json(), {
            'unread_count': 26,
            'latest_unread_id': newest_unread.id,
            'latest_notification_id': newest_read.id,
            'sound': False,
            'sound_name': 'bell',
            'volume': 35,
        })
        self.assertIn('no-store', response['Cache-Control'])
        WorkspaceNotification.objects.filter(recipient=user).update(read_at=timezone.now())
        self.assertEqual(self.client.get(reverse('notification-summary')).json(), {
            'unread_count': 0,
            'latest_unread_id': 0,
            'latest_notification_id': newest_read.id,
            'sound': False,
            'sound_name': 'bell',
            'volume': 35,
        })

    def test_stream_requires_login(self):
        self.assertEqual(self.client.get(reverse('notification-stream')).status_code, 401)

    def test_activity_history_excludes_chat_and_only_marks_activity_read(self):
        user = User.objects.create_user(username='activity-user')
        workspace = Workspace.objects.create(name='Activity', slug='activity')
        Membership.objects.create(workspace=workspace, user=user)
        activity = WorkspaceNotification.objects.create(
            workspace=workspace, recipient=user, kind='task_assigned', title='Task', target_type='task', target_id='7',
        )
        channel = WorkspaceNotification.objects.create(
            workspace=workspace, recipient=user, kind='channel_message', title='Channel', target_type='chat_channel', target_id='general',
        )
        chat = WorkspaceNotification.objects.create(
            workspace=workspace, recipient=user, kind='direct_message', title='Chat', target_type='direct_conversation', target_id='9',
        )
        self.client.force_login(user)

        response = self.client.get(reverse('notification-list', args=[workspace.id]) + '?exclude_chat=1')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item['id'] for item in response.json()['notifications']], [activity.id])
        self.assertEqual(response.json()['unread_count'], 1)
        self.assertEqual(response.json()['pagination']['total_items'], 1)

        read_response = self.client.patch(
            reverse('notification-list', args=[workspace.id]),
            data=json.dumps({'read_all': True, 'exclude_chat': True}),
            content_type='application/json',
        )
        self.assertEqual(read_response.status_code, 200)
        activity.refresh_from_db()
        channel.refresh_from_db()
        chat.refresh_from_db()
        self.assertIsNotNone(activity.read_at)
        self.assertIsNone(channel.read_at)
        self.assertIsNone(chat.read_at)

    def test_unread_counts_cover_rows_beyond_the_paged_list(self):
        user = User.objects.create_user(username='counts-user')
        workspace = Workspace.objects.create(name='Counts', slug='counts')
        Membership.objects.create(workspace=workspace, user=user)
        for kind, target_type, count in (
            ('channel_message', 'chat_channel', 22),
            ('direct_message', 'direct_conversation', 3),
            ('task_assigned', 'task', 5),
        ):
            for index in range(count):
                WorkspaceNotification.objects.create(
                    workspace=workspace, recipient=user, kind=kind, title=f'{kind} {index}',
                    target_type=target_type, target_id=str(index),
                )
        self.client.force_login(user)

        payload = self.client.get(reverse('notification-list', args=[workspace.id])).json()
        # The list is one capped page, so most of these never reach the client.
        self.assertEqual(len(payload['notifications']), 20)
        self.assertEqual(payload['pagination']['total_items'], 30)
        # The badge totals do reach every unread row, so channel alerts cannot
        # disappear behind the newest 20.
        self.assertEqual(payload['unread_counts'], {
            'channel': 22, 'direct': 3, 'conversation': 25, 'activity': 5,
        })

        # The totals describe the workspace, not whichever slice was requested.
        filtered = self.client.get(reverse('notification-list', args=[workspace.id]) + '?exclude_chat=1').json()
        self.assertEqual(filtered['unread_counts'], payload['unread_counts'])
        self.assertEqual(len(filtered['notifications']), 5)

        self.client.patch(
            reverse('notification-list', args=[workspace.id]),
            data=json.dumps({'read_all': True, 'exclude_chat': True}),
            content_type='application/json',
        )
        after = self.client.get(reverse('notification-list', args=[workspace.id])).json()['unread_counts']
        self.assertEqual(after, {'channel': 22, 'direct': 3, 'conversation': 25, 'activity': 0})

    def test_each_notification_panel_gets_its_own_unread_rows(self):
        user = User.objects.create_user(username='feed-user')
        workspace = Workspace.objects.create(name='Feeds', slug='feeds')
        Membership.objects.create(workspace=workspace, user=user)
        for index in range(25):
            WorkspaceNotification.objects.create(
                workspace=workspace, recipient=user, kind='task_status', title=f'Read activity {index}',
                target_type='task', target_id=str(index), read_at=timezone.now(),
            )
        activity = WorkspaceNotification.objects.create(
            workspace=workspace, recipient=user, kind='task_assigned', title='Unread activity',
            target_type='task', target_id='latest',
        )
        channel = WorkspaceNotification.objects.create(
            workspace=workspace, recipient=user, kind='channel_message', title='Unread channel',
            target_type='chat_channel', target_id='general',
        )
        self.client.force_login(user)

        activity_payload = self.client.get(reverse('notification-list', args=[workspace.id]) + '?exclude_chat=1').json()
        conversation_payload = self.client.get(reverse('notification-list', args=[workspace.id]) + '?only_conversation=1').json()

        # Unread rows are the page's first rows even when there are more read
        # notifications than fit on it. This is the PostgreSQL case that used
        # to put NULL read_at values last, hiding every unread alert behind old
        # history in both the bell and the Messages panel.
        self.assertEqual(activity_payload['notifications'][0]['id'], activity.id)
        self.assertEqual(conversation_payload['notifications'][0]['id'], channel.id)
        self.assertEqual(activity_payload['unread_counts']['activity'], 1)
        self.assertEqual(conversation_payload['unread_counts']['conversation'], 1)
        self.assertEqual(activity_payload['unread_count'], 1)
        self.assertEqual(conversation_payload['unread_count'], 1)

    def test_stream_emits_new_notification_summary(self):
        user = User.objects.create_user(username='stream-user')
        workspace = Workspace.objects.create(name='Stream', slug='stream')
        Membership.objects.create(workspace=workspace, user=user)
        notification = WorkspaceNotification.objects.create(workspace=workspace, recipient=user, kind='mention', title='New')
        NotificationPreference.objects.create(workspace=workspace, user=user, notification_sound_name='pop', notification_volume=45)
        self.client.force_login(user)
        response = self.client.get(f"{reverse('notification-stream')}?since=0")
        body = b''.join(response.streaming_content).decode()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'text/event-stream')
        self.assertIn(f'id: {notification.id}', body)
        self.assertIn('"unread_count": 1', body)
        self.assertIn('"sound_name": "pop"', body)
        self.assertIn('"volume": 45', body)

    def test_stream_emits_a_notification_read_before_the_next_poll(self):
        user = User.objects.create_user(username='read-stream-user')
        workspace = Workspace.objects.create(name='Read Stream', slug='read-stream')
        Membership.objects.create(workspace=workspace, user=user)
        notification = WorkspaceNotification.objects.create(
            workspace=workspace,
            recipient=user,
            kind='direct_message',
            title='New direct message',
            read_at=timezone.now(),
        )
        self.client.force_login(user)

        response = self.client.get(f"{reverse('notification-stream')}?since=0")
        body = b''.join(response.streaming_content).decode()

        self.assertIn(f'id: {notification.id}', body)
        self.assertIn('"unread_count": 0', body)
        self.assertIn(f'"latest_notification_id": {notification.id}', body)
