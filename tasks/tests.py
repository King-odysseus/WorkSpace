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

    def test_task_comments_and_subtasks_are_scoped_and_editable(self):
        task_response = self.client.post(
            reverse('task-list'),
            data=json.dumps({'title': 'Prepare launch brief', 'bucket': 'Planning'}),
            content_type='application/json',
            HTTP_X_WORKSPACE_ID=str(self.workspace.id),
        )
        task_id = task_response.json()['task']['id']

        comment_response = self.client.post(
            reverse('task-comment-list', args=[task_id]),
            data=json.dumps({'body': 'Please include the latest customer notes.'}),
            content_type='application/json',
        )
        self.assertEqual(comment_response.status_code, 201)
        self.assertEqual(self.client.get(reverse('task-comment-list', args=[task_id])).json()['comments'][0]['body'], 'Please include the latest customer notes.')

        subtask_response = self.client.post(
            reverse('task-subtask-list', args=[task_id]),
            data=json.dumps({'title': 'Add customer notes'}),
            content_type='application/json',
        )
        self.assertEqual(subtask_response.status_code, 201)
        subtask_id = subtask_response.json()['subtask']['id']
        update_response = self.client.patch(
            reverse('task-subtask-detail', args=[subtask_id]),
            data=json.dumps({'completed': True}),
            content_type='application/json',
        )
        self.assertEqual(update_response.status_code, 200)
        self.assertTrue(update_response.json()['subtask']['completed'])

    def test_task_detail_rejects_invalid_bucket(self):
        task = Task.objects.create(workspace=self.workspace, title='Task')
        response = self.client.patch(
            reverse('task-detail', args=[task.id]),
            data=json.dumps({'bucket': ''}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)

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

    def test_invited_user_can_accept_an_invitation(self):
        invitation = WorkspaceInvitation.objects.create(workspace=self.workspace, email='invitee@example.com', role='member', invited_by=self.user)
        invitee = User.objects.create_user(username='invitee@example.com', email='invitee@example.com', password='secure-pass-123')
        self.client.login(username=invitee.username, password='secure-pass-123')
        response = self.client.post(reverse('invitation-accept', args=[invitation.id]))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(Membership.objects.filter(workspace=self.workspace, user=invitee).exists())
        invitation.refresh_from_db()
        self.assertEqual(invitation.status, 'accepted')

    def test_invitation_cannot_be_accepted_by_a_different_email(self):
        invitation = WorkspaceInvitation.objects.create(workspace=self.workspace, email='invitee@example.com', role='member', invited_by=self.user)
        other = User.objects.create_user(username='other-invitee@example.com', email='other-invitee@example.com', password='secure-pass-123')
        self.client.login(username=other.username, password='secure-pass-123')
        response = self.client.post(reverse('invitation-accept', args=[invitation.id]))
        self.assertEqual(response.status_code, 403)

    def test_owner_can_change_member_role_and_remove_member(self):
        member = User.objects.create_user(username='managed@example.com', email='managed@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=member, role='member')
        role_response = self.client.patch(
            reverse('member-detail', args=[self.workspace.id, member.id]),
            data=json.dumps({'role': 'manager'}),
            content_type='application/json',
        )
        self.assertEqual(role_response.status_code, 200)
        remove_response = self.client.delete(reverse('member-detail', args=[self.workspace.id, member.id]))
        self.assertEqual(remove_response.status_code, 200)
        self.assertFalse(Membership.objects.filter(workspace=self.workspace, user=member).exists())

    def test_manager_cannot_change_another_manager_or_owner(self):
        manager = User.objects.create_user(username='manager@example.com', email='manager@example.com', password='secure-pass-123')
        other_manager = User.objects.create_user(username='other-manager@example.com', email='other-manager@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=manager, role='manager')
        Membership.objects.create(workspace=self.workspace, user=other_manager, role='manager')
        self.client.login(username=manager.username, password='secure-pass-123')
        response = self.client.patch(
            reverse('member-detail', args=[self.workspace.id, other_manager.id]),
            data=json.dumps({'role': 'member'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)

    def test_owner_can_update_and_delete_a_project(self):
        project = Project.objects.create(workspace=self.workspace, name='Launch')
        update = self.client.patch(
            reverse('project-detail', args=[self.workspace.id, project.id]),
            data=json.dumps({'status': 'active', 'due_date': '2026-09-10'}),
            content_type='application/json',
        )
        self.assertEqual(update.status_code, 200)
        self.assertEqual(update.json()['project']['status'], 'active')
        delete = self.client.delete(reverse('project-detail', args=[self.workspace.id, project.id]))
        self.assertEqual(delete.status_code, 200)

    def test_calendar_event_can_be_updated_and_deleted(self):
        create = self.client.post(
            reverse('calendar-event-list', args=[self.workspace.id]),
            data=json.dumps({'title': 'Sync', 'start_at': '2026-09-02T10:00:00Z', 'end_at': '2026-09-02T10:30:00Z'}),
            content_type='application/json',
        )
        event_id = create.json()['event']['id']
        update = self.client.patch(
            reverse('calendar-event-detail', args=[self.workspace.id, event_id]),
            data=json.dumps({'title': 'Updated sync'}),
            content_type='application/json',
        )
        self.assertEqual(update.status_code, 200)
        self.assertEqual(update.json()['event']['title'], 'Updated sync')
        self.assertEqual(self.client.delete(reverse('calendar-event-detail', args=[self.workspace.id, event_id])).status_code, 200)


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

    def test_logout_clears_authenticated_session(self):
        user = User.objects.create_user(username='logout@example.com', email='logout@example.com', password='secure-pass-123')
        self.client.login(username=user.username, password='secure-pass-123')
        response = self.client.post(reverse('auth-logout'))
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['authenticated'])
        self.assertFalse(self.client.get(reverse('auth-me')).json()['authenticated'])
