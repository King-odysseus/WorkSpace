import json
from io import StringIO
from datetime import timedelta
from pathlib import Path
from unittest import mock

from django.core.management import call_command
from django.test import TestCase
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from django.contrib.auth.models import User
from django.utils import timezone
from django.db import connection
from django.test.utils import CaptureQueriesContext

from .models import ActivityEvent, AuditLog, CalendarEvent, ChatChannel, CheckIn, ChatMessage, DirectConversation, DirectMessage, FollowUp, LookupValue, Membership, NotificationPreference, PlanBucket, Project, RiskIssue, Task, TaskAttachment, TaskChangeHistory, TaskCodeRegistry, TaskComment, TaskSubtask, TaskSupporter, WebhookDelivery, Workspace, WorkspaceInvitation, WorkspaceNotification, WorkspaceWebhook, WorkShift
from .views import create_notification
from .webhooks import drain_webhook_deliveries, notify_workspace_webhooks


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
            data=json.dumps({'title': 'Prepare launch brief', 'project': 'Launch', 'bucket': 'This week'}),
            content_type='application/json',
            HTTP_X_WORKSPACE_ID=str(self.workspace.id),
        )
        self.assertEqual(create_response.status_code, 201)
        task_id = create_response.json()['task']['id']

        list_response = self.client.get(reverse('task-list'))
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(len(list_response.json()['tasks']), 1)
        self.assertEqual(list_response.json()['tasks'][0]['workspace_id'], self.workspace.id)
        self.assertEqual(list_response.json()['tasks'][0]['bucket'], 'This week')

        update_response = self.client.patch(
            reverse('task-detail', args=[task_id]),
            data=json.dumps({'title': 'Prepare updated launch brief', 'description': 'Include the approved rollout notes.', 'status': 'in_progress'}),
            content_type='application/json',
        )
        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.json()['task']['status'], 'in_progress')
        self.assertEqual(update_response.json()['task']['title'], 'Prepare updated launch brief')
        self.assertEqual(update_response.json()['task']['description'], 'Include the approved rollout notes.')

        delete_response = self.client.delete(reverse('task-detail', args=[task_id]))
        self.assertEqual(delete_response.status_code, 200)
        self.assertEqual(Task.objects.get(id=task_id).state, 'archived')

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
        self.assertEqual(response.json()['task']['project'], 'Launch')

    def test_task_priority_is_persisted_and_validated(self):
        response = self.client.post(
            reverse('task-list'),
            data=json.dumps({'title': 'Resolve launch blocker', 'priority': 'urgent'}),
            content_type='application/json',
            HTTP_X_WORKSPACE_ID=str(self.workspace.id),
        )
        self.assertEqual(response.status_code, 201)
        task_id = response.json()['task']['id']
        self.assertEqual(response.json()['task']['priority'], 'urgent')

        update_response = self.client.patch(
            reverse('task-detail', args=[task_id]),
            data=json.dumps({'priority': 'high'}),
            content_type='application/json',
        )
        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.json()['task']['priority'], 'high')

        invalid_response = self.client.patch(
            reverse('task-detail', args=[task_id]),
            data=json.dumps({'priority': 'critical'}),
            content_type='application/json',
        )
        self.assertEqual(invalid_response.status_code, 400)

    def test_task_field_changes_record_activity_only_when_values_change(self):
        task = Task.objects.create(workspace=self.workspace, title='Prepare brief', priority='normal')

        first_update = self.client.patch(
            reverse('task-detail', args=[task.id]),
            data=json.dumps({'priority': 'high', 'due_date': '2026-09-10'}),
            content_type='application/json',
        )
        self.assertEqual(first_update.status_code, 200)
        self.assertEqual(ActivityEvent.objects.filter(workspace=self.workspace, kind='task_priority').count(), 1)
        self.assertEqual(ActivityEvent.objects.filter(workspace=self.workspace, kind='task_due_date').count(), 1)

        second_update = self.client.patch(
            reverse('task-detail', args=[task.id]),
            data=json.dumps({'priority': 'high', 'due_date': '2026-09-10'}),
            content_type='application/json',
        )
        self.assertEqual(second_update.status_code, 200)
        self.assertEqual(ActivityEvent.objects.filter(workspace=self.workspace, kind='task_priority').count(), 1)
        self.assertEqual(ActivityEvent.objects.filter(workspace=self.workspace, kind='task_due_date').count(), 1)

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
        delete_response = self.client.delete(reverse('task-subtask-detail', args=[subtask_id]))
        self.assertEqual(delete_response.status_code, 200)
        self.assertFalse(TaskSubtask.objects.filter(id=subtask_id).exists())

    def test_members_cannot_mutate_subtasks_on_unassigned_tasks(self):
        task = Task.objects.create(workspace=self.workspace, title='Owner task', assignee=self.user)
        subtask = TaskSubtask.objects.create(task=task, title='Owner subtask')
        teammate = User.objects.create_user(username='subtask-member@example.com', email='subtask-member@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=teammate, role='member')
        self.client.force_login(teammate)
        create_response = self.client.post(
            reverse('task-subtask-list', args=[task.id]),
            data=json.dumps({'title': 'Unauthorized subtask'}),
            content_type='application/json',
        )
        self.assertEqual(create_response.status_code, 403)
        update_response = self.client.patch(
            reverse('task-subtask-detail', args=[subtask.id]),
            data=json.dumps({'completed': True}),
            content_type='application/json',
        )
        self.assertEqual(update_response.status_code, 403)
        delete_response = self.client.delete(reverse('task-subtask-detail', args=[subtask.id]))
        self.assertEqual(delete_response.status_code, 403)

    def test_task_detail_rejects_invalid_bucket(self):
        task = Task.objects.create(workspace=self.workspace, title='Task')
        response = self.client.patch(
            reverse('task-detail', args=[task.id]),
            data=json.dumps({'bucket': ''}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)

    def test_task_detail_normalizes_null_optional_text(self):
        task = Task.objects.create(workspace=self.workspace, title='Task', description='Old description')
        response = self.client.patch(
            reverse('task-detail', args=[task.id]),
            data=json.dumps({'description': None, 'assignee_name': None, 'project': None}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        task.refresh_from_db()
        self.assertEqual(task.description, '')
        self.assertEqual(task.assignee_name, '')
        self.assertEqual(task.project, '')

    def test_completing_recurring_task_creates_next_task(self):
        response = self.client.post(
            reverse('task-list'),
            data=json.dumps({'title': 'Daily standup', 'due_date': '2026-09-02', 'recurrence': 'daily'}),
            content_type='application/json',
            HTTP_X_WORKSPACE_ID=str(self.workspace.id),
        )
        task_id = response.json()['task']['id']
        complete_response = self.client.patch(
            reverse('task-detail', args=[task_id]),
            data=json.dumps({'status': 'done'}),
            content_type='application/json',
        )
        self.assertEqual(complete_response.status_code, 200)
        next_task = Task.objects.exclude(id=task_id).get()
        self.assertEqual(next_task.title, 'Daily standup')
        self.assertEqual(next_task.due_date.isoformat(), '2026-09-03')
        self.assertEqual(next_task.recurrence, 'daily')

    def test_task_events_create_notifications_and_activity(self):
        teammate = User.objects.create_user(username='member@example.com', email='member@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=teammate, role='member')
        response = self.client.post(
            reverse('task-list'),
            data=json.dumps({'title': 'Review brief', 'assignee_id': teammate.id}),
            content_type='application/json',
            HTTP_X_WORKSPACE_ID=str(self.workspace.id),
        )
        task_id = response.json()['task']['id']
        self.assertEqual(response.json()['task']['assignee_name'], 'member@example.com')
        self.assertEqual(WorkspaceNotification.objects.filter(recipient=teammate, kind='task_assigned').count(), 1)
        self.assertEqual(ActivityEvent.objects.filter(workspace=self.workspace, kind='task_created').count(), 1)

        notification_response = self.client.get(reverse('notification-list', args=[self.workspace.id]))
        self.assertEqual(notification_response.status_code, 200)
        self.assertEqual(notification_response.json()['unread_count'], 0)
        self.client.force_login(teammate)
        notification_response = self.client.get(reverse('notification-list', args=[self.workspace.id]))
        self.assertEqual(notification_response.json()['unread_count'], 1)
        notification = notification_response.json()['notifications'][0]
        self.assertEqual(notification['target_type'], 'task')
        self.assertEqual(notification['target_id'], str(task_id))
        read_response = self.client.patch(reverse('notification-list', args=[self.workspace.id]), data=json.dumps({'notification_id': notification['id']}), content_type='application/json')
        self.assertEqual(read_response.status_code, 200)

    def test_notifications_carry_a_navigable_target_for_each_source(self):
        teammate = User.objects.create_user(username='teammate@example.com', email='teammate@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=teammate, role='member')

        follow_up_response = self.client.post(
            reverse('follow-up-list', args=[self.workspace.id]),
            data=json.dumps({'note': 'Confirm launch readiness', 'assigned_to': teammate.id}),
            content_type='application/json',
        )
        follow_up_id = follow_up_response.json()['follow_up']['id']
        follow_up_notification = WorkspaceNotification.objects.get(recipient=teammate, kind='follow_up_assigned')
        self.assertEqual(follow_up_notification.target_type, 'follow_up')
        self.assertEqual(follow_up_notification.target_id, str(follow_up_id))

        chat_response = self.client.post(
            reverse('chat-message-list', args=[self.workspace.id]),
            data=json.dumps({'channel': 'launch', 'message': f'@{teammate.username.split("@")[0]} please review'}),
            content_type='application/json',
        )
        self.assertEqual(chat_response.status_code, 201)
        mention_notification = WorkspaceNotification.objects.get(recipient=teammate, kind='mention')
        self.assertEqual(mention_notification.target_type, 'chat_channel')
        self.assertEqual(mention_notification.target_id, 'launch')

    def test_reassigning_task_notifies_new_assignee(self):
        original_assignee = User.objects.create_user(username='first@example.com', email='first@example.com', password='secure-pass-123')
        new_assignee = User.objects.create_user(username='second@example.com', email='second@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=original_assignee, role='member')
        Membership.objects.create(workspace=self.workspace, user=new_assignee, role='member')
        task = Task.objects.create(workspace=self.workspace, title='Draft report', assignee=original_assignee)

        response = self.client.patch(
            reverse('task-detail', args=[task.id]),
            data=json.dumps({'assignee_id': new_assignee.id}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(WorkspaceNotification.objects.filter(recipient=new_assignee, kind='task_assigned').count(), 1)
        self.assertEqual(WorkspaceNotification.objects.filter(recipient=original_assignee, kind='task_assigned').count(), 0)
        self.assertEqual(ActivityEvent.objects.filter(workspace=self.workspace, kind='task_assigned').count(), 1)

    def test_owner_can_create_and_read_plan_buckets(self):
        create_response = self.client.post(
            reverse('plan-bucket-list', args=[self.workspace.id]),
            data=json.dumps({'name': 'Review queue'}),
            content_type='application/json',
        )
        self.assertEqual(create_response.status_code, 201)
        self.assertEqual(create_response.json()['bucket']['name'], 'Review queue')
        list_response = self.client.get(reverse('plan-bucket-list', args=[self.workspace.id]))
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(list_response.json()['buckets'][0]['name'], 'Review queue')
        self.assertEqual(PlanBucket.objects.count(), 1)

    def test_owner_can_persist_bucket_order(self):
        first = PlanBucket.objects.create(workspace=self.workspace, name='First', position=0)
        second = PlanBucket.objects.create(workspace=self.workspace, name='Second', position=1)
        response = self.client.patch(
            reverse('plan-bucket-reorder', args=[self.workspace.id]),
            data=json.dumps({'bucket_ids': [second.id, first.id]}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual([bucket['id'] for bucket in response.json()['buckets']], [second.id, first.id])

    def test_task_positions_can_be_reordered_and_moved_between_buckets(self):
        first = Task.objects.create(workspace=self.workspace, title='First', bucket='Backlog', position=0)
        second = Task.objects.create(workspace=self.workspace, title='Second', bucket='Backlog', position=1)
        third = Task.objects.create(workspace=self.workspace, title='Third', bucket='Doing', position=0)
        response = self.client.patch(
            reverse('task-reorder', args=[self.workspace.id]),
            data=json.dumps({'columns': [
                {'bucket': 'Backlog', 'task_ids': [second.id]},
                {'bucket': 'Doing', 'task_ids': [first.id, third.id]},
            ]}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        first.refresh_from_db()
        second.refresh_from_db()
        third.refresh_from_db()
        self.assertEqual((second.bucket, second.position), ('Backlog', 0))
        self.assertEqual((first.bucket, first.position), ('Doing', 0))
        self.assertEqual((third.bucket, third.position), ('Doing', 1))

    def test_members_cannot_reorder_tasks_they_do_not_own(self):
        member = User.objects.create_user(username='planner-member@example.com', email='planner-member@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=member, role='member')
        owner_task = Task.objects.create(workspace=self.workspace, title='Owner task', assignee=self.user)
        self.client.force_login(member)
        response = self.client.patch(
            reverse('task-reorder', args=[self.workspace.id]),
            data=json.dumps({'columns': [{'bucket': 'Backlog', 'task_ids': [owner_task.id]}]}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)

    def test_members_cannot_reorder_workspace_buckets(self):
        member = User.objects.create_user(username='bucket-member@example.com', email='bucket-member@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=member, role='member')
        bucket = PlanBucket.objects.create(workspace=self.workspace, name='Restricted', position=0)
        self.client.force_login(member)
        response = self.client.patch(
            reverse('plan-bucket-reorder', args=[self.workspace.id]),
            data=json.dumps({'bucket_ids': [bucket.id]}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)

    def test_saved_views_are_persisted_and_scoped_to_the_user(self):
        create_response = self.client.post(
            reverse('saved-view-list', args=[self.workspace.id]),
            data=json.dumps({'name': 'Urgent launch work', 'filter': 'urgent', 'search': 'launch'}),
            content_type='application/json',
        )
        self.assertEqual(create_response.status_code, 201)
        view_id = create_response.json()['saved_view']['id']
        self.assertEqual(create_response.json()['saved_view']['search'], 'launch')

        update_response = self.client.post(
            reverse('saved-view-list', args=[self.workspace.id]),
            data=json.dumps({'name': 'Urgent launch work', 'filter': 'blocked', 'search': 'release'}),
            content_type='application/json',
        )
        self.assertEqual(update_response.status_code, 201)
        self.assertEqual(update_response.json()['saved_view']['id'], view_id)
        self.assertEqual(self.client.get(reverse('saved-view-list', args=[self.workspace.id])).json()['saved_views'][0]['filter'], 'blocked')

        teammate = User.objects.create_user(username='saved-view-member@example.com', email='saved-view-member@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=teammate, role='member')
        self.client.force_login(teammate)
        self.assertEqual(self.client.get(reverse('saved-view-list', args=[self.workspace.id])).json()['saved_views'], [])
        self.assertEqual(self.client.delete(reverse('saved-view-detail', args=[self.workspace.id, view_id])).status_code, 404)

    def test_profile_avatar_can_be_uploaded_replaced_and_removed(self):
        tiny_png = bytes.fromhex(
            '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753'
            'de0000000c4944415478da6360606060000000050001a5f645400000000049454e44ae426082'
        )
        upload = SimpleUploadedFile('face.png', tiny_png, content_type='image/png')
        response = self.client.post(reverse('auth-me-avatar'), data={'avatar': upload})
        self.assertEqual(response.status_code, 200)
        avatar_url = response.json()['avatar_url']
        self.assertEqual(avatar_url, f'/api/users/{self.user.id}/avatar/')
        self.assertEqual(self.client.get(reverse('auth-me')).json()['user']['avatar_url'], avatar_url)

        download_response = self.client.get(avatar_url)
        self.assertEqual(download_response.status_code, 200)

        replacement = SimpleUploadedFile('face2.png', tiny_png, content_type='image/png')
        replace_response = self.client.post(reverse('auth-me-avatar'), data={'avatar': replacement})
        self.assertEqual(replace_response.status_code, 200)

        oversized = SimpleUploadedFile('huge.png', b'0' * (5 * 1024 * 1024 + 1), content_type='image/png')
        rejected_response = self.client.post(reverse('auth-me-avatar'), data={'avatar': oversized})
        self.assertEqual(rejected_response.status_code, 400)

        wrong_type = SimpleUploadedFile('notes.txt', b'not an image', content_type='text/plain')
        rejected_type_response = self.client.post(reverse('auth-me-avatar'), data={'avatar': wrong_type})
        self.assertEqual(rejected_type_response.status_code, 400)

        delete_response = self.client.delete(reverse('auth-me-avatar'))
        self.assertEqual(delete_response.status_code, 200)
        self.assertEqual(delete_response.json()['avatar_url'], '')
        self.assertEqual(self.client.get(avatar_url).status_code, 404)

    def test_presence_can_be_set_and_is_visible_to_teammates(self):
        teammate = User.objects.create_user(username='presence-teammate@example.com', email='presence-teammate@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=teammate, role='member')

        response = self.client.patch(reverse('auth-me-presence'), data=json.dumps({'presence': 'busy'}), content_type='application/json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['presence'], 'busy')

        rejected_response = self.client.patch(reverse('auth-me-presence'), data=json.dumps({'presence': 'unstoppable'}), content_type='application/json')
        self.assertEqual(rejected_response.status_code, 400)

        members_response = self.client.get(reverse('member-list', args=[self.workspace.id]))
        owner_member = next(member for member in members_response.json()['members'] if member['id'] == self.user.id)
        self.assertEqual(owner_member['presence'], 'busy')
        teammate_member = next(member for member in members_response.json()['members'] if member['id'] == teammate.id)
        self.assertEqual(teammate_member['presence'], 'available')

    def test_notification_preferences_default_to_enabled_and_can_be_updated(self):
        response = self.client.get(reverse('notification-preference-detail', args=[self.workspace.id]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['preferences'], {'mentions': True, 'direct_messages': True, 'task_updates': True, 'calendar_reminders': True})

        update_response = self.client.patch(
            reverse('notification-preference-detail', args=[self.workspace.id]),
            data=json.dumps({'task_updates': False}),
            content_type='application/json',
        )
        self.assertEqual(update_response.status_code, 200)
        self.assertFalse(update_response.json()['preferences']['task_updates'])
        self.assertTrue(update_response.json()['preferences']['mentions'])

        rejected_response = self.client.patch(
            reverse('notification-preference-detail', args=[self.workspace.id]),
            data=json.dumps({'mentions': 'yes'}),
            content_type='application/json',
        )
        self.assertEqual(rejected_response.status_code, 400)

    def test_disabled_task_update_preference_suppresses_notification(self):
        teammate = User.objects.create_user(username='notif-pref@example.com', email='notif-pref@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=teammate, role='member')
        NotificationPreference.objects.create(workspace=self.workspace, user=teammate, task_updates=False)

        create_response = self.client.post(
            reverse('task-list'),
            data=json.dumps({'title': 'Ship the release notes', 'assignee_id': teammate.id}),
            content_type='application/json',
            HTTP_X_WORKSPACE_ID=str(self.workspace.id),
        )
        self.assertEqual(create_response.status_code, 201)
        self.assertEqual(WorkspaceNotification.objects.filter(recipient=teammate, kind='task_assigned').count(), 0)

        other_teammate = User.objects.create_user(username='notif-pref-2@example.com', email='notif-pref-2@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=other_teammate, role='member')
        second_response = self.client.post(
            reverse('task-list'),
            data=json.dumps({'title': 'Draft the changelog', 'assignee_id': other_teammate.id}),
            content_type='application/json',
            HTTP_X_WORKSPACE_ID=str(self.workspace.id),
        )
        self.assertEqual(second_response.status_code, 201)
        self.assertEqual(WorkspaceNotification.objects.filter(recipient=other_teammate, kind='task_assigned').count(), 1)

    def test_chat_replies_and_mentions_are_supported(self):
        teammate = User.objects.create_user(username='member@example.com', email='member@example.com', first_name='Team', last_name='Member', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=teammate, role='member')
        message_response = self.client.post(
            reverse('chat-message-list', args=[self.workspace.id]),
            data=json.dumps({'channel': 'general', 'message': '@member please review this.'}),
            content_type='application/json',
        )
        self.assertEqual(message_response.status_code, 201)
        message_id = message_response.json()['message']['id']
        self.assertEqual(WorkspaceNotification.objects.filter(recipient=teammate, kind='mention').count(), 1)
        reply_response = self.client.post(
            reverse('chat-message-list', args=[self.workspace.id]),
            data=json.dumps({'channel': 'general', 'message': 'I will review it.', 'parent_id': message_id}),
            content_type='application/json',
        )
        self.assertEqual(reply_response.status_code, 201)
        self.assertEqual(reply_response.json()['message']['parent_id'], message_id)
        self.assertEqual(self.client.get(reverse('chat-message-list', args=[self.workspace.id])).json()['messages'][0]['reply_count'], 1)

    def test_channels_are_created_separately_and_private_channels_are_scoped(self):
        teammate = User.objects.create_user(username='private-member@example.com', email='private-member@example.com', password='secure-pass-123')
        outsider = User.objects.create_user(username='private-outsider@example.com', email='private-outsider@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=teammate, role='member')
        Membership.objects.create(workspace=self.workspace, user=outsider, role='member')
        response = self.client.post(
            reverse('chat-channel-list', args=[self.workspace.id]),
            data=json.dumps({'name': 'Product Launch', 'description': 'Private launch planning', 'is_private': True, 'member_ids': [teammate.id]}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['channel']['name'], 'product-launch')
        self.assertTrue(ChatChannel.objects.get(name='product-launch').members.filter(id=teammate.id).exists())

        self.client.force_login(outsider)
        listed_names = [channel['name'] for channel in self.client.get(reverse('chat-channel-list', args=[self.workspace.id])).json()['channels']]
        self.assertNotIn('product-launch', listed_names)
        denied = self.client.post(
            reverse('chat-message-list', args=[self.workspace.id]),
            data=json.dumps({'channel': 'product-launch', 'message': 'I should not see this.'}),
            content_type='application/json',
        )
        self.assertEqual(denied.status_code, 403)

    def test_direct_conversation_is_reused_and_messages_are_private(self):
        teammate = User.objects.create_user(username='dm-member@example.com', email='dm-member@example.com', password='secure-pass-123')
        outsider = User.objects.create_user(username='dm-outsider@example.com', email='dm-outsider@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=teammate, role='member')
        Membership.objects.create(workspace=self.workspace, user=outsider, role='member')
        first = self.client.post(reverse('direct-conversation-list', args=[self.workspace.id]), data=json.dumps({'participant_ids': [teammate.id]}), content_type='application/json')
        second = self.client.post(reverse('direct-conversation-list', args=[self.workspace.id]), data=json.dumps({'recipient_id': teammate.id}), content_type='application/json')
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json()['conversation']['id'], second.json()['conversation']['id'])
        conversation_id = first.json()['conversation']['id']
        sent = self.client.post(reverse('direct-message-list', args=[conversation_id]), data=json.dumps({'message': 'Private hello'}), content_type='application/json')
        self.assertEqual(sent.status_code, 201)
        self.assertEqual(DirectMessage.objects.get().author, self.user)

        self.client.force_login(outsider)
        self.assertEqual(self.client.get(reverse('direct-message-list', args=[conversation_id])).status_code, 404)

    def test_follow_up_can_be_assigned_and_notifies_teammate(self):
        teammate = User.objects.create_user(username='follow-up-member@example.com', email='follow-up-member@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=teammate, role='member')
        task = Task.objects.create(workspace=self.workspace, title='Prepare launch handoff')
        response = self.client.post(
            reverse('follow-up-list', args=[self.workspace.id]),
            data=json.dumps({'note': 'Confirm launch approval', 'assigned_to': teammate.id, 'due_date': '2026-09-04', 'task_id': task.id}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['follow_up']['assigned_to'], teammate.id)
        self.assertEqual(response.json()['follow_up']['task_id'], task.id)
        self.assertEqual(response.json()['follow_up']['assigned_to_name'], 'follow-up-member@example.com')
        self.assertEqual(WorkspaceNotification.objects.filter(recipient=teammate, kind='follow_up_assigned').count(), 1)
        self.assertEqual(ActivityEvent.objects.filter(workspace=self.workspace, kind='follow_up_created').count(), 1)

        follow_up_id = response.json()['follow_up']['id']
        update_response = self.client.patch(
            reverse('follow-up-detail', args=[follow_up_id]),
            data=json.dumps({'assigned_to': None}),
            content_type='application/json',
        )
        self.assertEqual(update_response.status_code, 200)
        self.assertIsNone(update_response.json()['follow_up']['assigned_to'])
        self.assertEqual(ActivityEvent.objects.filter(workspace=self.workspace, kind='follow_up_assigned').count(), 1)

    def test_follow_up_reassignment_records_activity_history(self):
        first_teammate = User.objects.create_user(username='reassign-first@example.com', email='reassign-first@example.com', password='secure-pass-123')
        second_teammate = User.objects.create_user(username='reassign-second@example.com', email='reassign-second@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=first_teammate, role='member')
        Membership.objects.create(workspace=self.workspace, user=second_teammate, role='member')
        follow_up_id = self.client.post(
            reverse('follow-up-list', args=[self.workspace.id]),
            data=json.dumps({'note': 'Confirm rollout', 'assigned_to': first_teammate.id}),
            content_type='application/json',
        ).json()['follow_up']['id']

        reassign_response = self.client.patch(
            reverse('follow-up-detail', args=[follow_up_id]),
            data=json.dumps({'assigned_to': second_teammate.id}),
            content_type='application/json',
        )
        self.assertEqual(reassign_response.status_code, 200)
        self.assertEqual(ActivityEvent.objects.filter(workspace=self.workspace, kind='follow_up_assigned').count(), 1)
        self.assertEqual(WorkspaceNotification.objects.filter(recipient=second_teammate, kind='follow_up_assigned').count(), 1)

        unassign_response = self.client.patch(
            reverse('follow-up-detail', args=[follow_up_id]),
            data=json.dumps({'assigned_to': None}),
            content_type='application/json',
        )
        self.assertEqual(unassign_response.status_code, 200)
        self.assertEqual(ActivityEvent.objects.filter(workspace=self.workspace, kind='follow_up_assigned').count(), 2)
        self.assertEqual(WorkspaceNotification.objects.filter(kind='follow_up_assigned').count(), 2)

    def test_follow_up_due_date_change_records_activity(self):
        follow_up_id = self.client.post(
            reverse('follow-up-list', args=[self.workspace.id]),
            data=json.dumps({'note': 'Confirm budget sign-off'}),
            content_type='application/json',
        ).json()['follow_up']['id']

        set_response = self.client.patch(
            reverse('follow-up-detail', args=[follow_up_id]),
            data=json.dumps({'due_date': '2026-09-10'}),
            content_type='application/json',
        )
        self.assertEqual(set_response.status_code, 200)
        self.assertEqual(set_response.json()['follow_up']['due_date'], '2026-09-10')
        self.assertEqual(ActivityEvent.objects.filter(workspace=self.workspace, kind='follow_up_due_date').count(), 1)

        clear_response = self.client.patch(
            reverse('follow-up-detail', args=[follow_up_id]),
            data=json.dumps({'due_date': None}),
            content_type='application/json',
        )
        self.assertEqual(clear_response.status_code, 200)
        self.assertIsNone(clear_response.json()['follow_up']['due_date'])
        self.assertEqual(ActivityEvent.objects.filter(workspace=self.workspace, kind='follow_up_due_date').count(), 2)

    def test_follow_up_completion_notifies_creator_and_records_activity(self):
        teammate = User.objects.create_user(username='completion-member@example.com', email='completion-member@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=teammate, role='member')
        response = self.client.post(
            reverse('follow-up-list', args=[self.workspace.id]),
            data=json.dumps({'note': 'Confirm handoff', 'assigned_to': teammate.id}),
            content_type='application/json',
        )
        self.client.force_login(teammate)
        update_response = self.client.patch(
            reverse('follow-up-detail', args=[response.json()['follow_up']['id']]),
            data=json.dumps({'status': 'completed'}),
            content_type='application/json',
        )
        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(WorkspaceNotification.objects.filter(recipient=self.user, kind='follow_up_completed').count(), 1)
        self.assertEqual(ActivityEvent.objects.filter(workspace=self.workspace, kind='follow_up_status').count(), 1)
        reopen_response = self.client.patch(
            reverse('follow-up-detail', args=[response.json()['follow_up']['id']]),
            data=json.dumps({'status': 'open'}),
            content_type='application/json',
        )
        self.assertEqual(reopen_response.status_code, 200)
        self.assertEqual(reopen_response.json()['follow_up']['status'], 'open')
        self.assertEqual(ActivityEvent.objects.filter(workspace=self.workspace, kind='follow_up_status').count(), 2)

    def test_follow_up_permissions_limit_member_edits(self):
        creator_follow_up = self.client.post(
            reverse('follow-up-list', args=[self.workspace.id]),
            data=json.dumps({'note': 'Review the contract'}),
            content_type='application/json',
        ).json()['follow_up']
        teammate = User.objects.create_user(username='follow-up-outsider@example.com', email='follow-up-outsider@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=teammate, role='member')
        self.client.force_login(teammate)

        forbidden_response = self.client.patch(
            reverse('follow-up-detail', args=[creator_follow_up['id']]),
            data=json.dumps({'status': 'completed'}),
            content_type='application/json',
        )
        self.assertEqual(forbidden_response.status_code, 403)

        self.client.force_login(self.user)
        assigned_response = self.client.post(
            reverse('follow-up-list', args=[self.workspace.id]),
            data=json.dumps({'note': 'Confirm the handoff', 'assigned_to': teammate.id}),
            content_type='application/json',
        ).json()['follow_up']
        self.client.force_login(teammate)
        allowed_response = self.client.patch(
            reverse('follow-up-detail', args=[assigned_response['id']]),
            data=json.dumps({'status': 'completed'}),
            content_type='application/json',
        )
        self.assertEqual(allowed_response.status_code, 200)
        reassignment_response = self.client.patch(
            reverse('follow-up-detail', args=[assigned_response['id']]),
            data=json.dumps({'assigned_to': None}),
            content_type='application/json',
        )
        self.assertEqual(reassignment_response.status_code, 403)

        delete_response = self.client.delete(reverse('follow-up-detail', args=[creator_follow_up['id']]))
        self.assertEqual(delete_response.status_code, 403)
        self.client.force_login(self.user)
        owner_delete_response = self.client.delete(reverse('follow-up-detail', args=[creator_follow_up['id']]))
        self.assertEqual(owner_delete_response.status_code, 200)
        self.assertTrue(ActivityEvent.objects.filter(workspace=self.workspace, kind='follow_up_deleted').exists())

    def test_task_attachment_upload_is_scoped_and_validated(self):
        task = Task.objects.create(workspace=self.workspace, title='Attach brief')
        upload = SimpleUploadedFile('brief.txt', b'project notes', content_type='text/plain')
        response = self.client.post(reverse('task-attachment-list', args=[task.id]), data={'file': upload})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['attachment']['original_name'], 'brief.txt')
        attachment = TaskAttachment.objects.get()
        self.assertEqual(self.client.get(reverse('task-attachment-list', args=[task.id])).json()['attachments'][0]['id'], attachment.id)
        delete_response = self.client.delete(reverse('task-attachment-detail', args=[attachment.id]))
        self.assertEqual(delete_response.status_code, 200)
        self.assertFalse(TaskAttachment.objects.exists())
        self.assertTrue(ActivityEvent.objects.filter(workspace=self.workspace, kind='task_attachment_deleted').exists())

    def test_archiving_task_retains_attachment_and_permanent_delete_removes_it(self):
        task = Task.objects.create(workspace=self.workspace, title='Delete attachment with task')
        attachment = TaskAttachment.objects.create(
            task=task,
            uploaded_by=self.user,
            file=SimpleUploadedFile('cleanup.txt', b'private notes', content_type='text/plain'),
            original_name='cleanup.txt',
        )
        file_path = Path(attachment.file.path)
        response = self.client.delete(reverse('task-detail', args=[task.id]))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(file_path.exists())
        self.assertTrue(TaskAttachment.objects.filter(id=attachment.id).exists())
        response = self.client.delete(f"{reverse('task-detail', args=[task.id])}?permanent=true")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(file_path.exists())
        self.assertFalse(TaskAttachment.objects.filter(id=attachment.id).exists())

    def test_members_cannot_delete_attachments_on_unassigned_tasks(self):
        task = Task.objects.create(workspace=self.workspace, title='Owner task', assignee=self.user)
        upload = SimpleUploadedFile('owner-notes.txt', b'private notes', content_type='text/plain')
        attachment = TaskAttachment.objects.create(task=task, uploaded_by=self.user, file=upload, original_name='owner-notes.txt')
        teammate = User.objects.create_user(username='attachment-member@example.com', email='attachment-member@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=teammate, role='member')
        self.client.force_login(teammate)
        download_response = self.client.get(reverse('task-attachment-download', args=[attachment.id]))
        self.assertEqual(download_response.status_code, 200)
        upload_response = self.client.post(
            reverse('task-attachment-list', args=[Task.objects.create(workspace=self.workspace, title='Unassigned task').id]),
            data={'file': SimpleUploadedFile('member-notes.txt', b'private notes', content_type='text/plain')},
        )
        self.assertEqual(upload_response.status_code, 403)
        outsider = User.objects.create_user(username='outside@example.com', email='outside@example.com', password='secure-pass-123')
        self.client.force_login(outsider)
        outside_download = self.client.get(reverse('task-attachment-download', args=[attachment.id]))
        self.assertEqual(outside_download.status_code, 404)
        self.client.force_login(teammate)
        response = self.client.delete(reverse('task-attachment-detail', args=[attachment.id]))
        self.assertEqual(response.status_code, 403)
        self.assertTrue(TaskAttachment.objects.filter(id=attachment.id).exists())
        missing = TaskAttachment.objects.create(task=task, uploaded_by=self.user, file='task-attachments/missing.txt', original_name='missing.txt')
        self.client.force_login(self.user)
        missing_response = self.client.get(reverse('task-attachment-download', args=[missing.id]))
        self.assertEqual(missing_response.status_code, 404)
        missing.delete()

    def test_calendar_reminders_and_ics_export(self):
        create_response = self.client.post(
            reverse('calendar-event-list', args=[self.workspace.id]),
            data=json.dumps({'title': 'Planning', 'start_at': '2026-09-02T10:00:00Z', 'end_at': '2026-09-02T10:30:00Z', 'reminder_minutes': 30}),
            content_type='application/json',
        )
        self.assertEqual(create_response.status_code, 201)
        event_id = create_response.json()['event']['id']
        self.assertEqual(create_response.json()['event']['reminder_minutes'], 30)
        invalid_response = self.client.patch(reverse('calendar-event-detail', args=[self.workspace.id, event_id]), data=json.dumps({'reminder_minutes': -1}), content_type='application/json')
        self.assertEqual(invalid_response.status_code, 400)
        ics_response = self.client.get(reverse('calendar-ics', args=[self.workspace.id]))
        self.assertEqual(ics_response.status_code, 200)
        self.assertEqual(ics_response['Content-Type'], 'text/calendar; charset=utf-8')
        ics_body = ics_response.content.decode()
        self.assertIn('CALSCALE:GREGORIAN', ics_body)
        self.assertIn('METHOD:PUBLISH', ics_body)
        self.assertIn('SUMMARY:Planning', ics_body)

    def test_calendar_reminder_is_delivered_once_when_due(self):
        start_at = timezone.now() + timedelta(minutes=10)
        event = CalendarEvent.objects.create(
            workspace=self.workspace,
            title='Reminder review',
            start_at=start_at,
            end_at=start_at + timedelta(minutes=30),
            reminder_minutes=15,
            created_by=self.user,
        )
        first_response = self.client.get(reverse('calendar-event-list', args=[self.workspace.id]))
        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(WorkspaceNotification.objects.filter(kind='calendar_reminder', recipient=self.user).count(), 1)
        event.refresh_from_db()
        self.assertIsNotNone(event.reminder_sent_at)
        self.client.get(reverse('calendar-event-list', args=[self.workspace.id]))
        self.assertEqual(WorkspaceNotification.objects.filter(kind='calendar_reminder', recipient=self.user).count(), 1)

    def test_reminder_command_delivers_due_workspace_reminders(self):
        start_at = timezone.now() + timedelta(minutes=10)
        CalendarEvent.objects.create(
            workspace=self.workspace,
            title='Worker reminder',
            start_at=start_at,
            end_at=start_at + timedelta(minutes=30),
            reminder_minutes=15,
            created_by=self.user,
        )
        output = StringIO()
        call_command('deliver_calendar_reminders', stdout=output)
        self.assertEqual(WorkspaceNotification.objects.filter(kind='calendar_reminder', recipient=self.user).count(), 1)
        self.assertIn('Delivered 1 calendar reminder(s).', output.getvalue())

    def test_report_summary_returns_workspace_metrics(self):
        Task.objects.create(workspace=self.workspace, title='Blocked work', status='blocked', assignee=self.user)
        Task.objects.create(workspace=self.workspace, title='Finished work', status='done', assignee=self.user)
        response = self.client.get(reverse('report-summary', args=[self.workspace.id]))
        self.assertEqual(response.status_code, 200)
        summary = response.json()['summary']
        self.assertEqual(summary['total_tasks'], 2)
        self.assertEqual(summary['blocked_tasks'], 1)
        self.assertEqual(summary['status_counts']['done'], 1)
        self.assertEqual(summary['workload'][0]['open'], 1)

    def test_member_task_permissions_are_scoped_by_assignment(self):
        teammate = User.objects.create_user(username='member@example.com', email='member@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=teammate, role='member')
        task = Task.objects.create(workspace=self.workspace, title='Owner task', assignee=self.user)
        assigned_task = Task.objects.create(workspace=self.workspace, title='Member task', assignee=teammate)
        self.client.force_login(teammate)
        update_response = self.client.patch(reverse('task-detail', args=[task.id]), data=json.dumps({'status': 'done'}), content_type='application/json')
        self.assertEqual(update_response.status_code, 403)
        reassign_response = self.client.patch(reverse('task-detail', args=[assigned_task.id]), data=json.dumps({'assignee_id': self.user.id}), content_type='application/json')
        self.assertEqual(reassign_response.status_code, 403)
        member_update = self.client.patch(reverse('task-detail', args=[assigned_task.id]), data=json.dumps({'title': 'Member task updated', 'status': 'in_progress'}), content_type='application/json')
        self.assertEqual(member_update.status_code, 200)
        self.assertEqual(member_update.json()['task']['title'], 'Member task updated')
        delete_response = self.client.delete(reverse('task-detail', args=[task.id]))
        self.assertEqual(delete_response.status_code, 403)

    def test_audit_logs_are_visible_to_workspace_leaders_only(self):
        self.client.post(
            reverse('task-list'),
            data=json.dumps({'title': 'Audited task'}),
            content_type='application/json',
            HTTP_X_WORKSPACE_ID=str(self.workspace.id),
        )
        response = self.client.get(reverse('audit-log-list', args=[self.workspace.id]))
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(response.json()['audit_logs']), 1)
        teammate = User.objects.create_user(username='member@example.com', email='member@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=teammate, role='member')
        self.client.force_login(teammate)
        denied = self.client.get(reverse('audit-log-list', args=[self.workspace.id]))
        self.assertEqual(denied.status_code, 403)
        self.assertTrue(AuditLog.objects.filter(workspace=self.workspace).exists())

    def test_owner_can_cancel_pending_invitation(self):
        invitation = WorkspaceInvitation.objects.create(
            workspace=self.workspace,
            email='cancel@example.com',
            invited_by=self.user,
            role='member',
        )
        response = self.client.delete(reverse('invitation-detail', args=[self.workspace.id, invitation.id]))
        self.assertEqual(response.status_code, 200)
        invitation.refresh_from_db()
        self.assertEqual(invitation.status, 'cancelled')
        self.assertTrue(ActivityEvent.objects.filter(workspace=self.workspace, kind='invitation_cancelled').exists())

    def test_user_cannot_read_another_workspace_tasks(self):
        other_user = User.objects.create_user(username='other@example.com', email='other@example.com', password='secure-pass-123')
        other_workspace = Workspace.objects.create(name='Other', slug='other')
        Membership.objects.create(workspace=other_workspace, user=other_user, role='owner')
        Task.objects.create(title='Private task', workspace=other_workspace)

        response = self.client.get(reverse('task-list'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['tasks'], [])

    def test_task_list_is_scoped_to_the_requested_workspace(self):
        other_workspace = Workspace.objects.create(name='Sister', slug='sister')
        Membership.objects.create(workspace=other_workspace, user=self.user, role='owner')
        Task.objects.create(workspace=self.workspace, title='Northstar task')
        Task.objects.create(workspace=other_workspace, title='Sister task')

        scoped_response = self.client.get(reverse('task-list'), HTTP_X_WORKSPACE_ID=str(self.workspace.id))
        self.assertEqual(scoped_response.status_code, 200)
        self.assertEqual([task['title'] for task in scoped_response.json()['tasks']], ['Northstar task'])

        other_response = self.client.get(reverse('task-list'), HTTP_X_WORKSPACE_ID=str(other_workspace.id))
        self.assertEqual(other_response.status_code, 200)
        self.assertEqual([task['title'] for task in other_response.json()['tasks']], ['Sister task'])

    def test_task_list_rejects_a_workspace_the_user_does_not_belong_to(self):
        other_workspace = Workspace.objects.create(name='Foreign', slug='foreign')
        response = self.client.get(reverse('task-list'), HTTP_X_WORKSPACE_ID=str(other_workspace.id))
        self.assertEqual(response.status_code, 403)

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

    def test_check_in_records_activity_and_notifies_leaders_of_blockers(self):
        teammate = User.objects.create_user(username='checkin-member@example.com', email='checkin-member@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=teammate, role='member')
        self.client.force_login(teammate)
        response = self.client.post(
            reverse('check-in-list', args=[self.workspace.id]),
            data=json.dumps({'date': '2026-09-02', 'completed': 'Reviewed the brief.', 'blockers': 'Waiting on approval.'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(ActivityEvent.objects.filter(workspace=self.workspace, kind='check_in_submitted').count(), 1)
        self.assertEqual(WorkspaceNotification.objects.filter(recipient=self.user, kind='check_in_blocker').count(), 1)

    def test_check_in_rejects_oversized_text(self):
        response = self.client.post(
            reverse('check-in-list', args=[self.workspace.id]),
            data=json.dumps({'date': '2026-09-02', 'completed': 'x' * 4001}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('4000 characters', response.json()['error'])
        self.assertEqual(CheckIn.objects.count(), 0)

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

    def test_owner_can_create_project_with_due_date(self):
        response = self.client.post(
            reverse('project-list', args=[self.workspace.id]),
            data=json.dumps({'name': 'Website refresh', 'description': 'Refresh the public site.', 'due_date': '2026-10-15'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['project']['due_date'], '2026-10-15')
        self.assertTrue(ActivityEvent.objects.filter(workspace=self.workspace, kind='project_created').exists())

        invalid_response = self.client.post(
            reverse('project-list', args=[self.workspace.id]),
            data=json.dumps({'name': 'Invalid date project', 'due_date': '15-10-2026'}),
            content_type='application/json',
        )
        self.assertEqual(invalid_response.status_code, 400)

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

    def test_members_can_only_manage_their_own_calendar_events(self):
        teammate = User.objects.create_user(username='calendar-member@example.com', email='calendar-member@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=teammate, role='member')
        event = CalendarEvent.objects.create(
            workspace=self.workspace,
            title='Owner event',
            start_at=timezone.now() + timedelta(hours=1),
            end_at=timezone.now() + timedelta(hours=2),
            created_by=self.user,
        )
        self.client.force_login(teammate)
        denied_update = self.client.patch(
            reverse('calendar-event-detail', args=[self.workspace.id, event.id]),
            data=json.dumps({'title': 'Changed by member'}),
            content_type='application/json',
        )
        self.assertEqual(denied_update.status_code, 403)
        denied_delete = self.client.delete(reverse('calendar-event-detail', args=[self.workspace.id, event.id]))
        self.assertEqual(denied_delete.status_code, 403)


    def test_task_template_create_list_apply_and_delete(self):
        create = self.client.post(
            reverse('task-template-list', args=[self.workspace.id]),
            data=json.dumps({'name': 'Weekly ops', 'title': 'Run weekly ops', 'priority': 'normal', 'bucket': 'Backlog', 'recurrence': 'weekly'}),
            content_type='application/json',
        )
        self.assertEqual(create.status_code, 201)
        template_id = create.json()['task_template']['id']
        listing = self.client.get(reverse('task-template-list', args=[self.workspace.id]))
        self.assertEqual(len(listing.json()['task_templates']), 1)
        apply = self.client.post(reverse('task-template-apply', args=[self.workspace.id, template_id]))
        self.assertEqual(apply.status_code, 201)
        self.assertEqual(apply.json()['task']['title'], 'Run weekly ops')
        delete = self.client.delete(reverse('task-template-detail', args=[self.workspace.id, template_id]))
        self.assertEqual(delete.status_code, 200)

    def test_project_template_create_list_apply_and_delete(self):
        create = self.client.post(
            reverse('project-template-list', args=[self.workspace.id]),
            data=json.dumps({'name': 'Launch playbook', 'project_name': 'Product launch', 'description': 'Run a launch', 'due_days': 21}),
            content_type='application/json',
        )
        self.assertEqual(create.status_code, 201)
        template_id = create.json()['project_template']['id']
        listing = self.client.get(reverse('project-template-list', args=[self.workspace.id]))
        self.assertEqual(len(listing.json()['project_templates']), 1)
        apply = self.client.post(reverse('project-template-apply', args=[self.workspace.id, template_id]))
        self.assertEqual(apply.status_code, 201)
        self.assertEqual(apply.json()['project']['name'], 'Product launch')
        delete = self.client.delete(reverse('project-template-detail', args=[self.workspace.id, template_id]))
        self.assertEqual(delete.status_code, 200)
class ExecutionFoundationApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username='lead@example.com', email='lead@example.com', password='secure-pass-123')
        self.member = User.objects.create_user(username='executor@example.com', email='executor@example.com', password='secure-pass-123')
        self.supporter = User.objects.create_user(username='support@example.com', email='support@example.com', password='secure-pass-123')
        self.workspace = Workspace.objects.create(name='Delivery', slug='delivery')
        Membership.objects.create(workspace=self.workspace, user=self.owner, role='owner')
        Membership.objects.create(workspace=self.workspace, user=self.member, role='member')
        Membership.objects.create(workspace=self.workspace, user=self.supporter, role='member')
        self.client.force_login(self.owner)

    def create_task(self, **overrides):
        payload = {'title': 'Delivery task', **overrides}
        return self.client.post(reverse('task-list'), data=json.dumps(payload), content_type='application/json', HTTP_X_WORKSPACE_ID=str(self.workspace.id))

    def test_project_execution_configuration_round_trip(self):
        response = self.client.post(reverse('project-list', args=[self.workspace.id]), data=json.dumps({
            'name': 'Q4 launch', 'start_date': '2026-10-01', 'end_date': '2026-12-15',
            'timezone': 'America/New_York', 'week_anchor_date': '2026-09-28',
            'due_soon_days': 10, 'configuration': {'reporting_currency': 'GBP'},
        }), content_type='application/json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['project']['configuration']['reporting_currency'], 'GBP')
        self.assertEqual(response.json()['project']['timezone'], 'America/New_York')

    def test_task_code_is_generated_unique_and_not_reused_after_hard_delete(self):
        first = self.create_task().json()['task']
        self.client.delete(f"{reverse('task-detail', args=[first['id']])}?permanent=true")
        second = self.create_task(title='Second task').json()['task']
        self.assertNotEqual(first['task_code'], second['task_code'])
        self.assertTrue(TaskCodeRegistry.objects.filter(workspace=self.workspace, code=first['task_code']).exists())

    def test_task_validation_rules(self):
        invalid_range = self.create_task(start_date='2026-09-10', due_date='2026-09-09')
        self.assertEqual(invalid_range.status_code, 400)
        blocked = self.create_task(title='Blocked', status='blocked')
        self.assertEqual(blocked.status_code, 400)
        progress = self.create_task(title='Bad progress', progress_percent=101)
        self.assertEqual(progress.status_code, 400)
        completed = self.create_task(title='Complete', status='done')
        self.assertEqual(completed.status_code, 201)
        self.assertEqual(completed.json()['task']['progress_percent'], 100)

    def test_normalized_supporters_and_lookup_values(self):
        project = Project.objects.create(workspace=self.workspace, name='Launch')
        lookup_response = self.client.post(reverse('lookup-value-list', args=[self.workspace.id]), data=json.dumps({'kind': 'workstream', 'name': 'Engineering', 'project_id': project.id}), content_type='application/json')
        self.assertEqual(lookup_response.status_code, 201)
        lookup_id = lookup_response.json()['lookup_value']['id']
        response = self.create_task(project_id=project.id, workstream_id=lookup_id, supporter_ids=[self.supporter.id])
        self.assertEqual(response.status_code, 201)
        task = Task.objects.get(id=response.json()['task']['id'])
        self.assertTrue(TaskSupporter.objects.filter(task=task, user=self.supporter).exists())
        self.assertEqual(task.workstream_ref_id, lookup_id)

    def test_task_filtering_pagination_sorting_and_operations_scope(self):
        project = Project.objects.create(workspace=self.workspace, name='Launch', due_soon_days=30)
        operation = self.create_task(title='Operations alpha', assignee_id=self.member.id, supporter_ids=[self.supporter.id], due_date=(timezone.localdate() - timedelta(days=1)).isoformat()).json()['task']
        self.create_task(title='Project beta', project_id=project.id, priority='high')
        response = self.client.get(reverse('workspace-task-list', args=[self.workspace.id]), {'scope': 'operations', 'owner': self.member.id, 'supporter': self.supporter.id, 'overdue': 'true', 'search': 'alpha', 'sort': 'title', 'page_size': 1})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item['id'] for item in response.json()['tasks']], [operation['id']])
        self.assertEqual(response.json()['pagination']['total_items'], 1)

    def test_owner_changes_are_recorded_with_values_and_actor(self):
        task_id = self.create_task(assignee_id=self.member.id).json()['task']['id']
        response = self.client.patch(reverse('task-detail', args=[task_id]), data=json.dumps({'priority': 'high', 'progress_percent': 40}), content_type='application/json')
        self.assertEqual(response.status_code, 200)
        changes = TaskChangeHistory.objects.filter(task_id=task_id)
        self.assertTrue(changes.filter(field='priority', previous_value='normal', new_value='high', actor=self.owner).exists())
        self.assertTrue(changes.filter(field='progress_percent', previous_value=0, new_value=40).exists())

    def test_task_owner_can_update_execution_but_supporter_cannot(self):
        task_id = self.create_task(assignee_id=self.member.id, supporter_ids=[self.supporter.id]).json()['task']['id']
        self.client.force_login(self.member)
        allowed = self.client.patch(reverse('task-detail', args=[task_id]), data=json.dumps({'progress_percent': 25}), content_type='application/json')
        self.assertEqual(allowed.status_code, 200)
        denied_ownership = self.client.patch(reverse('task-detail', args=[task_id]), data=json.dumps({'assignee_id': self.supporter.id}), content_type='application/json')
        self.assertEqual(denied_ownership.status_code, 403)
        self.client.force_login(self.supporter)
        denied_execution = self.client.patch(reverse('task-detail', args=[task_id]), data=json.dumps({'progress_percent': 50}), content_type='application/json')
        self.assertEqual(denied_execution.status_code, 403)

    def test_authenticated_risk_issue_api_and_permissions(self):
        project = Project.objects.create(workspace=self.workspace, name='Launch')
        response = self.client.post(reverse('risk-issue-list', args=[self.workspace.id]), data=json.dumps({'project_id': project.id, 'kind': 'risk', 'title': 'Supplier delay', 'severity': 'high', 'owner_id': self.member.id, 'due': '2026-10-01'}), content_type='application/json')
        self.assertEqual(response.status_code, 201)
        record_id = response.json()['record']['id']
        self.client.force_login(self.supporter)
        self.assertEqual(self.client.get(reverse('risk-issue-list', args=[self.workspace.id]), {'project_id': project.id}).status_code, 200)
        denied = self.client.patch(reverse('risk-issue-detail', args=[self.workspace.id, record_id]), data=json.dumps({'status': 'mitigated'}), content_type='application/json')
        self.assertEqual(denied.status_code, 403)
        self.client.force_login(self.member)
        allowed = self.client.patch(reverse('risk-issue-detail', args=[self.workspace.id, record_id]), data=json.dumps({'status': 'mitigated'}), content_type='application/json')
        self.assertEqual(allowed.status_code, 200)


class AuthenticationApiTests(TestCase):
    def test_authenticated_user_can_discover_pending_invitations_for_their_email(self):
        owner = User.objects.create_user(username='owner@example.com', email='owner@example.com', password='secure-pass-123')
        workspace = Workspace.objects.create(name='Northstar', slug='northstar')
        Membership.objects.create(workspace=workspace, user=owner, role='owner')
        invitation = WorkspaceInvitation.objects.create(workspace=workspace, email='invitee@example.com', invited_by=owner, role='member')
        invitee = User.objects.create_user(username='invitee@example.com', email='invitee@example.com', password='secure-pass-123')
        self.client.force_login(invitee)
        response = self.client.get(reverse('auth-me'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['user']['pending_invitations'][0]['id'], invitation.id)

    def test_signup_creates_user_workspace_and_session(self):
        response = self.client.post(
            reverse('auth-me'),
            data=json.dumps({'email': 'owner@example.com', 'password': 'secure-pass-123', 'workspace_name': 'Northstar'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()['authenticated'])
        self.assertEqual(response.json()['user']['workspaces'][0]['role'], 'owner')

    def test_signup_rejects_invalid_email_and_weak_password(self):
        invalid_email = self.client.post(
            reverse('auth-me'),
            data=json.dumps({'email': 'not-an-email', 'password': 'secure-pass-123'}),
            content_type='application/json',
        )
        self.assertEqual(invalid_email.status_code, 400)
        weak_password = self.client.post(
            reverse('auth-me'),
            data=json.dumps({'email': 'new-owner@example.com', 'password': 'password'}),
            content_type='application/json',
        )
        self.assertEqual(weak_password.status_code, 400)
        similar_password = self.client.post(
            reverse('auth-me'),
            data=json.dumps({'email': 'similar-owner@example.com', 'password': 'similar-owner@example.com-123'}),
            content_type='application/json',
        )
        self.assertEqual(similar_password.status_code, 400)

    def test_signup_rejects_oversized_profile_fields(self):
        response = self.client.post(
            reverse('auth-me'),
            data=json.dumps({'email': 'new-owner@example.com', 'password': 'secure-pass-123', 'workspace_name': 'x' * 121}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)

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


class WorkShiftApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='clock@example.com', email='clock@example.com', password='secure-pass-123')
        self.other = User.objects.create_user(username='mate@example.com', email='mate@example.com', password='secure-pass-123')
        self.workspace = Workspace.objects.create(name='Northstar', slug='northstar-clock')
        Membership.objects.create(workspace=self.workspace, user=self.user, role='owner')
        Membership.objects.create(workspace=self.workspace, user=self.other, role='member')
        self.client.login(username='clock@example.com', password='secure-pass-123')
        self.url = reverse('work-shift-list', args=[self.workspace.id])

    def post(self, action, **extra):
        return self.client.post(self.url, data=json.dumps({'action': action, **extra}), content_type='application/json')

    def test_clock_in_then_out_records_worked_time(self):
        response = self.post('clock_in')
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()['work_shift']['is_open'])

        shift = WorkShift.objects.get(user=self.user)
        shift.started_at = timezone.now() - timedelta(hours=2)
        shift.save(update_fields=['started_at'])

        out_response = self.post('clock_out')
        self.assertEqual(out_response.status_code, 200)
        payload = out_response.json()['work_shift']
        self.assertFalse(payload['is_open'])
        self.assertGreaterEqual(payload['worked_seconds'], 7190)
        self.assertTrue(ActivityEvent.objects.filter(workspace=self.workspace, kind='clocked_out').exists())

    def test_break_time_is_excluded_from_worked_seconds(self):
        self.post('clock_in')
        shift = WorkShift.objects.get(user=self.user)
        shift.started_at = timezone.now() - timedelta(hours=1)
        shift.save(update_fields=['started_at'])

        self.assertEqual(self.post('start_break').status_code, 200)
        shift.refresh_from_db()
        shift.break_started_at = timezone.now() - timedelta(minutes=15)
        shift.save(update_fields=['break_started_at'])

        resume = self.post('end_break')
        self.assertEqual(resume.status_code, 200)
        self.assertFalse(resume.json()['work_shift']['is_on_break'])

        payload = self.post('clock_out').json()['work_shift']
        self.assertGreaterEqual(payload['break_seconds'], 890)
        self.assertLess(payload['worked_seconds'], 2760)

    def test_double_clock_in_is_rejected(self):
        self.assertEqual(self.post('clock_in').status_code, 201)
        self.assertEqual(self.post('clock_in').status_code, 409)

    def test_clock_out_without_open_shift_is_rejected(self):
        self.assertEqual(self.post('clock_out').status_code, 409)
        self.assertEqual(self.post('end_break').status_code, 409)

    def test_unknown_action_is_rejected(self):
        self.assertEqual(self.post('nap').status_code, 400)

    def test_list_returns_todays_workspace_shifts(self):
        self.post('clock_in')
        self.client.force_login(self.other)
        self.post('clock_in')
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()['work_shifts']), 2)

        mine = self.client.get(f'{self.url}?mine=1')
        self.assertEqual(len(mine.json()['work_shifts']), 1)
        self.assertEqual(mine.json()['work_shifts'][0]['user_id'], self.other.id)

    def test_non_member_cannot_clock_in(self):
        outsider = User.objects.create_user(username='out@example.com', email='out@example.com', password='secure-pass-123')
        self.client.force_login(outsider)
        self.assertEqual(self.post('clock_in').status_code, 403)

    def test_invalid_date_filter_is_rejected(self):
        self.assertEqual(self.client.get(f'{self.url}?date=notadate').status_code, 400)

    def test_open_break_is_banked_only_in_total(self):
        self.post('clock_in')
        self.post('start_break')
        shift = WorkShift.objects.get(user=self.user)
        shift.break_started_at = timezone.now() - timedelta(minutes=10)
        shift.save(update_fields=['break_started_at'])

        payload = self.client.get(f'{self.url}?mine=1').json()['work_shifts'][0]
        self.assertTrue(payload['is_on_break'])
        self.assertEqual(payload['break_seconds'], 0)
        self.assertGreaterEqual(payload['break_seconds_total'], 590)

    def test_break_preset_is_recorded_and_cleared(self):
        self.post('clock_in')
        response = self.post('start_break', minutes=30)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['work_shift']['break_plan_minutes'], 30)

        resumed = self.post('end_break')
        self.assertEqual(resumed.json()['work_shift']['break_plan_minutes'], 0)

        self.assertEqual(self.post('start_break', minutes=60).json()['work_shift']['break_plan_minutes'], 60)
        self.assertEqual(self.post('clock_out').json()['work_shift']['break_plan_minutes'], 0)

    def test_break_preset_must_be_a_supported_length(self):
        self.post('clock_in')
        response = self.post('start_break', minutes=45)
        self.assertEqual(response.status_code, 400)
        self.assertFalse(WorkShift.objects.get(user=self.user).is_on_break)

    def test_open_ended_break_is_still_allowed(self):
        self.post('clock_in')
        response = self.post('start_break')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['work_shift']['break_plan_minutes'], 0)

    def test_report_summary_includes_time_clock_totals(self):
        self.post('clock_in')
        shift = WorkShift.objects.get(user=self.user)
        shift.started_at = timezone.now() - timedelta(hours=3)
        shift.save(update_fields=['started_at'])
        self.post('clock_out')

        response = self.client.get(reverse('report-summary', args=[self.workspace.id]))
        self.assertEqual(response.status_code, 200)
        time_clock = response.json()['summary']['time_clock']
        self.assertEqual(time_clock['shift_count'], 1)
        self.assertEqual(time_clock['open_shifts'], 0)
        self.assertGreaterEqual(time_clock['total_seconds'], 10790)
        self.assertEqual(time_clock['by_member'][0]['user_id'], self.user.id)
        self.assertEqual(time_clock['by_member'][0]['day_count'], 1)
        self.assertEqual(len(time_clock['recent']), 1)

    def test_report_summary_time_clock_respects_range(self):
        old_shift = WorkShift.objects.create(
            workspace=self.workspace,
            user=self.user,
            date=timezone.localdate() - timedelta(days=40),
            started_at=timezone.now() - timedelta(days=40),
            ended_at=timezone.now() - timedelta(days=40) + timedelta(hours=4),
        )
        self.assertFalse(old_shift.is_open)

        all_time = self.client.get(reverse('report-summary', args=[self.workspace.id])).json()['summary']['time_clock']
        self.assertEqual(all_time['shift_count'], 1)

        this_week = self.client.get(f"{reverse('report-summary', args=[self.workspace.id])}?range=week").json()['summary']['time_clock']
        self.assertEqual(this_week['shift_count'], 0)
        self.assertEqual(this_week['total_seconds'], 0)
        self.assertEqual(this_week['average_seconds'], 0)


class TaskDependencyApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='dep@example.com', email='dep@example.com', password='secure-pass-123')
        self.workspace = Workspace.objects.create(name='Dependencies', slug='dependencies')
        Membership.objects.create(workspace=self.workspace, user=self.user, role='owner')
        self.client.login(username='dep@example.com', password='secure-pass-123')
        self.blocker = Task.objects.create(workspace=self.workspace, title='Ship the API', assignee=self.user)
        self.blocked = Task.objects.create(workspace=self.workspace, title='Write the docs', assignee=self.user)

    def patch_task(self, task, payload):
        return self.client.patch(
            reverse('task-detail', args=[task.id]),
            data=json.dumps(payload),
            content_type='application/json',
            HTTP_X_WORKSPACE_ID=str(self.workspace.id),
        )

    def test_set_and_clear_dependencies(self):
        response = self.patch_task(self.blocked, {'blocked_by_ids': [self.blocker.id]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['task']['blocked_by_ids'], [self.blocker.id])
        self.assertTrue(response.json()['task']['is_blocked_by_dependency'])

        blocker_view = self.client.get(reverse('task-detail', args=[self.blocker.id])).json()['task']
        self.assertEqual(blocker_view['blocking_ids'], [self.blocked.id])

        cleared = self.patch_task(self.blocked, {'blocked_by_ids': []})
        self.assertEqual(cleared.json()['task']['blocked_by_ids'], [])
        self.assertFalse(cleared.json()['task']['is_blocked_by_dependency'])

    def test_completed_blocker_stops_blocking(self):
        self.patch_task(self.blocked, {'blocked_by_ids': [self.blocker.id]})
        self.patch_task(self.blocker, {'status': 'done'})
        refreshed = self.client.get(reverse('task-detail', args=[self.blocked.id])).json()['task']
        self.assertEqual(refreshed['blocked_by_ids'], [self.blocker.id])
        self.assertFalse(refreshed['is_blocked_by_dependency'])

    def test_cancelled_blockers_are_hidden(self):
        self.patch_task(self.blocked, {'blocked_by_ids': [self.blocker.id]})
        self.patch_task(self.blocker, {'status': 'cancelled'})
        refreshed = self.client.get(reverse('task-detail', args=[self.blocked.id])).json()['task']
        self.assertEqual(refreshed['blocked_by_ids'], [])

    def test_archived_blockers_are_hidden(self):
        self.patch_task(self.blocked, {'blocked_by_ids': [self.blocker.id]})
        self.patch_task(self.blocker, {'state': 'archived'})
        refreshed = self.client.get(reverse('task-detail', args=[self.blocked.id])).json()['task']
        self.assertEqual(refreshed['blocked_by_ids'], [])

    def test_task_cannot_depend_on_itself(self):
        response = self.patch_task(self.blocked, {'blocked_by_ids': [self.blocked.id]})
        self.assertEqual(response.status_code, 400)
        self.assertIn('itself', response.json()['error'])

    def test_direct_cycle_is_rejected(self):
        self.patch_task(self.blocked, {'blocked_by_ids': [self.blocker.id]})
        response = self.patch_task(self.blocker, {'blocked_by_ids': [self.blocked.id]})
        self.assertEqual(response.status_code, 400)
        self.assertIn('circular', response.json()['error'])

    def test_cross_workspace_dependency_is_rejected(self):
        other_workspace = Workspace.objects.create(name='Other', slug='other-dep')
        outsider = Task.objects.create(workspace=other_workspace, title='Not yours')
        response = self.patch_task(self.blocked, {'blocked_by_ids': [outsider.id]})
        self.assertEqual(response.status_code, 404)

    def test_task_list_query_count_is_flat(self):
        """Dependency fields must come from the prefetch cache, not one query per task."""
        def count_queries():
            with CaptureQueriesContext(connection) as captured:
                response = self.client.get(reverse('task-list'), HTTP_X_WORKSPACE_ID=str(self.workspace.id))
                self.assertEqual(response.status_code, 200)
            return len(captured)

        baseline = count_queries()
        for index in range(20):
            filler = Task.objects.create(workspace=self.workspace, title=f'Filler {index}', assignee=self.user)
            filler.blocked_by.add(self.blocker)
        self.assertEqual(count_queries(), baseline, 'task list query count grew with the number of tasks')


class WorkspaceWebhookApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username='hookowner@example.com', email='hookowner@example.com', password='secure-pass-123')
        self.member = User.objects.create_user(username='hookmember@example.com', email='hookmember@example.com', password='secure-pass-123')
        self.workspace = Workspace.objects.create(name='Hooks', slug='hooks')
        Membership.objects.create(workspace=self.workspace, user=self.owner, role='owner')
        Membership.objects.create(workspace=self.workspace, user=self.member, role='member')
        self.client.login(username='hookowner@example.com', password='secure-pass-123')

    def create_webhook(self, **overrides):
        payload = {'kind': 'teams', 'url': 'https://example.com/hook', 'label': 'Team channel'}
        payload.update(overrides)
        return self.client.post(
            reverse('workspace-webhook-list', args=[self.workspace.id]),
            data=json.dumps(payload),
            content_type='application/json',
            HTTP_X_WORKSPACE_ID=str(self.workspace.id),
        )

    def test_create_list_and_delete_webhook(self):
        created = self.create_webhook()
        self.assertEqual(created.status_code, 201)
        webhook_id = created.json()['webhook']['id']

        listed = self.client.get(reverse('workspace-webhook-list', args=[self.workspace.id]))
        self.assertEqual(len(listed.json()['webhooks']), 1)

        deleted = self.client.delete(reverse('workspace-webhook-detail', args=[self.workspace.id, webhook_id]))
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(WorkspaceWebhook.objects.count(), 0)

    def test_webhook_url_must_be_https(self):
        self.assertEqual(self.create_webhook(url='http://example.com/insecure').status_code, 400)

    def test_webhook_kind_is_validated(self):
        self.assertEqual(self.create_webhook(kind='carrier-pigeon').status_code, 400)

    def test_members_cannot_manage_webhooks(self):
        self.client.logout()
        self.client.login(username='hookmember@example.com', password='secure-pass-123')
        self.assertEqual(self.create_webhook().status_code, 403)

    def test_webhook_can_be_disabled(self):
        webhook_id = self.create_webhook().json()['webhook']['id']
        response = self.client.patch(
            reverse('workspace-webhook-detail', args=[self.workspace.id, webhook_id]),
            data=json.dumps({'is_active': False}),
            content_type='application/json',
        )
        self.assertFalse(response.json()['webhook']['is_active'])

    def test_events_are_queued_for_active_webhooks_only(self):
        active = WorkspaceWebhook.objects.create(workspace=self.workspace, kind='teams', url='https://example.com/on')
        WorkspaceWebhook.objects.create(workspace=self.workspace, kind='slack', url='https://example.com/off', is_active=False)

        notify_workspace_webhooks(self.workspace.id, 'task_status', 'Task moved', 'Now in review', target_type='task', target_id='7')

        queued = list(WebhookDelivery.objects.all())
        self.assertEqual(len(queued), 1)
        self.assertEqual(queued[0].webhook_id, active.id)
        self.assertEqual(queued[0].title, 'Task moved')
        self.assertEqual(queued[0].status, 'pending')

    def test_creating_a_notification_never_makes_an_inline_http_call(self):
        WorkspaceWebhook.objects.create(workspace=self.workspace, kind='teams', url='https://example.com/on')
        with mock.patch('tasks.webhooks.deliver_webhook') as sender:
            create_notification(self.workspace.id, self.owner, 'task_status', 'Inline check', 'body')
        sender.assert_not_called()
        self.assertEqual(WebhookDelivery.objects.filter(status='pending').count(), 1)

    def test_worker_marks_deliveries_sent(self):
        webhook = WorkspaceWebhook.objects.create(workspace=self.workspace, kind='teams', url='https://example.com/on')
        WebhookDelivery.objects.create(webhook=webhook, workspace=self.workspace, kind='task_status', title='Hello', body='World')

        with mock.patch('tasks.webhooks.deliver_webhook', return_value=True) as sender:
            sent, failed = drain_webhook_deliveries()

        self.assertEqual((sent, failed), (1, 0))
        self.assertEqual(sender.call_count, 1)
        self.assertEqual(WebhookDelivery.objects.get().status, 'sent')

    def test_worker_retries_then_gives_up(self):
        webhook = WorkspaceWebhook.objects.create(workspace=self.workspace, kind='teams', url='https://example.com/on')
        WebhookDelivery.objects.create(webhook=webhook, workspace=self.workspace, kind='task_status', title='Hello', body='World')

        with mock.patch('tasks.webhooks.deliver_webhook', return_value=False):
            for _ in range(WebhookDelivery.MAX_ATTEMPTS + 2):
                drain_webhook_deliveries()

        delivery = WebhookDelivery.objects.get()
        self.assertEqual(delivery.status, 'failed')
        self.assertEqual(delivery.attempts, WebhookDelivery.MAX_ATTEMPTS)

    def test_delivery_command_runs(self):
        webhook = WorkspaceWebhook.objects.create(workspace=self.workspace, kind='teams', url='https://example.com/on')
        WebhookDelivery.objects.create(webhook=webhook, workspace=self.workspace, kind='task_status', title='Hello')
        output = StringIO()
        with mock.patch('tasks.webhooks.deliver_webhook', return_value=True):
            call_command('deliver_webhooks', stdout=output)
        self.assertIn('sent: 1', output.getvalue())


class CalendarFeedTokenApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username='feedowner@example.com', email='feedowner@example.com', password='secure-pass-123')
        self.member = User.objects.create_user(username='feedmember@example.com', email='feedmember@example.com', password='secure-pass-123')
        self.workspace = Workspace.objects.create(name='Feeds', slug='feeds')
        Membership.objects.create(workspace=self.workspace, user=self.owner, role='owner')
        Membership.objects.create(workspace=self.workspace, user=self.member, role='member')
        self.client.login(username='feedowner@example.com', password='secure-pass-123')
        CalendarEvent.objects.create(
            workspace=self.workspace,
            title='Sprint review',
            start_at=timezone.now() + timedelta(days=1),
            end_at=timezone.now() + timedelta(days=1, hours=1),
            created_by=self.owner,
        )

    def fetch_token(self):
        return self.client.get(reverse('calendar-feed-token', args=[self.workspace.id])).json()['token']

    def test_token_is_generated_once_and_reused(self):
        first = self.fetch_token()
        self.assertTrue(first)
        self.assertEqual(first, self.fetch_token())

    def test_feed_is_reachable_without_a_session_when_token_is_valid(self):
        token = self.fetch_token()
        self.client.logout()
        response = self.client.get(f"{reverse('calendar-ics', args=[self.workspace.id])}?token={token}")
        self.assertEqual(response.status_code, 200)
        self.assertIn('Sprint review', response.content.decode())
        self.assertTrue(response['Content-Disposition'].startswith('inline'))

    def test_bad_token_is_rejected(self):
        self.fetch_token()
        self.client.logout()
        response = self.client.get(f"{reverse('calendar-ics', args=[self.workspace.id])}?token=not-the-real-token")
        self.assertEqual(response.status_code, 403)

    def test_empty_token_does_not_bypass_authentication(self):
        self.fetch_token()
        self.client.logout()
        response = self.client.get(f"{reverse('calendar-ics', args=[self.workspace.id])}?token=")
        self.assertEqual(response.status_code, 401)

    def test_token_of_one_workspace_does_not_open_another(self):
        token = self.fetch_token()
        other = Workspace.objects.create(name='Elsewhere', slug='elsewhere-feed')
        self.client.logout()
        response = self.client.get(f"{reverse('calendar-ics', args=[other.id])}?token={token}")
        self.assertEqual(response.status_code, 403)

    def test_reset_invalidates_the_previous_link(self):
        original = self.fetch_token()
        rotated = self.client.post(reverse('calendar-feed-token', args=[self.workspace.id])).json()['token']
        self.assertNotEqual(original, rotated)
        self.client.logout()
        stale = self.client.get(f"{reverse('calendar-ics', args=[self.workspace.id])}?token={original}")
        self.assertEqual(stale.status_code, 403)

    def test_members_cannot_rotate_the_token(self):
        self.client.logout()
        self.client.login(username='feedmember@example.com', password='secure-pass-123')
        response = self.client.post(reverse('calendar-feed-token', args=[self.workspace.id]))
        self.assertEqual(response.status_code, 403)


class WorkspaceSearchApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='searcher@example.com', email='searcher@example.com', password='secure-pass-123')
        self.other = User.objects.create_user(username='otherperson@example.com', email='otherperson@example.com', password='secure-pass-123')
        self.workspace = Workspace.objects.create(name='Searchable', slug='searchable')
        Membership.objects.create(workspace=self.workspace, user=self.user, role='owner')
        Membership.objects.create(workspace=self.workspace, user=self.other, role='member')
        self.client.login(username='searcher@example.com', password='secure-pass-123')

    def search(self, query):
        response = self.client.get(f"{reverse('workspace-search', args=[self.workspace.id])}?q={query}")
        self.assertEqual(response.status_code, 200)
        return response.json()['results']

    def test_short_queries_return_nothing(self):
        Task.objects.create(workspace=self.workspace, title='Migrate the warehouse')
        self.assertEqual(self.search('m'), [])

    def test_finds_tasks_comments_and_risks(self):
        task = Task.objects.create(workspace=self.workspace, title='Migrate the warehouse')
        TaskComment.objects.create(task=task, author=self.user, body='Warehouse cutover is scheduled')
        RiskIssue.objects.create(workspace=self.workspace, kind='risk', title='Warehouse downtime', created_by=self.user)

        self.assertEqual({result['kind'] for result in self.search('warehouse')}, {'task', 'task_comment', 'risk_issue'})

    def test_archived_tasks_are_excluded(self):
        Task.objects.create(workspace=self.workspace, title='Migrate the warehouse', state='archived')
        self.assertEqual(self.search('warehouse'), [])

    def test_private_channel_messages_are_hidden_from_non_members(self):
        private = ChatChannel.objects.create(workspace=self.workspace, name='leadership', is_private=True, created_by=self.other)
        ChatMessage.objects.create(workspace=self.workspace, author=self.other, channel=private.name, message='Confidential warehouse plan')

        self.assertEqual(self.search('warehouse'), [])

        private.members.add(self.user)
        self.assertEqual({result['kind'] for result in self.search('warehouse')}, {'chat_message'})

    def test_direct_messages_between_other_people_are_not_searchable(self):
        third = User.objects.create_user(username='third@example.com', email='third@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=third, role='member')
        conversation = DirectConversation.objects.create(workspace=self.workspace, conversation_key=f'{self.other.id}-{third.id}')
        conversation.participants.add(self.other, third)
        DirectMessage.objects.create(conversation=conversation, author=self.other, message='Private warehouse chatter')

        self.assertEqual(self.search('warehouse'), [])

    def test_own_direct_messages_are_searchable(self):
        conversation = DirectConversation.objects.create(workspace=self.workspace, conversation_key=f'{self.user.id}-{self.other.id}')
        conversation.participants.add(self.user, self.other)
        DirectMessage.objects.create(conversation=conversation, author=self.other, message='Warehouse handover notes')

        self.assertEqual({result['kind'] for result in self.search('warehouse')}, {'direct_message'})

    def test_search_is_scoped_to_the_workspace(self):
        other_workspace = Workspace.objects.create(name='Elsewhere', slug='elsewhere-search')
        Task.objects.create(workspace=other_workspace, title='Warehouse in another workspace')
        self.assertEqual(self.search('warehouse'), [])

    def test_non_members_cannot_search(self):
        User.objects.create_user(username='outsider@example.com', email='outsider@example.com', password='secure-pass-123')
        self.client.logout()
        self.client.login(username='outsider@example.com', password='secure-pass-123')
        response = self.client.get(f"{reverse('workspace-search', args=[self.workspace.id])}?q=warehouse")
        self.assertEqual(response.status_code, 403)


class WorkspacePulseApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='pulse@example.com', email='pulse@example.com', password='secure-pass-123')
        self.other = User.objects.create_user(username='pulseother@example.com', email='pulseother@example.com', password='secure-pass-123')
        self.workspace = Workspace.objects.create(name='Pulse', slug='pulse')
        Membership.objects.create(workspace=self.workspace, user=self.user, role='owner')
        Membership.objects.create(workspace=self.workspace, user=self.other, role='member')
        self.client.login(username='pulse@example.com', password='secure-pass-123')

    def fingerprint(self):
        response = self.client.get(reverse('workspace-pulse', args=[self.workspace.id]))
        self.assertEqual(response.status_code, 200)
        return response.json()['fingerprint']

    def test_fingerprint_is_stable_when_nothing_changes(self):
        self.assertEqual(self.fingerprint(), self.fingerprint())

    def test_new_task_changes_the_fingerprint(self):
        before = self.fingerprint()
        Task.objects.create(workspace=self.workspace, title='Something new')
        self.assertNotEqual(before, self.fingerprint())

    def test_editing_a_task_changes_the_fingerprint(self):
        task = Task.objects.create(workspace=self.workspace, title='Edit me')
        before = self.fingerprint()
        task.title = 'Edited'
        task.save()
        self.assertNotEqual(before, self.fingerprint())

    def test_deleting_a_task_changes_the_fingerprint(self):
        task = Task.objects.create(workspace=self.workspace, title='Delete me')
        before = self.fingerprint()
        task.delete()
        self.assertNotEqual(before, self.fingerprint(), 'deletions must move the fingerprint')

    def test_activity_in_another_workspace_is_ignored(self):
        other_workspace = Workspace.objects.create(name='Unrelated', slug='unrelated-pulse')
        before = self.fingerprint()
        Task.objects.create(workspace=other_workspace, title='Not mine')
        self.assertEqual(before, self.fingerprint())

    def test_notifications_are_scoped_per_user(self):
        before = self.fingerprint()
        WorkspaceNotification.objects.create(workspace=self.workspace, recipient=self.other, kind='task_status', title='For someone else')
        self.assertEqual(before, self.fingerprint(), "another person's notification must not move my fingerprint")

        WorkspaceNotification.objects.create(workspace=self.workspace, recipient=self.user, kind='task_status', title='For me')
        self.assertNotEqual(before, self.fingerprint())

    def test_reading_a_notification_changes_the_fingerprint(self):
        notification = WorkspaceNotification.objects.create(workspace=self.workspace, recipient=self.user, kind='task_status', title='Unread')
        before = self.fingerprint()
        notification.read_at = timezone.now()
        notification.save()
        self.assertNotEqual(before, self.fingerprint(), 'the unread badge must be able to clear')

    def test_direct_messages_are_scoped_to_participants(self):
        third = User.objects.create_user(username='pulsethird@example.com', email='pulsethird@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=third, role='member')
        conversation = DirectConversation.objects.create(workspace=self.workspace, conversation_key=f'{self.other.id}-{third.id}')
        conversation.participants.add(self.other, third)

        before = self.fingerprint()
        DirectMessage.objects.create(conversation=conversation, author=self.other, message='Not for you')
        self.assertEqual(before, self.fingerprint())

        mine = DirectConversation.objects.create(workspace=self.workspace, conversation_key=f'{self.user.id}-{self.other.id}')
        mine.participants.add(self.user, self.other)
        before_mine = self.fingerprint()
        DirectMessage.objects.create(conversation=mine, author=self.other, message='For you')
        self.assertNotEqual(before_mine, self.fingerprint())

    def test_pulse_runs_in_a_small_fixed_number_of_queries(self):
        """This runs on a timer in every open tab, so its cost must stay flat and small."""
        def pulse_queries():
            with CaptureQueriesContext(connection) as captured:
                self.assertEqual(self.client.get(reverse('workspace-pulse', args=[self.workspace.id])).status_code, 200)
            return len(captured)

        baseline = pulse_queries()
        self.assertLessEqual(baseline, 8, 'pulse should fold its aggregates into a few round trips')

        for index in range(25):
            Task.objects.create(workspace=self.workspace, title=f'Task {index}')
        self.assertEqual(pulse_queries(), baseline, 'pulse cost must not grow with workspace size')

    def test_non_members_cannot_read_the_pulse(self):
        User.objects.create_user(username='pulseoutsider@example.com', email='pulseoutsider@example.com', password='secure-pass-123')
        self.client.logout()
        self.client.login(username='pulseoutsider@example.com', password='secure-pass-123')
        response = self.client.get(reverse('workspace-pulse', args=[self.workspace.id]))
        self.assertEqual(response.status_code, 403)


class ActivityPaginationApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='activity@example.com', email='activity@example.com', password='secure-pass-123')
        self.workspace = Workspace.objects.create(name='Activity', slug='activity-pagination')
        Membership.objects.create(workspace=self.workspace, user=self.user, role='owner')
        self.client.login(username='activity@example.com', password='secure-pass-123')
        for index in range(95):
            ActivityEvent.objects.create(workspace=self.workspace, actor=self.user, kind='task_status', message=f'Event {index}')

    def fetch(self, query=''):
        response = self.client.get(f"{reverse('activity-list', args=[self.workspace.id])}{query}")
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_response_reports_pagination(self):
        payload = self.fetch('?page_size=40')
        self.assertEqual(len(payload['activity']), 40)
        self.assertEqual(payload['pagination']['total_items'], 95)
        self.assertEqual(payload['pagination']['total_pages'], 3)
        self.assertTrue(payload['pagination']['has_next'])
        self.assertFalse(payload['pagination']['has_previous'])

    def test_pages_do_not_overlap_and_cover_everything(self):
        seen = []
        for page in (1, 2, 3):
            seen.extend(event['id'] for event in self.fetch(f'?page_size=40&page={page}')['activity'])
        self.assertEqual(len(seen), 95)
        self.assertEqual(len(set(seen)), 95, 'pages must not repeat entries')

    def test_last_page_holds_the_remainder(self):
        payload = self.fetch('?page_size=40&page=3')
        self.assertEqual(len(payload['activity']), 15)
        self.assertTrue(payload['pagination']['has_previous'])
        self.assertFalse(payload['pagination']['has_next'])

    def test_newest_events_come_first(self):
        activity = self.fetch('?page_size=40')['activity']
        timestamps = [event['created_at'] for event in activity]
        self.assertEqual(timestamps, sorted(timestamps, reverse=True))

    def test_page_beyond_the_end_returns_the_last_page(self):
        payload = self.fetch('?page_size=40&page=99')
        self.assertEqual(payload['pagination']['page'], 3)
        self.assertEqual(len(payload['activity']), 15)

    def test_page_size_is_capped(self):
        self.assertEqual(self.fetch('?page_size=99999')['pagination']['page_size'], 500)

    def test_invalid_paging_values_are_rejected(self):
        response = self.client.get(f"{reverse('activity-list', args=[self.workspace.id])}?page=abc")
        self.assertEqual(response.status_code, 400)

    def test_non_members_cannot_read_activity(self):
        User.objects.create_user(username='activityoutsider@example.com', email='activityoutsider@example.com', password='secure-pass-123')
        self.client.logout()
        self.client.login(username='activityoutsider@example.com', password='secure-pass-123')
        response = self.client.get(reverse('activity-list', args=[self.workspace.id]))
        self.assertEqual(response.status_code, 403)
