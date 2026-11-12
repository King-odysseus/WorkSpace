import json

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from .models import ChatChannel, DirectConversation, Membership, Workspace


class MessagePinStarTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner@example.com', 'owner@example.com', 'password')
        self.member = User.objects.create_user('member@example.com', 'member@example.com', 'password')
        self.outsider = User.objects.create_user('outsider@example.com', 'outsider@example.com', 'password')
        self.workspace = Workspace.objects.create(name='Test workspace', slug='test-workspace')
        Membership.objects.create(workspace=self.workspace, user=self.owner, role='owner')
        Membership.objects.create(workspace=self.workspace, user=self.member, role='member')
        self.client.force_login(self.owner)

    def post_channel_message(self, text='Hello team', channel='general'):
        response = self.client.post(
            reverse('chat-message-list', args=[self.workspace.id]),
            data=json.dumps({'channel': channel, 'message': text}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        return response.json()['message']

    def direct_conversation(self):
        conversation = DirectConversation.objects.create(workspace=self.workspace, conversation_key=f'{self.owner.id}-{self.member.id}')
        conversation.participants.add(self.owner, self.member)
        return conversation

    def post_direct_message(self, conversation, text='Private hello'):
        response = self.client.post(
            reverse('direct-message-list', args=[conversation.id]),
            data=json.dumps({'message': text}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        return response.json()['message']

    def test_a_channel_holds_several_pins_and_any_member_can_pin_and_unpin(self):
        first = self.post_channel_message('First')
        second = self.post_channel_message('Second')
        self.client.force_login(self.member)
        for message in (first, second):
            pinned = self.client.post(reverse('chat-message-pin', args=[message['id']]))
            self.assertEqual(pinned.status_code, 200)
            self.assertIsNotNone(pinned.json()['message']['pinned_at'])
            self.assertEqual(pinned.json()['message']['pinned_by_id'], self.member.id)

        self.client.force_login(self.owner)
        listed = self.client.get(reverse('chat-pinned-messages', args=[self.workspace.id]), {'channel': 'general'})
        self.assertEqual([item['message'] for item in listed.json()['messages']], ['Second', 'First'])

        unpinned = self.client.delete(reverse('chat-message-pin', args=[first['id']]))
        self.assertEqual(unpinned.status_code, 200)
        self.assertIsNone(unpinned.json()['message']['pinned_at'])
        listed = self.client.get(reverse('chat-pinned-messages', args=[self.workspace.id]), {'channel': 'general'})
        self.assertEqual([item['message'] for item in listed.json()['messages']], ['Second'])

    def test_pinning_twice_keeps_the_original_pin(self):
        message = self.post_channel_message()
        url = reverse('chat-message-pin', args=[message['id']])
        first = self.client.post(url).json()['message']
        again = self.client.post(url).json()['message']
        self.assertEqual(first['pinned_at'], again['pinned_at'])

    def test_pins_are_scoped_to_their_own_channel(self):
        general = self.post_channel_message('In general')
        ChatChannel.objects.create(workspace=self.workspace, name='design', created_by=self.owner)
        design = self.post_channel_message('In design', channel='design')
        self.client.post(reverse('chat-message-pin', args=[general['id']]))
        self.client.post(reverse('chat-message-pin', args=[design['id']]))
        listed = self.client.get(reverse('chat-pinned-messages', args=[self.workspace.id]), {'channel': 'design'})
        self.assertEqual([item['message'] for item in listed.json()['messages']], ['In design'])

    def test_private_channel_pins_are_hidden_from_non_members(self):
        channel = ChatChannel.objects.create(workspace=self.workspace, name='secret', created_by=self.owner, is_private=True)
        message = self.post_channel_message('Secret plan', channel='secret')
        self.client.post(reverse('chat-message-pin', args=[message['id']]))
        self.client.force_login(self.member)
        self.assertEqual(self.client.post(reverse('chat-message-pin', args=[message['id']])).status_code, 404)
        self.assertEqual(self.client.get(reverse('chat-pinned-messages', args=[self.workspace.id]), {'channel': 'secret'}).status_code, 404)
        channel.members.add(self.member)
        self.assertEqual(self.client.get(reverse('chat-pinned-messages', args=[self.workspace.id]), {'channel': 'secret'}).status_code, 200)

    def test_outsiders_cannot_pin_or_star(self):
        message = self.post_channel_message()
        self.client.force_login(self.outsider)
        self.assertEqual(self.client.post(reverse('chat-message-pin', args=[message['id']])).status_code, 404)
        self.assertEqual(self.client.post(reverse('chat-message-star', args=[message['id']])).status_code, 404)

    def test_deleting_a_message_drops_its_pin_and_stars(self):
        message = self.post_channel_message()
        self.client.post(reverse('chat-message-pin', args=[message['id']]))
        self.client.post(reverse('chat-message-star', args=[message['id']]))
        self.client.delete(reverse('chat-message-detail', args=[message['id']]))
        listed = self.client.get(reverse('chat-pinned-messages', args=[self.workspace.id]), {'channel': 'general'})
        self.assertEqual(listed.json()['messages'], [])
        self.assertEqual(self.client.get(reverse('starred-messages', args=[self.workspace.id])).json()['items'], [])
        self.assertEqual(self.client.post(reverse('chat-message-pin', args=[message['id']])).status_code, 400)

    def test_direct_conversation_pins(self):
        conversation = self.direct_conversation()
        message = self.post_direct_message(conversation)
        pinned = self.client.post(reverse('direct-message-pin', args=[message['id']]))
        self.assertEqual(pinned.status_code, 200)
        listed = self.client.get(reverse('direct-pinned-messages', args=[conversation.id]))
        self.assertEqual([item['message'] for item in listed.json()['messages']], ['Private hello'])
        self.client.force_login(self.outsider)
        self.assertEqual(self.client.get(reverse('direct-pinned-messages', args=[conversation.id])).status_code, 404)
        self.assertEqual(self.client.post(reverse('direct-message-pin', args=[message['id']])).status_code, 404)

    def test_stars_are_personal(self):
        message = self.post_channel_message()
        starred = self.client.post(reverse('chat-message-star', args=[message['id']]))
        self.assertTrue(starred.json()['message']['starred'])
        self.client.force_login(self.member)
        seen = self.client.get(reverse('chat-message-list', args=[self.workspace.id]), {'channel': 'general'}).json()['messages']
        self.assertFalse(seen[0]['starred'])
        self.assertEqual(self.client.get(reverse('starred-messages', args=[self.workspace.id])).json()['items'], [])

        self.client.force_login(self.owner)
        listed = self.client.get(reverse('starred-messages', args=[self.workspace.id])).json()['items']
        self.assertEqual([(item['kind'], item['target_id'], item['message']['message']) for item in listed], [('channel', 'general', 'Hello team')])

        unstarred = self.client.delete(reverse('chat-message-star', args=[message['id']]))
        self.assertFalse(unstarred.json()['message']['starred'])
        self.assertEqual(self.client.get(reverse('starred-messages', args=[self.workspace.id])).json()['items'], [])

    def test_starred_list_spans_channels_and_direct_chats(self):
        channel_message = self.post_channel_message('Channel note')
        conversation = self.direct_conversation()
        direct_message = self.post_direct_message(conversation, 'Direct note')
        self.client.post(reverse('chat-message-star', args=[channel_message['id']]))
        self.client.post(reverse('direct-message-star', args=[direct_message['id']]))
        items = self.client.get(reverse('starred-messages', args=[self.workspace.id])).json()['items']
        self.assertEqual({(item['kind'], item['message']['message']) for item in items}, {('channel', 'Channel note'), ('direct', 'Direct note')})
        direct = next(item for item in items if item['kind'] == 'direct')
        self.assertEqual(direct['target_id'], conversation.id)
        self.assertTrue(direct['target_title'])
        self.assertTrue(direct['message']['starred'])
