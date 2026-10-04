"""Responses are compressed - except the one that has to arrive event by event.

The task list is the largest thing the app fetches: a page of 200 tasks measured
at 173 kB, uncompressed, on a workspace with a few hundred tasks. Compressing it
is the cheap half of that problem. The notification stream is the exception that
makes this middleware ours rather than Django's: Django compresses streaming
responses too, and a compressor holds bytes back until it has a block's worth,
which is the one thing an event stream cannot afford.
"""

import gzip
import json

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from .models import Membership, Task, Workspace


class ResponseCompressionTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('gzip@example.com', 'gzip@example.com', 'password')
        self.workspace = Workspace.objects.create(name='Gzip workspace', slug='gzip-workspace')
        Membership.objects.create(workspace=self.workspace, user=self.user, role='owner')
        self.client.force_login(self.user)

    def test_the_task_page_comes_back_compressed_and_unchanged(self):
        for index in range(60):
            Task.objects.create(
                workspace=self.workspace,
                title=f'Compressible task number {index}',
                description='The same sentence over and over, which is what compresses well.',
                code=f'GZ-{index}',
            )

        response = self.client.get(
            f'/api/tasks/?page=1&page_size=200',
            HTTP_ACCEPT_ENCODING='gzip',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Encoding'], 'gzip')
        # The point is the bytes on the wire, not just the header.
        self.assertLess(len(response.content), 8000)
        payload = json.loads(gzip.decompress(response.content).decode('utf-8'))
        self.assertEqual(len(payload['tasks']), 60)

    def test_a_client_that_cannot_read_gzip_is_not_sent_it(self):
        Task.objects.create(workspace=self.workspace, title='Something', code='GZ-0')

        response = self.client.get('/api/tasks/?page=1&page_size=200', HTTP_ACCEPT_ENCODING='')

        self.assertNotIn('Content-Encoding', response)
        self.assertEqual(response.status_code, 200)

    def test_the_notification_stream_is_left_uncompressed(self):
        """It is a few dozen bytes an event, and late is the same as broken."""
        response = self.client.get(
            reverse('notification-stream'),
            HTTP_ACCEPT_ENCODING='gzip',
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.streaming)
        self.assertNotIn('Content-Encoding', response)
