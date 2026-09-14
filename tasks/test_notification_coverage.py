"""Notifications for the events that used to change shared state silently.

Each of these actions already wrote an activity entry or an audit row. An
activity entry is only seen by someone already reading the feed, and an audit
row is only seen by someone already reading the audit log, so the people who
needed to act on the change were never told about it.
"""
import json
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import (
    FollowUp, Membership, Project, ProjectExpense, ProjectResource, ProjectStakeholder,
    ProjectTemplate, ScreenCapture, ScreenShareSession, TaskTemplate, Workspace,
    WorkspaceDocument, WorkspaceDocumentComment, WorkspaceNotification,
)


class NotificationCoverageTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner@example.com', 'owner@example.com', 'password')
        self.manager = User.objects.create_user('manager@example.com', 'manager@example.com', 'password')
        self.member = User.objects.create_user('member@example.com', 'member@example.com', 'password')
        self.workspace = Workspace.objects.create(name='Test workspace', slug='test-workspace')
        Membership.objects.create(workspace=self.workspace, user=self.owner, role='owner')
        Membership.objects.create(workspace=self.workspace, user=self.manager, role='manager')
        Membership.objects.create(workspace=self.workspace, user=self.member, role='member')
        self.client.force_login(self.member)

    def notifications(self, kind, recipient=None):
        query = WorkspaceNotification.objects.filter(workspace=self.workspace, kind=kind)
        if recipient is not None:
            query = query.filter(recipient=recipient)
        return list(query)

    def post_json(self, url, payload, expect=200):
        response = self.client.post(url, data=json.dumps(payload), content_type='application/json')
        self.assertEqual(response.status_code, expect, response.content)
        return response

    def patch_json(self, url, payload, expect=200):
        response = self.client.patch(url, data=json.dumps(payload), content_type='application/json')
        self.assertEqual(response.status_code, expect, response.content)
        return response


class WorkspaceLifecycleNotificationTests(NotificationCoverageTests):
    def test_leaving_tells_the_leaders_who_have_to_replan(self):
        self.post_json(reverse('workspace-leave', args=[self.workspace.id]), {})

        alerts = self.notifications('manager_activity')
        self.assertEqual({alert.recipient_id for alert in alerts}, {self.owner.id, self.manager.id})
        self.assertEqual(alerts[0].target_type, 'workspace')

    def test_archiving_tells_the_other_leaders(self):
        self.client.force_login(self.owner)
        self.post_json(reverse('workspace-archive', args=[self.workspace.id]), {})

        alerts = self.notifications('manager_activity')
        self.assertEqual([alert.recipient_id for alert in alerts], [self.manager.id])
        self.assertIn('archived the workspace', alerts[0].title)

    def test_restoring_tells_the_other_leaders(self):
        self.client.force_login(self.owner)
        self.post_json(reverse('workspace-archive', args=[self.workspace.id]), {})
        self.post_json(reverse('workspace-restore', args=[self.workspace.id]), {})

        restored = [alert for alert in self.notifications('manager_activity') if 'restored' in alert.title]
        self.assertEqual([alert.recipient_id for alert in restored], [self.manager.id])

    def test_the_owner_is_never_told_about_their_own_archive(self):
        self.client.force_login(self.owner)
        self.post_json(reverse('workspace-archive', args=[self.workspace.id]), {})

        self.assertNotIn(self.owner.id, [alert.recipient_id for alert in self.notifications('manager_activity')])


class ProjectChangeNotificationTests(NotificationCoverageTests):
    def setUp(self):
        super().setUp()
        self.client.force_login(self.manager)
        self.project = Project.objects.create(workspace=self.workspace, name='Website rebuild')

    def leaders_notified(self):
        return {alert.recipient_id for alert in self.notifications('manager_activity')}

    def test_recording_an_expense_reports_the_amount_to_the_other_leaders(self):
        self.post_json(
            reverse('project-expense-list', args=[self.workspace.id, self.project.id]),
            {'name': 'Design retainer', 'category': 'other', 'amount': '2500.00'},
            expect=201,
        )

        alert = self.notifications('manager_activity')[0]
        self.assertEqual(self.leaders_notified(), {self.owner.id})
        self.assertIn('2500', alert.title)

    def test_changing_and_archiving_an_expense_are_both_reported(self):
        expense = ProjectExpense.objects.create(project=self.project, name='Licences', amount='400.00')

        self.patch_json(reverse('project-expense-detail', args=[self.workspace.id, self.project.id, expense.id]), {'amount': '900.00'})
        self.client.delete(reverse('project-expense-detail', args=[self.workspace.id, self.project.id, expense.id]))

        titles = [alert.title for alert in self.notifications('manager_activity')]
        self.assertEqual(len(titles), 2)
        self.assertTrue(any('changed a project expense' in title for title in titles))
        self.assertTrue(any('archived a project expense' in title for title in titles))

    def test_archiving_a_resource_and_a_stakeholder_reports_the_plan_change(self):
        resource = ProjectResource.objects.create(project=self.project, name='Ava Chen')
        stakeholder = ProjectStakeholder.objects.create(project=self.project, name='Legal')

        self.client.delete(reverse('project-resource-detail', args=[self.workspace.id, self.project.id, resource.id]))
        self.client.delete(reverse('project-stakeholder-detail', args=[self.workspace.id, self.project.id, stakeholder.id]))

        titles = [alert.title for alert in self.notifications('manager_activity')]
        self.assertTrue(any('Ava Chen' in title for title in titles))
        self.assertTrue(any('Legal' in title for title in titles))
        self.assertEqual(self.leaders_notified(), {self.owner.id})

    def test_a_single_leader_workspace_has_nobody_to_tell(self):
        Membership.objects.filter(workspace=self.workspace, user=self.owner).delete()

        self.post_json(
            reverse('project-expense-list', args=[self.workspace.id, self.project.id]),
            {'name': 'Solo budget', 'category': 'other', 'amount': '10.00'},
            expect=201,
        )

        self.assertEqual(self.notifications('manager_activity'), [])

    def test_creating_a_project_from_a_blueprint_tells_the_other_leaders(self):
        template = ProjectTemplate.objects.create(
            workspace=self.workspace, name='Campaign kickoff', project_name='Spring campaign',
            created_by=self.manager,
        )

        self.post_json(reverse('project-template-apply', args=[self.workspace.id, template.id]), {}, expect=201)

        alert = self.notifications('manager_activity')[0]
        self.assertEqual(self.leaders_notified(), {self.owner.id})
        self.assertIn('Spring campaign', alert.title)


class AssignmentNotificationTests(NotificationCoverageTests):
    def test_applying_a_task_blueprint_assigns_loudly(self):
        self.client.force_login(self.manager)
        template = TaskTemplate.objects.create(
            workspace=self.workspace, name='Weekly review', title='Run the weekly review',
            assignee=self.member, created_by=self.manager,
        )

        created = self.post_json(reverse('task-template-apply', args=[self.workspace.id, template.id]), {}, expect=201)

        alert = self.notifications('task_assigned', recipient=self.member)[0]
        self.assertEqual(alert.title, 'You were assigned a task.')
        self.assertEqual(alert.target_id, str(created.json()['task']['id']))

    def test_applying_your_own_blueprint_does_not_assign_you_anything(self):
        self.client.force_login(self.manager)
        template = TaskTemplate.objects.create(
            workspace=self.workspace, name='Weekly review', title='Run the weekly review',
            assignee=self.manager, created_by=self.manager,
        )

        self.post_json(reverse('task-template-apply', args=[self.workspace.id, template.id]), {}, expect=201)

        self.assertEqual(self.notifications('task_assigned', recipient=self.manager), [])

    def test_unassigning_a_follow_up_tells_the_person_who_lost_it(self):
        self.client.force_login(self.manager)
        follow_up = FollowUp.objects.create(
            workspace=self.workspace, created_by=self.manager, assigned_to=self.member, note='Chase the invoice',
        )

        self.patch_json(reverse('follow-up-detail', args=[follow_up.id]), {'assigned_to': None})

        alert = self.notifications('follow_up_unassigned', recipient=self.member)[0]
        self.assertEqual(alert.body, 'Chase the invoice')
        self.assertEqual(alert.target_id, str(follow_up.id))


class DocumentCommentNotificationTests(NotificationCoverageTests):
    def resolve(self, document, comment, actor):
        self.client.force_login(actor)
        self.patch_json(
            reverse('workspace-document-comment-detail', args=[self.workspace.id, document.id, comment.id]),
            {'resolved': True},
        )

    def test_resolving_a_reply_also_tells_the_person_it_answered(self):
        document = WorkspaceDocument.objects.create(workspace=self.workspace, title='Launch plan', created_by=self.owner)
        root = WorkspaceDocumentComment.objects.create(document=document, author=self.member, body='Should we move it?')
        reply = WorkspaceDocumentComment.objects.create(document=document, author=self.owner, body='Yes, to the 14th.', parent=root)

        self.resolve(document, reply, self.manager)

        recipients = {alert.recipient_id for alert in self.notifications('document_comment_resolved')}
        self.assertEqual(recipients, {self.member.id, self.owner.id})

    def test_resolving_a_comment_tells_the_person_who_wrote_it(self):
        document = WorkspaceDocument.objects.create(workspace=self.workspace, title='Launch plan', created_by=self.member)
        comment = WorkspaceDocumentComment.objects.create(document=document, author=self.member, body='Is this date right?')

        self.resolve(document, comment, self.manager)

        alert = self.notifications('document_comment_resolved', recipient=self.member)[0]
        self.assertEqual(alert.body, 'Is this date right?')
        self.assertEqual(alert.target_type, 'document')

    def test_the_person_who_resolved_it_is_not_told_about_their_own_action(self):
        document = WorkspaceDocument.objects.create(workspace=self.workspace, title='Launch plan', created_by=self.manager)
        comment = WorkspaceDocumentComment.objects.create(document=document, author=self.manager, body='Mine to close')

        self.resolve(document, comment, self.manager)

        self.assertEqual(self.notifications('document_comment_resolved', recipient=self.manager), [])


class ChatAlertMessageReferenceTests(NotificationCoverageTests):
    def test_a_channel_alert_names_the_message_it_is_about(self):
        with patch('tasks.views.send_push_to_user') as push:
            response = self.post_json(
                reverse('chat-message-list', args=[self.workspace.id]),
                {'channel': 'general', 'message': 'Ship it Friday'},
                expect=201,
            )
        message_id = response.json()['message']['id']

        alert = self.notifications('channel_message', recipient=self.owner)[0]
        self.assertEqual(alert.group_key, f'message:{message_id}')
        self.assertIn(f'message_id={message_id}', push.call_args.kwargs['url'])

    def test_a_direct_message_alert_names_the_message_it_is_about(self):
        conversation = self.post_json(
            reverse('direct-conversation-list', args=[self.workspace.id]),
            {'recipient_id': self.owner.id},
            expect=201,
        ).json()['conversation']
        with patch('tasks.views.send_push_to_user') as push:
            response = self.post_json(
                reverse('direct-message-list', args=[conversation['id']]),
                {'message': 'See you then'},
                expect=201,
            )
        message_id = response.json()['message']['id']

        alert = self.notifications('direct_message', recipient=self.owner)[0]
        self.assertEqual(alert.target_id, str(conversation['id']))
        self.assertEqual(alert.group_key, f'message:{message_id}')
        self.assertIn(f'message_id={message_id}', push.call_args.kwargs['url'])

    def test_an_alert_about_something_other_than_a_message_keeps_its_own_key(self):
        self.client.force_login(self.manager)
        project = Project.objects.create(workspace=self.workspace, name='Website rebuild')

        self.post_json(
            reverse('project-expense-list', args=[self.workspace.id, project.id]),
            {'name': 'Hosting', 'category': 'other', 'amount': '20.00'},
            expect=201,
        )

        alert = self.notifications('manager_activity')[0]
        self.assertEqual(alert.group_key, f'project:{alert.target_id}')


class ScreenSharingNotificationTests(NotificationCoverageTests):
    def make_session(self, employee):
        return ScreenShareSession.objects.create(
            workspace=self.workspace, requested_by=self.manager, employee=employee,
            employee_name=employee.email, employee_email=employee.email,
            policy_text='You will be told when a screenshot is viewed.', policy_version=1,
            expires_at=timezone.now() + timedelta(minutes=30),
        )

    def cancel(self, session):
        self.client.force_login(self.manager)
        self.patch_json(
            reverse('screen-share-session-detail', args=[self.workspace.id, session.id]),
            {'action': 'cancel'},
        )

    def test_cancelling_a_request_tells_the_employee_whose_prompt_disappears(self):
        session = self.make_session(self.member)

        self.cancel(session)

        alert = self.notifications('screen_share_cancelled', recipient=self.member)[0]
        self.assertEqual(alert.target_id, str(session.id))

    def test_the_leader_who_cancelled_is_not_notified(self):
        session = self.make_session(self.member)

        self.cancel(session)

        self.assertEqual(self.notifications('screen_share_cancelled', recipient=self.manager), [])

    def test_viewing_screenshots_tells_the_employee_once_per_session(self):
        session = self.make_session(self.member)
        for _ in range(2):
            ScreenCapture.objects.create(
                session=session, workspace=self.workspace, captured_by=self.member, image='capture.jpg',
                size=1024, width=640, height=480, sha256='a' * 64,
                expires_at=timezone.now() + timedelta(days=7),
            )
        self.client.force_login(self.manager)

        self.client.get(reverse('screen-capture-list', args=[self.workspace.id, session.id]))
        self.client.get(reverse('screen-capture-list', args=[self.workspace.id, session.id]))

        alerts = self.notifications('screen_capture_viewed', recipient=self.member)
        self.assertEqual(len(alerts), 1)
        self.assertEqual(alerts[0].target_id, str(session.id))

    def test_an_employee_viewing_their_own_screenshots_is_not_notified(self):
        session = self.make_session(self.member)
        ScreenCapture.objects.create(
            session=session, workspace=self.workspace, captured_by=self.member, image='capture.jpg',
            size=1024, width=640, height=480, sha256='a' * 64,
            expires_at=timezone.now() + timedelta(days=7),
        )

        self.client.get(reverse('screen-capture-list', args=[self.workspace.id, session.id]))

        self.assertEqual(self.notifications('screen_capture_viewed', recipient=self.member), [])
