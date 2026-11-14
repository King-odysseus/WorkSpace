from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from .models import PushSubscription
from . import push


@override_settings(WEB_PUSH_CONFIGURED=True, VAPID_PRIVATE_KEY='k', VAPID_PUBLIC_KEY='p')
class PushDeliveryTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('push@example.com', 'push@example.com', 'pw-12345678')
        PushSubscription.objects.create(user=self.user, endpoint='https://push.example/1', p256dh='a', auth='b')

    def test_queues_delivery_off_the_request_thread(self):
        with patch.object(push.threading, 'Thread') as thread:
            queued = push.send_push_to_user(self.user, 'Hello')
        self.assertEqual(queued, 1)
        thread.return_value.start.assert_called_once()

    def test_wait_delivers_inline_with_long_ttl_and_high_urgency(self):
        with patch.object(push, 'webpush') as send:
            sent = push.send_push_to_user(self.user, 'Hello', wait=True)
        self.assertEqual(sent, 1)
        self.assertEqual(send.call_args.kwargs['ttl'], push.PUSH_TTL_SECONDS)
        self.assertEqual(send.call_args.kwargs['headers'], {'Urgency': 'high'})
