import json

from django.test import TestCase
from django.urls import reverse
from django.contrib.auth.models import User

from .models import Membership, Task, Workspace


class TaskApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='owner@example.com', email='owner@example.com', password='secure-pass-123')
        self.workspace = Workspace.objects.create(name='Northstar', slug='northstar')
        Membership.objects.create(workspace=self.workspace, user=self.user, role='owner')
        self.client.login(username='owner@example.com', password='secure-pass-123')

    def test_health_endpoint(self):
        response = self.client.get(reverse('health'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'ok')

    def test_create_list_update_and_delete_task(self):
        create_response = self.client.post(
            reverse('task-list'),
            data=json.dumps({'title': 'Prepare launch brief', 'project': 'Launch'}),
            content_type='application/json',
            HTTP_X_WORKSPACE_ID=str(self.workspace.id),
        )
        self.assertEqual(create_response.status_code, 201)
        task_id = create_response.json()['task']['id']

        list_response = self.client.get(reverse('task-list'))
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(len(list_response.json()['tasks']), 1)
        self.assertEqual(list_response.json()['tasks'][0]['workspace_id'], self.workspace.id)

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

    def test_anonymous_users_cannot_read_tasks(self):
        self.client.logout()
        response = self.client.get(reverse('task-list'))
        self.assertEqual(response.status_code, 401)

    def test_user_cannot_read_another_workspace_tasks(self):
        other_user = User.objects.create_user(username='other@example.com', email='other@example.com', password='secure-pass-123')
        other_workspace = Workspace.objects.create(name='Other', slug='other')
        Membership.objects.create(workspace=other_workspace, user=other_user, role='owner')
        Task.objects.create(title='Private task', workspace=other_workspace)

        response = self.client.get(reverse('task-list'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['tasks'], [])


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
