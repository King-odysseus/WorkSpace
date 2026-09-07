import json

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from .models import FollowUp, FollowUpComment, Membership, Workspace, WorkspaceNotification


class FollowUpCommentNotificationTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username='owner@example.com', email='owner@example.com', password='secure-pass-123')
        self.first_commenter = User.objects.create_user(username='first@example.com', email='first@example.com', password='secure-pass-123')
        self.second_commenter = User.objects.create_user(username='second@example.com', email='second@example.com', password='secure-pass-123')
        self.workspace = Workspace.objects.create(name='Follow-up comments', slug='follow-up-comments')
        for user, role in ((self.owner, 'owner'), (self.first_commenter, 'member'), (self.second_commenter, 'member')):
            Membership.objects.create(workspace=self.workspace, user=user, role=role)
        self.follow_up = FollowUp.objects.create(workspace=self.workspace, created_by=self.owner, note='Confirm the launch date')
        self.url = reverse('follow-up-comment-list', args=[self.follow_up.id])

    def post_as(self, user, body):
        self.client.force_login(user)
        return self.client.post(self.url, data=json.dumps({'body': body}), content_type='application/json')

    def test_notifies_owner_and_prior_commenters_but_not_the_new_commenter(self):
        self.post_as(self.first_commenter, 'I can take this.')
        response = self.post_as(self.second_commenter, 'I have added the date to the calendar.')

        self.assertEqual(response.status_code, 201)
        recipients = set(WorkspaceNotification.objects.filter(kind='follow_up_comment').values_list('recipient_id', flat=True))
        self.assertEqual(recipients, {self.owner.id, self.first_commenter.id})
        self.assertEqual(FollowUpComment.objects.filter(follow_up=self.follow_up).count(), 2)

    def test_owner_does_not_notify_themself_when_commenting(self):
        response = self.post_as(self.owner, 'I will confirm with the client.')

        self.assertEqual(response.status_code, 201)
        self.assertFalse(WorkspaceNotification.objects.filter(kind='follow_up_comment').exists())
