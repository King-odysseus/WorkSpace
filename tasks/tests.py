import json

from django.test import TestCase
from django.urls import reverse
from django.contrib.auth.models import User

from .models import Task


class TaskApiTests(TestCase):
    def test_health_endpoint(self):
        response = self.client.get(reverse('health'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'ok')

    def test_create_list_update_and_delete_task(self):
        create_response = self.client.post(
            reverse('task-list'),
            data=json.dumps({'title': 'Prepare launch brief', 'project': 'Launch'}),
            content_type='application/json',
        )
        self.assertEqual(create_response.status_code, 201)
        task_id = create_response.json()['task']['id']

        list_response = self.client.get(reverse('task-list'))
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(len(list_response.json()['tasks']), 1)

        update_response = self.client.patch(
            reverse('task-detail', args=[task_id]),
            data=json.dumps({'status': 'in_progress'}),
            content_type='application/json',
        )
        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.json()['task']['status'], 'in_progress')

        delete_response = self.client.delete(reverse('task-detail', args=[task_id]))
        self.assertEqual(delete_response.status_code, 200)
        self.assertFalse(Task.objects.filter(id=task_id).exists())

    def test_create_requires_a_title(self):
        response = self.client.post(
            reverse('task-list'),
            data=json.dumps({'title': '  '}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)


class AuthenticationApiTests(TestCase):
    def test_signup_creates_user_workspace_and_session(self):
        response = self.client.post(
            reverse('auth-me'),
            data=json.dumps({'email': 'owner@example.com', 'password': 'secure-pass-123', 'workspace_name': 'Northstar'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()['authenticated'])
        self.assertEqual(response.json()['user']['workspaces'][0]['role'], 'owner')

    def test_login_rejects_invalid_credentials(self):
        User.objects.create_user(username='member@example.com', email='member@example.com', password='secure-pass-123')
        response = self.client.post(
            reverse('auth-login'),
            data=json.dumps({'email': 'member@example.com', 'password': 'wrong-password'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 401)

    def test_me_reports_anonymous_state(self):
        response = self.client.get(reverse('auth-me'))
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['authenticated'])
