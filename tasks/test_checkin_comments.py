import json

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from .models import CheckIn, CheckInComment, Membership, Workspace, WorkspaceNotification


class CheckInCommentApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username='owner@example.com', email='owner@example.com', password='secure-pass-123')
        self.manager = User.objects.create_user(username='manager@example.com', email='manager@example.com', password='secure-pass-123')
        self.member = User.objects.create_user(username='member@example.com', email='member@example.com', password='secure-pass-123')
        self.workspace = Workspace.objects.create(name='Check-in comments', slug='check-in-comments')
        Membership.objects.create(workspace=self.workspace, user=self.owner, role='owner')
        Membership.objects.create(workspace=self.workspace, user=self.manager, role='manager')
        Membership.objects.create(workspace=self.workspace, user=self.member, role='member')
        self.check_in = CheckIn.objects.create(
            workspace=self.workspace,
            user=self.member,
            date='2026-09-07',
            completed='Finished the draft.',
            next_steps='Send it for review.',
        )

    def comment_url(self):
        return reverse('check-in-comment-list', args=[self.workspace.id, self.check_in.id])

    def test_authorised_member_can_comment_and_check_in_owner_is_notified(self):
        self.client.force_login(self.owner)
        response = self.client.post(
            self.comment_url(),
            data=json.dumps({'body': 'Great progress. Please share the final copy.'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['comment']['author_id'], self.owner.id)
        self.assertEqual(CheckInComment.objects.filter(check_in=self.check_in).count(), 1)
        self.assertTrue(WorkspaceNotification.objects.filter(recipient=self.member, kind='check_in_comment').exists())

    def test_default_member_permission_allows_a_check_in_comment(self):
        self.client.force_login(self.member)
        response = self.client.post(
            self.comment_url(),
            data=json.dumps({'body': 'I can take the review feedback.'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)

    def test_manager_without_comment_permission_is_denied(self):
        Membership.objects.filter(workspace=self.workspace, user=self.manager).update(permissions=[])
        self.client.force_login(self.manager)
        response = self.client.post(
            self.comment_url(),
            data=json.dumps({'body': 'This should not be accepted.'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(CheckInComment.objects.count(), 0)

    def test_comments_are_scoped_to_the_workspace_check_in(self):
        other_workspace = Workspace.objects.create(name='Elsewhere', slug='elsewhere-check-in-comments')
        other_check_in = CheckIn.objects.create(workspace=other_workspace, user=self.member, date='2026-09-06')
        self.client.force_login(self.owner)
        response = self.client.get(reverse('check-in-comment-list', args=[self.workspace.id, other_check_in.id]))
        self.assertEqual(response.status_code, 404)
