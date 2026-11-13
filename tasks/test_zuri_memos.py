from django.contrib.auth.models import User
from django.test import TestCase

from .ai_actions import ActionExecutionError, ActionValidationError, PrivacyRegistry, create_action_proposal, execute_action
from .models import Membership, Memo, Workspace, WorkspaceNotification


class ZuriMemoTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('o@example.com', 'o@example.com', 'password')
        self.member = User.objects.create_user('m@example.com', 'm@example.com', 'password')
        self.workspace = Workspace.objects.create(name='Zuri memos', slug='zuri-memos')
        Membership.objects.create(workspace=self.workspace, user=self.owner, role='owner')
        Membership.objects.create(workspace=self.workspace, user=self.member, role='member')

    def propose(self, actor, **arguments):
        action = {'kind': 'memo.create', 'arguments': {'title': 'Friday closure', 'body': 'We are closed on Friday.', **arguments}}
        return create_action_proposal(action, PrivacyRegistry(self.workspace.id, actor), self.workspace.id, actor)

    def test_a_proposal_writes_nothing_until_it_is_confirmed(self):
        proposal = self.propose(self.owner, banner_days=3)
        self.assertEqual(Memo.objects.count(), 0)
        self.assertIn('Friday closure', proposal.summary)
        self.assertIn('3 days', proposal.summary)

    def test_confirming_posts_the_memo_and_notifies_the_team(self):
        proposal = self.propose(self.owner)
        execute_action(proposal, self.owner)
        memo = Memo.objects.get()
        self.assertEqual((memo.title, memo.author), ('Friday closure', self.owner))
        self.assertTrue(WorkspaceNotification.objects.filter(recipient=self.member, kind='memo').exists())

    def test_a_member_cannot_get_a_memo_proposed(self):
        with self.assertRaises(ActionValidationError):
            self.propose(self.member)

    def test_permission_is_checked_again_when_confirming(self):
        proposal = self.propose(self.owner)
        Membership.objects.filter(user=self.owner).update(role='member')
        with self.assertRaises(ActionExecutionError):
            execute_action(proposal, self.owner)
        self.assertEqual(Memo.objects.count(), 0)

    def test_bad_values_are_refused(self):
        for arguments in ({'banner_days': 99}, {'banner_days': 'a'}, {'body': ''}, {'title': ''}, {'title': 'x' * 161}):
            with self.assertRaises(ActionValidationError, msg=arguments):
                self.propose(self.owner, **arguments)

    def test_zuri_can_draft_a_request_memo(self):
        proposal = self.propose(self.owner, kind='request', due_date='2030-01-04')
        self.assertIn('request memo', proposal.summary)
        self.assertIn('2030-01-04', proposal.summary)
        execute_action(proposal, self.owner)
        memo = Memo.objects.get()
        self.assertEqual((memo.kind, str(memo.due_date)), ('request', '2030-01-04'))

    def test_an_unknown_kind_is_refused(self):
        with self.assertRaises(ActionValidationError):
            self.propose(self.owner, kind='poll')
