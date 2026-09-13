import json

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from .models import DirectConversation, DirectConversationDismissal, Membership, Workspace, WorkspaceNotification


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


class DirectConversationManagementTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('manage-owner@example.com', 'manage-owner@example.com', 'password')
        self.member = User.objects.create_user('manage-member@example.com', 'manage-member@example.com', 'password')
        self.third = User.objects.create_user('manage-third@example.com', 'manage-third@example.com', 'password')
        self.fourth = User.objects.create_user('manage-fourth@example.com', 'manage-fourth@example.com', 'password')
        self.outsider = User.objects.create_user('manage-outsider@example.com', 'manage-outsider@example.com', 'password')
        self.workspace = Workspace.objects.create(name='Manage workspace', slug='manage-workspace')
        for user in (self.owner, self.member, self.third, self.fourth):
            Membership.objects.create(workspace=self.workspace, user=user, role='member' if user != self.owner else 'owner')
        self.client.force_login(self.owner)

    def create_conversation(self, participant_ids):
        response = self.client.post(
            reverse('direct-conversation-list', args=[self.workspace.id]),
            data=json.dumps({'participant_ids': participant_ids}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        return response.json()['conversation']

    def listed_conversation_ids(self, user):
        self.client.force_login(user)
        response = self.client.get(reverse('direct-conversation-list', args=[self.workspace.id]))
        self.assertEqual(response.status_code, 200)
        return {conversation['id'] for conversation in response.json()['conversations']}

    def test_delete_hides_a_chat_per_user_and_a_new_message_restores_it(self):
        conversation = self.create_conversation([self.member.id])

        deleted = self.client.delete(reverse('direct-conversation-detail', args=[conversation['id']]))
        self.assertEqual(deleted.status_code, 200)
        self.assertTrue(DirectConversationDismissal.objects.filter(conversation_id=conversation['id'], user=self.owner).exists())
        self.assertNotIn(conversation['id'], self.listed_conversation_ids(self.owner))
        self.assertIn(conversation['id'], self.listed_conversation_ids(self.member))

        self.client.force_login(self.member)
        sent = self.client.post(
            reverse('direct-message-list', args=[conversation['id']]),
            data=json.dumps({'message': 'Bringing this chat back'}),
            content_type='application/json',
        )
        self.assertEqual(sent.status_code, 201)
        self.assertFalse(DirectConversationDismissal.objects.filter(conversation_id=conversation['id']).exists())
        self.assertIn(conversation['id'], self.listed_conversation_ids(self.owner))

    def test_group_participants_can_be_updated_but_the_group_must_keep_three_people(self):
        conversation = self.create_conversation([self.member.id, self.third.id])

        updated = self.client.patch(
            reverse('direct-conversation-detail', args=[conversation['id']]),
            data=json.dumps({'participant_ids': [self.member.id, self.fourth.id]}),
            content_type='application/json',
        )
        self.assertEqual(updated.status_code, 200)
        participant_ids = {participant['id'] for participant in updated.json()['conversation']['participants']}
        self.assertEqual(participant_ids, {self.owner.id, self.member.id, self.fourth.id})

        too_small = self.client.patch(
            reverse('direct-conversation-detail', args=[conversation['id']]),
            data=json.dumps({'participant_ids': [self.member.id]}),
            content_type='application/json',
        )
        self.assertEqual(too_small.status_code, 400)
        self.assertEqual(
            set(DirectConversation.objects.get(id=conversation['id']).participants.values_list('id', flat=True)),
            {self.owner.id, self.member.id, self.fourth.id},
        )

    def test_direct_chats_cannot_be_converted_to_groups(self):
        conversation = self.create_conversation([self.member.id])
        response = self.client.patch(
            reverse('direct-conversation-detail', args=[conversation['id']]),
            data=json.dumps({'participant_ids': [self.member.id, self.fourth.id]}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            set(DirectConversation.objects.get(id=conversation['id']).participants.values_list('id', flat=True)),
            {self.owner.id, self.member.id},
        )

    def test_group_edits_reject_non_members_and_duplicate_groups(self):
        first = self.create_conversation([self.member.id, self.third.id])
        self.create_conversation([self.member.id, self.fourth.id])

        outsider = self.client.patch(
            reverse('direct-conversation-detail', args=[first['id']]),
            data=json.dumps({'participant_ids': [self.member.id, self.outsider.id]}),
            content_type='application/json',
        )
        self.assertEqual(outsider.status_code, 400)

        duplicate = self.client.patch(
            reverse('direct-conversation-detail', args=[first['id']]),
            data=json.dumps({'participant_ids': [self.member.id, self.fourth.id]}),
            content_type='application/json',
        )
        self.assertEqual(duplicate.status_code, 409)

    def test_non_participants_cannot_manage_a_conversation(self):
        conversation = self.create_conversation([self.member.id])
        Membership.objects.create(workspace=self.workspace, user=self.outsider, role='member')
        self.client.force_login(self.outsider)

        self.assertEqual(
            self.client.delete(reverse('direct-conversation-detail', args=[conversation['id']])).status_code,
            404,
        )
        self.assertEqual(
            self.client.patch(
                reverse('direct-conversation-detail', args=[conversation['id']]),
                data=json.dumps({'participant_ids': [self.member.id, self.third.id]}),
                content_type='application/json',
            ).status_code,
            404,
        )
