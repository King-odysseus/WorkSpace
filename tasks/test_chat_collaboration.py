import json

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import DirectConversation, DirectConversationRead, DirectMessage, Membership, Workspace, WorkspaceNotification
from .pulse import workspace_fingerprint


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

    def test_channel_message_can_reply_to_a_reply(self):
        root = self.post_channel_message()
        first_reply = self.client.post(
            reverse('chat-message-list', args=[self.workspace.id]),
            data=json.dumps({'channel': 'general', 'message': 'First reply', 'parent_id': root['id']}),
            content_type='application/json',
        )
        self.assertEqual(first_reply.status_code, 201)

        nested_reply = self.client.post(
            reverse('chat-message-list', args=[self.workspace.id]),
            data=json.dumps({'channel': 'general', 'message': 'Reply to the reply', 'parent_id': first_reply.json()['message']['id']}),
            content_type='application/json',
        )

        self.assertEqual(nested_reply.status_code, 201)
        self.assertEqual(nested_reply.json()['message']['parent_id'], first_reply.json()['message']['id'])

    def test_channel_message_feed_can_be_loaded_for_one_channel(self):
        self.post_channel_message('General note')
        launch = self.client.post(
            reverse('chat-message-list', args=[self.workspace.id]),
            data=json.dumps({'channel': 'product-launch', 'message': 'Launch note'}),
            content_type='application/json',
        )
        self.assertEqual(launch.status_code, 201)

        response = self.client.get(
            reverse('chat-message-list', args=[self.workspace.id]),
            {'channel': 'general'},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual([message['message'] for message in response.json()['messages']], ['General note'])

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

        nested_reply = self.client.post(url, data=json.dumps({'message': 'Replying again', 'parent_id': reply.json()['message']['id']}), content_type='application/json')
        self.assertEqual(nested_reply.status_code, 201)
        self.assertEqual(nested_reply.json()['message']['parent_id'], reply.json()['message']['id'])

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

    def listed_conversation_ids(self, user, archived=False):
        self.client.force_login(user)
        url = reverse('direct-conversation-list', args=[self.workspace.id])
        if archived:
            url = f'{url}?archived=true'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        return {conversation['id'] for conversation in response.json()['conversations']}

    def test_deleting_a_chat_archives_it_for_every_participant(self):
        conversation = self.create_conversation([self.member.id])

        deleted = self.client.delete(reverse('direct-conversation-detail', args=[conversation['id']]))
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json(), {'archived': conversation['id']})
        stored = DirectConversation.objects.get(id=conversation['id'])
        self.assertIsNotNone(stored.archived_at)
        self.assertEqual(stored.archived_by_id, self.owner.id)
        # Archive is shared state, so the other participant loses the chat too.
        self.assertNotIn(conversation['id'], self.listed_conversation_ids(self.owner))
        self.assertNotIn(conversation['id'], self.listed_conversation_ids(self.member))
        self.assertIn(conversation['id'], self.listed_conversation_ids(self.owner, archived=True))
        self.assertIn(conversation['id'], self.listed_conversation_ids(self.member, archived=True))

    def test_conversation_and_its_history_can_be_permanently_deleted(self):
        conversation = self.create_conversation([self.member.id])
        sent = self.client.post(
            reverse('direct-message-list', args=[conversation['id']]),
            data=json.dumps({'message': 'Delete this history'}),
            content_type='application/json',
        )
        self.assertEqual(sent.status_code, 201)
        self.assertTrue(WorkspaceNotification.objects.filter(target_type='direct_conversation', target_id=str(conversation['id'])).exists())

        deleted = self.client.delete(reverse('direct-conversation-delete', args=[conversation['id']]))

        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json(), {'deleted': conversation['id']})
        self.assertFalse(DirectConversation.objects.filter(id=conversation['id']).exists())
        self.assertFalse(DirectMessage.objects.filter(conversation_id=conversation['id']).exists())
        self.assertFalse(WorkspaceNotification.objects.filter(target_type='direct_conversation', target_id=str(conversation['id'])).exists())
        self.assertNotIn(conversation['id'], self.listed_conversation_ids(self.member))

    def test_an_outsider_cannot_permanently_delete_a_conversation(self):
        conversation = self.create_conversation([self.member.id])
        self.client.force_login(self.outsider)

        deleted = self.client.delete(reverse('direct-conversation-delete', args=[conversation['id']]))

        self.assertEqual(deleted.status_code, 404)
        self.assertTrue(DirectConversation.objects.filter(id=conversation['id']).exists())

    def test_an_archived_chat_stays_archived_when_a_message_arrives(self):
        conversation = self.create_conversation([self.member.id])
        self.client.delete(reverse('direct-conversation-detail', args=[conversation['id']]))

        self.client.force_login(self.member)
        sent = self.client.post(
            reverse('direct-message-list', args=[conversation['id']]),
            data=json.dumps({'message': 'Any news on this?'}),
            content_type='application/json',
        )
        self.assertEqual(sent.status_code, 201)

        self.assertIsNotNone(DirectConversation.objects.get(id=conversation['id']).archived_at)
        self.assertNotIn(conversation['id'], self.listed_conversation_ids(self.member))
        self.assertNotIn(conversation['id'], self.listed_conversation_ids(self.owner))

    def test_any_participant_can_restore_an_archived_chat(self):
        conversation = self.create_conversation([self.member.id])
        self.client.delete(reverse('direct-conversation-detail', args=[conversation['id']]))

        self.client.force_login(self.member)
        restored = self.client.post(reverse('direct-conversation-restore', args=[conversation['id']]))
        self.assertEqual(restored.status_code, 200)
        self.assertFalse(restored.json()['conversation']['is_archived'])
        stored = DirectConversation.objects.get(id=conversation['id'])
        self.assertIsNone(stored.archived_at)
        self.assertIsNone(stored.archived_by)
        self.assertIn(conversation['id'], self.listed_conversation_ids(self.owner))
        self.assertIn(conversation['id'], self.listed_conversation_ids(self.member))
        self.assertNotIn(conversation['id'], self.listed_conversation_ids(self.member, archived=True))

    def test_archiving_clears_only_that_chats_unread_notifications(self):
        archived_chat = self.create_conversation([self.member.id])
        other_chat = self.create_conversation([self.third.id])
        self.client.force_login(self.member)
        self.client.post(reverse('direct-message-list', args=[archived_chat['id']]), data=json.dumps({'message': 'Ping'}), content_type='application/json')
        self.client.force_login(self.third)
        self.client.post(reverse('direct-message-list', args=[other_chat['id']]), data=json.dumps({'message': 'Also ping'}), content_type='application/json')

        self.client.force_login(self.owner)
        self.client.delete(reverse('direct-conversation-detail', args=[archived_chat['id']]))
        self.assertFalse(WorkspaceNotification.objects.filter(recipient=self.owner, target_type='direct_conversation', target_id=str(archived_chat['id']), read_at__isnull=True).exists())
        self.assertTrue(WorkspaceNotification.objects.filter(recipient=self.owner, target_type='direct_conversation', target_id=str(other_chat['id']), read_at__isnull=True).exists())

    def test_archiving_moves_the_workspace_pulse(self):
        conversation = self.create_conversation([self.member.id])
        before = workspace_fingerprint(self.workspace.id, self.owner)

        self.client.delete(reverse('direct-conversation-detail', args=[conversation['id']]))
        archived = workspace_fingerprint(self.workspace.id, self.owner)
        self.assertNotEqual(before, archived)

        self.client.post(reverse('direct-conversation-restore', args=[conversation['id']]))
        self.assertNotEqual(archived, workspace_fingerprint(self.workspace.id, self.owner))

    def test_group_participants_can_be_updated_but_the_group_must_keep_two_people(self):
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
            data=json.dumps({'participant_ids': []}),
            content_type='application/json',
        )
        self.assertEqual(too_small.status_code, 400)
        self.assertEqual(
            set(DirectConversation.objects.get(id=conversation['id']).participants.values_list('id', flat=True)),
            {self.owner.id, self.member.id, self.fourth.id},
        )

    def test_a_group_can_be_reduced_to_a_direct_chat(self):
        conversation = self.create_conversation([self.member.id, self.third.id])
        self.client.post(
            reverse('direct-message-list', args=[conversation['id']]),
            data=json.dumps({'message': 'Kicking Priya off this thread'}),
            content_type='application/json',
        )

        reduced = self.client.patch(
            reverse('direct-conversation-detail', args=[conversation['id']]),
            data=json.dumps({'participant_ids': [self.member.id]}),
            content_type='application/json',
        )
        self.assertEqual(reduced.status_code, 200)
        payload = reduced.json()['conversation']
        self.assertFalse(payload['is_group'])
        self.assertEqual({participant['id'] for participant in payload['participants']}, {self.owner.id, self.member.id})
        # Shrinking a group is not a way to lose its history.
        messages = self.client.get(reverse('direct-message-list', args=[conversation['id']])).json()['messages']
        self.assertEqual([message['message'] for message in messages], ['Kicking Priya off this thread'])

    def test_reducing_a_group_onto_an_existing_direct_chat_is_refused(self):
        pair = self.create_conversation([self.member.id])
        group = self.create_conversation([self.member.id, self.third.id])
        original_key = DirectConversation.objects.get(id=group['id']).conversation_key
        self.assertNotEqual(original_key, DirectConversation.objects.get(id=pair['id']).conversation_key)

        response = self.client.patch(
            reverse('direct-conversation-detail', args=[group['id']]),
            data=json.dumps({'participant_ids': [self.member.id]}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 409)
        still_a_group = DirectConversation.objects.get(id=group['id'])
        self.assertEqual(set(still_a_group.participants.values_list('id', flat=True)), {self.owner.id, self.member.id, self.third.id})
        self.assertEqual(still_a_group.conversation_key, original_key)

    def test_removing_a_participant_drops_their_read_state(self):
        conversation = self.create_conversation([self.member.id, self.third.id])
        DirectConversationRead.objects.create(conversation_id=conversation['id'], user=self.third, last_read_at=timezone.now())

        removed = self.client.patch(
            reverse('direct-conversation-detail', args=[conversation['id']]),
            data=json.dumps({'participant_ids': [self.member.id]}),
            content_type='application/json',
        )
        self.assertEqual(removed.status_code, 200)
        self.assertFalse(DirectConversationRead.objects.filter(conversation_id=conversation['id'], user=self.third).exists())

    def test_removing_a_workspace_member_prunes_them_from_group_chat(self):
        conversation = self.create_conversation([self.member.id, self.third.id])
        self.client.post(
            reverse('direct-message-list', args=[conversation['id']]),
            data=json.dumps({'message': 'Keep this history'}),
            content_type='application/json',
        )
        DirectConversationRead.objects.create(conversation_id=conversation['id'], user=self.third, last_read_at=timezone.now())

        removed = self.client.delete(reverse('member-detail', args=[self.workspace.id, self.third.id]))

        self.assertEqual(removed.status_code, 200)
        stored = DirectConversation.objects.get(id=conversation['id'])
        self.assertEqual(set(stored.participants.values_list('id', flat=True)), {self.owner.id, self.member.id})
        self.assertEqual(
            stored.conversation_key,
            ':'.join(str(value) for value in sorted([self.owner.id, self.member.id])),
        )
        self.assertFalse(stored.as_dict(self.owner)['is_group'])
        self.assertNotIn(self.third.email, stored.as_dict(self.owner)['title'])
        self.assertFalse(DirectConversationRead.objects.filter(conversation=stored, user=self.third).exists())
        messages = self.client.get(reverse('direct-message-list', args=[conversation['id']])).json()['messages']
        self.assertEqual([message['message'] for message in messages], ['Keep this history'])

        self.client.force_login(self.third)
        self.assertEqual(self.client.get(reverse('direct-message-list', args=[conversation['id']])).status_code, 404)

    def test_leaving_workspace_prunes_the_member_from_group_chat(self):
        conversation = self.create_conversation([self.member.id, self.third.id])

        self.client.force_login(self.third)
        left = self.client.post(reverse('workspace-leave', args=[self.workspace.id]))

        self.assertEqual(left.status_code, 200)
        stored = DirectConversation.objects.get(id=conversation['id'])
        self.assertEqual(set(stored.participants.values_list('id', flat=True)), {self.owner.id, self.member.id})
        self.assertEqual(
            stored.conversation_key,
            ':'.join(str(value) for value in sorted([self.owner.id, self.member.id])),
        )

    def test_removing_the_last_other_participant_archives_the_chat(self):
        conversation = self.create_conversation([self.member.id])

        removed = self.client.delete(reverse('member-detail', args=[self.workspace.id, self.member.id]))

        self.assertEqual(removed.status_code, 200)
        stored = DirectConversation.objects.get(id=conversation['id'])
        self.assertEqual(set(stored.participants.values_list('id', flat=True)), {self.owner.id})
        self.assertIsNotNone(stored.archived_at)
        self.assertNotIn(conversation['id'], self.listed_conversation_ids(self.owner))
        self.assertIn(conversation['id'], self.listed_conversation_ids(self.owner, archived=True))

    def test_removing_a_member_from_a_group_uses_the_existing_direct_chat_on_key_collision(self):
        pair = self.create_conversation([self.member.id])
        group = self.create_conversation([self.member.id, self.third.id])
        self.client.post(
            reverse('direct-message-list', args=[pair['id']]),
            data=json.dumps({'message': 'Existing direct history'}),
            content_type='application/json',
        )
        self.client.post(
            reverse('direct-message-list', args=[group['id']]),
            data=json.dumps({'message': 'Group history'}),
            content_type='application/json',
        )

        removed = self.client.delete(reverse('member-detail', args=[self.workspace.id, self.third.id]))

        self.assertEqual(removed.status_code, 200)
        stored_pair = DirectConversation.objects.get(id=pair['id'])
        stored_group = DirectConversation.objects.get(id=group['id'])
        self.assertIsNone(stored_pair.archived_at)
        self.assertIsNotNone(stored_group.archived_at)
        self.assertEqual(set(stored_group.participants.values_list('id', flat=True)), {self.owner.id, self.member.id})
        self.assertEqual(
            [message.message for message in stored_pair.messages.order_by('created_at')],
            ['Existing direct history'],
        )
        self.assertEqual(
            [message.message for message in stored_group.messages.order_by('created_at')],
            ['Group history'],
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
        self.assertEqual(
            self.client.post(reverse('direct-conversation-restore', args=[conversation['id']])).status_code,
            404,
        )
