import json
from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import ChatChannel, ChatMessage, DirectConversation, Membership, Reminder, Task, Workspace, WorkspaceNotification


class WorkspaceTestCase(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner@example.com', 'owner@example.com', 'password')
        self.member = User.objects.create_user('member@example.com', 'member@example.com', 'password')
        self.outsider = User.objects.create_user('outsider@example.com', 'outsider@example.com', 'password')
        self.workspace = Workspace.objects.create(name='Test workspace', slug='test-workspace')
        Membership.objects.create(workspace=self.workspace, user=self.owner, role='owner')
        Membership.objects.create(workspace=self.workspace, user=self.member, role='member')
        self.client.force_login(self.owner)

    def post_json(self, name, args, payload):
        return self.client.post(reverse(name, args=args), data=json.dumps(payload), content_type='application/json')

    def post_channel_message(self, text, channel='general'):
        response = self.post_json('chat-message-list', [self.workspace.id], {'channel': channel, 'message': text})
        self.assertEqual(response.status_code, 201)
        return response.json()['message']

    def in_an_hour(self):
        return (timezone.now() + timedelta(hours=1)).isoformat()


class ReminderTests(WorkspaceTestCase):
    def test_a_message_reminder_is_listed_and_can_be_cancelled(self):
        message = self.post_channel_message('Send the invoice')
        created = self.post_json('reminder-list', [self.workspace.id], {'target_type': 'chat_message', 'target_id': message['id'], 'remind_at': self.in_an_hour(), 'note': 'Before lunch'})
        self.assertEqual(created.status_code, 201)
        self.assertIn('Send the invoice', created.json()['reminder']['label'])

        listed = self.client.get(reverse('reminder-list', args=[self.workspace.id]))
        self.assertEqual([item['note'] for item in listed.json()['reminders']], ['Before lunch'])

        removed = self.client.delete(reverse('reminder-detail', args=[self.workspace.id, created.json()['reminder']['id']]))
        self.assertEqual(removed.status_code, 200)
        self.assertEqual(self.client.get(reverse('reminder-list', args=[self.workspace.id])).json()['reminders'], [])

    def test_a_reminder_must_be_in_the_future_and_point_at_something_visible(self):
        message = self.post_channel_message('Hello')
        past = (timezone.now() - timedelta(minutes=5)).isoformat()
        self.assertEqual(self.post_json('reminder-list', [self.workspace.id], {'target_type': 'chat_message', 'target_id': message['id'], 'remind_at': past}).status_code, 400)
        self.assertEqual(self.post_json('reminder-list', [self.workspace.id], {'target_type': 'chat_message', 'target_id': 999999, 'remind_at': self.in_an_hour()}).status_code, 404)
        self.assertEqual(self.post_json('reminder-list', [self.workspace.id], {'target_type': 'nonsense', 'target_id': message['id'], 'remind_at': self.in_an_hour()}).status_code, 404)
        self.assertEqual(self.post_json('reminder-list', [self.workspace.id], {'target_type': 'chat_message', 'target_id': message['id'], 'remind_at': 'soon'}).status_code, 400)

    def test_a_private_channel_message_cannot_be_reminded_by_a_non_member(self):
        ChatChannel.objects.create(workspace=self.workspace, name='secret', is_private=True, created_by=self.owner)
        ChatChannel.objects.get(workspace=self.workspace, name='secret').members.set([self.owner])
        message = self.post_channel_message('Hidden plan', channel='secret')
        self.client.force_login(self.member)
        response = self.post_json('reminder-list', [self.workspace.id], {'target_type': 'chat_message', 'target_id': message['id'], 'remind_at': self.in_an_hour()})
        self.assertEqual(response.status_code, 404)

    def test_a_due_task_reminder_becomes_one_notification_for_its_owner_only(self):
        task = Task.objects.create(workspace=self.workspace, title='Prepare brief', assignee=self.owner)
        created = self.post_json('reminder-list', [self.workspace.id], {'target_type': 'task', 'target_id': task.id, 'remind_at': self.in_an_hour()})
        self.assertEqual(created.status_code, 201)
        Reminder.objects.update(remind_at=timezone.now() - timedelta(minutes=1))

        self.client.force_login(self.member)
        self.client.get(reverse('notification-list', args=[self.workspace.id]))
        self.assertEqual(WorkspaceNotification.objects.filter(kind='reminder').count(), 0)

        self.client.force_login(self.owner)
        self.client.get(reverse('notification-list', args=[self.workspace.id]))
        self.client.get(reverse('notification-list', args=[self.workspace.id]))
        alerts = WorkspaceNotification.objects.filter(kind='reminder')
        self.assertEqual(alerts.count(), 1)
        self.assertEqual(alerts.first().recipient, self.owner)
        self.assertEqual((alerts.first().target_type, alerts.first().target_id), ('task', str(task.id)))
        self.assertIn('Prepare brief', alerts.first().title)
        self.assertEqual(self.client.get(reverse('reminder-list', args=[self.workspace.id])).json()['reminders'], [])

    def test_a_due_message_reminder_opens_the_message(self):
        message = self.post_channel_message('Check the figures')
        self.post_json('reminder-list', [self.workspace.id], {'target_type': 'chat_message', 'target_id': message['id'], 'remind_at': self.in_an_hour()})
        Reminder.objects.update(remind_at=timezone.now() - timedelta(minutes=1))
        self.client.get(reverse('notification-list', args=[self.workspace.id]))
        alert = WorkspaceNotification.objects.get(kind='reminder')
        self.assertEqual((alert.target_type, alert.target_id), ('chat_channel', 'general'))
        self.assertEqual(alert.group_key, f'message:{message["id"]}')

    def test_outsiders_and_other_members_cannot_see_or_remove_a_reminder(self):
        message = self.post_channel_message('Mine')
        created = self.post_json('reminder-list', [self.workspace.id], {'target_type': 'chat_message', 'target_id': message['id'], 'remind_at': self.in_an_hour()}).json()['reminder']
        self.client.force_login(self.member)
        self.assertEqual(self.client.get(reverse('reminder-list', args=[self.workspace.id])).json()['reminders'], [])
        self.assertEqual(self.client.delete(reverse('reminder-detail', args=[self.workspace.id, created['id']])).status_code, 404)
        self.client.force_login(self.outsider)
        self.assertEqual(self.client.get(reverse('reminder-list', args=[self.workspace.id])).status_code, 403)


class SharedSavedViewTests(WorkspaceTestCase):
    def test_a_shared_view_is_listed_for_everyone_but_only_its_owner_can_delete_it(self):
        shared = self.post_json('saved-view-list', [self.workspace.id], {'name': 'Overdue', 'filter': 'overdue', 'shared': True}).json()['saved_view']
        self.post_json('saved-view-list', [self.workspace.id], {'name': 'Mine only', 'filter': 'mine'})
        self.assertTrue(shared['shared'])

        self.client.force_login(self.member)
        names = [view['name'] for view in self.client.get(reverse('saved-view-list', args=[self.workspace.id])).json()['saved_views']]
        self.assertEqual(names, ['Overdue'])
        self.assertEqual(self.client.delete(reverse('saved-view-detail', args=[self.workspace.id, shared['id']])).status_code, 404)

        self.client.force_login(self.owner)
        self.assertEqual(self.client.delete(reverse('saved-view-detail', args=[self.workspace.id, shared['id']])).status_code, 200)

    def test_a_view_is_private_unless_shared_is_true(self):
        created = self.post_json('saved-view-list', [self.workspace.id], {'name': 'Quiet', 'filter': 'all', 'shared': 'yes'}).json()['saved_view']
        self.assertFalse(created['shared'])


class MessageSearchFilterTests(WorkspaceTestCase):
    def test_kind_channel_and_date_filters_narrow_the_results(self):
        self.post_channel_message('launch plan in general')
        self.post_channel_message('launch plan in design', channel='design')
        Task.objects.create(workspace=self.workspace, title='Launch checklist', assignee=self.owner)
        url = reverse('workspace-search', args=[self.workspace.id])

        everything = {item['kind'] for item in self.client.get(url, {'q': 'launch'}).json()['results']}
        self.assertEqual(everything, {'task', 'chat_message'})

        messages = self.client.get(url, {'q': 'launch', 'kind': 'chat_message'}).json()['results']
        self.assertEqual({item['kind'] for item in messages}, {'chat_message'})
        self.assertEqual(len(messages), 2)
        self.assertIn('message_id', messages[0])
        self.assertIn('created_at', messages[0])

        in_design = self.client.get(url, {'q': 'launch', 'kind': 'chat_message', 'channel': 'design'}).json()['results']
        self.assertEqual([item['target_id'] for item in in_design], ['design'])

        self.assertEqual(self.client.get(url, {'q': 'launch', 'since': '2999-01-01'}).json()['results'][0]['kind'], 'task')
        self.assertEqual(self.client.get(url, {'q': 'launch', 'kind': 'chat_message', 'since': '2999-01-01'}).json()['results'], [])
        self.assertEqual(self.client.get(url, {'q': 'launch', 'since': 'tomorrow'}).status_code, 400)

    def test_deleted_messages_and_private_direct_chats_stay_out_of_results(self):
        message = self.post_channel_message('secret budget')
        ChatMessage.objects.filter(id=message['id']).update(deleted_at=timezone.now())
        conversation = DirectConversation.objects.create(workspace=self.workspace, conversation_key=f'{self.owner.id}-{self.owner.id}')
        conversation.participants.add(self.owner)
        conversation.messages.create(author=self.owner, message='budget talk')
        url = reverse('workspace-search', args=[self.workspace.id])
        self.assertEqual([item['snippet'] for item in self.client.get(url, {'q': 'budget'}).json()['results']], ['budget talk'])
        self.client.force_login(self.member)
        self.assertEqual(self.client.get(url, {'q': 'budget'}).json()['results'], [])
