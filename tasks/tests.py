import json

from django.test import TestCase
from django.urls import reverse
from django.contrib.auth.models import User

from .models import CalendarEvent, CheckIn, ChatMessage, FollowUp, Membership, Project, Task, Workspace, WorkspaceInvitation


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

    def test_create_task_validates_workspace_assignee_and_project(self):
        project = Project.objects.create(workspace=self.workspace, name='Launch')
        response = self.client.post(
            reverse('task-list'),
            data=json.dumps({'title': 'Prepare brief', 'assignee_id': self.user.id, 'project_id': project.id, 'due_date': '2026-09-05'}),
            content_type='application/json',
            HTTP_X_WORKSPACE_ID=str(self.workspace.id),
        )
        self.assertEqual(response.status_code, 201)
        task = Task.objects.get()
        self.assertEqual(task.assignee, self.user)
        self.assertEqual(task.project_ref, project)
        self.assertEqual(response.json()['task']['project_id'], project.id)

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

    def test_calendar_event_requires_valid_time_range(self):
        response = self.client.post(
            reverse('calendar-event-list', args=[self.workspace.id]),
            data=json.dumps({'title': 'Daily sync', 'start_at': '2026-09-02T10:00:00Z', 'end_at': '2026-09-02T09:00:00Z'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(CalendarEvent.objects.count(), 0)

    def test_calendar_event_is_scoped_to_workspace(self):
        response = self.client.post(
            reverse('calendar-event-list', args=[self.workspace.id]),
            data=json.dumps({'title': 'Daily sync', 'start_at': '2026-09-02T10:00:00Z', 'end_at': '2026-09-02T10:30:00Z'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        list_response = self.client.get(reverse('calendar-event-list', args=[self.workspace.id]))
        self.assertEqual(len(list_response.json()['events']), 1)

    def test_daily_check_in_is_idempotent_for_a_member(self):
        url = reverse('check-in-list', args=[self.workspace.id])
        payload = {'date': '2026-09-02', 'completed': 'Reviewed launch brief', 'next_steps': 'Share with team'}
        first = self.client.post(url, data=json.dumps(payload), content_type='application/json')
        second = self.client.post(url, data=json.dumps({**payload, 'blockers': 'Waiting on approval'}), content_type='application/json')
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(CheckIn.objects.count(), 1)
        self.assertEqual(second.json()['check_in']['blockers'], 'Waiting on approval')

    def test_chat_message_is_created_for_the_current_member(self):
        response = self.client.post(
            reverse('chat-message-list', args=[self.workspace.id]),
            data=json.dumps({'channel': 'general', 'message': 'Launch sync is ready.'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(ChatMessage.objects.get().author, self.user)

    def test_follow_up_cannot_reference_another_workspace_task(self):
        other_workspace = Workspace.objects.create(name='Other', slug='other-follow-up')
        other_task = Task.objects.create(workspace=other_workspace, title='Private task')
        response = self.client.post(
            reverse('follow-up-list', args=[self.workspace.id]),
            data=json.dumps({'note': 'Request review', 'task_id': other_task.id}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(FollowUp.objects.count(), 0)

    def test_owner_can_create_a_workspace_invitation(self):
        response = self.client.post(
            reverse('invitation-list', args=[self.workspace.id]),
            data=json.dumps({'email': 'new-member@example.com', 'role': 'member'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        invitation = WorkspaceInvitation.objects.get()
        self.assertEqual(invitation.email, 'new-member@example.com')

    def test_regular_member_cannot_create_a_workspace_invitation(self):
        member = User.objects.create_user(username='member@example.com', email='member@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=member, role='member')
        self.client.login(username='member@example.com', password='secure-pass-123')
        response = self.client.post(
            reverse('invitation-list', args=[self.workspace.id]),
            data=json.dumps({'email': 'new-member@example.com'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)

    def test_regular_member_cannot_create_a_project(self):
        member = User.objects.create_user(username='project-member@example.com', email='project-member@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=member, role='member')
        self.client.login(username='project-member@example.com', password='secure-pass-123')
        response = self.client.post(
            reverse('project-list', args=[self.workspace.id]),
            data=json.dumps({'name': 'Restricted project'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)


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
