from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from .models import Membership, UserProfile, Workspace, WorkspaceInvitation


def default_workspace_id(user):
    """A profile row may not exist at all - it is only created when something
    actually needs to store a preference."""
    profile = UserProfile.objects.filter(user=user).first()
    return profile.default_workspace_id if profile else None


class InvitationDefaultWorkspaceTests(TestCase):
    """Accepting an invitation settles your default workspace only when you had
    nowhere to go yet; anyone who already belonged somewhere keeps their own
    choice."""

    def setUp(self):
        self.owner = User.objects.create_user(username='host@example.com', email='host@example.com', password='secure-pass-123')
        self.hosted = Workspace.objects.create(name='Hosted', slug='hosted')
        Membership.objects.create(workspace=self.hosted, user=self.owner, role='owner')

    def invite(self, email, workspace=None):
        return WorkspaceInvitation.objects.create(
            workspace=workspace or self.hosted,
            email=email,
            role='member',
            invited_by=self.owner,
        )

    def accept_as(self, email, invitation):
        invitee = User.objects.create_user(username=email, email=email, password='secure-pass-123')
        self.client.force_login(invitee)
        response = self.client.post(reverse('invitation-accept', args=[invitation.id]))
        return invitee, response

    def test_an_account_that_belonged_nowhere_lands_on_the_inviting_workspace(self):
        invitee, response = self.accept_as('newcomer@example.com', self.invite('newcomer@example.com'))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(default_workspace_id(invitee), self.hosted.id)

    def test_an_account_with_its_own_workspace_keeps_its_own_default(self):
        invitee = User.objects.create_user(username='founder@example.com', email='founder@example.com', password='secure-pass-123')
        own = Workspace.objects.create(name='Own', slug='own')
        Membership.objects.create(workspace=own, user=invitee, role='owner')
        profile, _ = UserProfile.objects.get_or_create(user=invitee)
        profile.default_workspace = own
        profile.save(update_fields=['default_workspace'])

        self.client.force_login(invitee)
        response = self.client.post(reverse('invitation-accept', args=[self.invite('founder@example.com').id]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(default_workspace_id(invitee), own.id)

    def test_an_account_with_a_workspace_but_no_default_keeps_the_choice_open(self):
        # Owning a workspace does not imply having picked a default, so joining
        # someone else must not pick one on their behalf.
        invitee = User.objects.create_user(username='pending@example.com', email='pending@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=Workspace.objects.create(name='Pending', slug='pending'), user=invitee, role='owner')

        self.client.force_login(invitee)
        response = self.client.post(reverse('invitation-accept', args=[self.invite('pending@example.com').id]))

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(default_workspace_id(invitee))

    def test_an_archived_workspace_never_becomes_a_default(self):
        archived = Workspace.objects.create(name='Closed', slug='closed', status='archived')
        invitee, response = self.accept_as('late@example.com', self.invite('late@example.com', workspace=archived))

        self.assertEqual(response.status_code, 200)
        self.assertTrue(Membership.objects.filter(workspace=archived, user=invitee).exists())
        self.assertIsNone(default_workspace_id(invitee))
