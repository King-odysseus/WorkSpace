import json

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from .models import Membership, Workspace, WorkspaceNotification


class ChatCollaborationTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner@example.com', 'owner@example.com', 'password')
        self.member = User.objects.create_user('member@example.com', 'member@example.com', 'password')
        self.workspace = Workspace.objects.create(name='Test workspace', slug='test-workspace')
        Membership.objects.create(workspace=self.workspace, user=self.owner, role='owner')
        Membership.objects.create(workspace=self.workspace, user=self.member, role='member')
        self.client.force_login(self.owner)

    def post_channel_message(self, text='Hello team'):
        response = self.client.post(
            reverse('chat-message-list', args=[self.workspace.id]),
            data=json.dumps({'channel': 'general', 'message': text}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        return response.json()['message']

    def test_channel_messages_notify_other_members_and_reading_clears_them(self):
        self.post_channel_message()
        notification = WorkspaceNotification.objects.get(recipient=self.member, kind='channel_message')
        self.assertEqual(notification.target_type, 'chat_channel')
        self.client.force_login(self.member)
        response = self.client.patch(
            reverse('notification-list', args=[self.workspace.id]),
            data=json.dumps({'target_type': 'chat_channel', 'target_id': 'general'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        notification.refresh_from_db()
        self.assertIsNotNone(notification.read_at)

    def test_channel_reaction_can_be_added_and_removed(self):
        message = self.post_channel_message()
        url = reverse('chat-message-reaction', args=[message['id']])
        added = self.client.post(url, data=json.dumps({'emoji': 'thumbs_up'}), content_type='application/json')
        self.assertEqual(added.status_code, 200)
        self.assertEqual(added.json()['message']['reactions'], [{'emoji': 'thumbs_up', 'count': 1, 'reacted': True}])
        removed = self.client.delete(url, data=json.dumps({'emoji': 'thumbs_up'}), content_type='application/json')
        self.assertEqual(removed.status_code, 200)
        self.assertEqual(removed.json()['message']['reactions'], [])

    def test_direct_message_can_reply_to_a_conversation_message(self):
        conversation = self.client.post(
            reverse('direct-conversation-list', args=[self.workspace.id]),
            data=json.dumps({'recipient_id': self.member.id}), content_type='application/json',
        ).json()['conversation']
        url = reverse('direct-message-list', args=[conversation['id']])
        parent = self.client.post(url, data=json.dumps({'message': 'Can you review this?'}), content_type='application/json')
        self.assertEqual(parent.status_code, 201)
        reply = self.client.post(url, data=json.dumps({'message': 'Yes, I will.', 'parent_id': parent.json()['message']['id']}), content_type='application/json')
        self.assertEqual(reply.status_code, 201)
        self.assertEqual(reply.json()['message']['parent_id'], parent.json()['message']['id'])
        messages = self.client.get(url).json()['messages']
        self.assertEqual(messages[0]['reply_count'], 1)

    def test_direct_message_reply_rejects_a_parent_from_another_conversation(self):
        first = self.client.post(reverse('direct-conversation-list', args=[self.workspace.id]), data=json.dumps({'recipient_id': self.member.id}), content_type='application/json').json()['conversation']
        parent = self.client.post(reverse('direct-message-list', args=[first['id']]), data=json.dumps({'message': 'Private message'}), content_type='application/json').json()['message']
        third = User.objects.create_user('third@example.com', 'third@example.com', 'password')
        Membership.objects.create(workspace=self.workspace, user=third, role='member')
        second = self.client.post(reverse('direct-conversation-list', args=[self.workspace.id]), data=json.dumps({'recipient_id': third.id}), content_type='application/json').json()['conversation']
        response = self.client.post(reverse('direct-message-list', args=[second['id']]), data=json.dumps({'message': 'Wrong thread', 'parent_id': parent['id']}), content_type='application/json')
        self.assertEqual(response.status_code, 404)

    def test_user_can_save_an_accessible_default_workspace(self):
        response = self.client.patch(
            reverse('auth-me-profile'),
            data=json.dumps({'default_workspace_id': self.workspace.id}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['user']['default_workspace_id'], self.workspace.id)
