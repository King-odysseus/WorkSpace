"""The seed the browser journeys stand on.

It is not application code, but it is load-bearing: every journey starts from
what this writes, and a fixture that drifts would show up as a journey failing
for reasons that have nothing to do with the app. Two properties matter - the
same result every time, and tasks the signed-in account can actually see, since
the daily view shows what is assigned to you and an unassigned board would be
empty for the person the journeys sign in as.
"""

from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import TestCase

from .management.commands.seed_browser_fixtures import ACCOUNTS, SEEDED_TASKS, SLUG
from .models import Membership, Task, UserProfile, Workspace


class SeedBrowserFixturesTests(TestCase):
    def seed(self):
        call_command('seed_browser_fixtures', '--password', 'a-password-for-the-test')

    def test_it_creates_a_workspace_with_each_role(self):
        self.seed()

        workspace = Workspace.objects.get(slug=SLUG)
        roles = set(
            Membership.objects.filter(workspace=workspace).values_list('role', flat=True)
        )

        self.assertEqual(roles, {'owner', 'manager', 'member'})
        for email, _role in ACCOUNTS:
            self.assertTrue(
                User.objects.get(email=email).check_password('a-password-for-the-test'),
                f'{email} should be able to sign in with the password that was passed',
            )

    def test_a_journey_can_sign_in_and_see_work_to_open(self):
        self.seed()

        workspace = Workspace.objects.get(slug=SLUG)
        owner = User.objects.get(email=ACCOUNTS[0][0])
        tasks = Task.objects.filter(workspace=workspace)

        self.assertEqual(tasks.count(), SEEDED_TASKS)
        self.assertEqual(
            set(tasks.values_list('assignee_id', flat=True)),
            {owner.id},
            'the owner the journeys sign in as must be able to see the board',
        )

    def test_running_it_again_leaves_the_same_fixture(self):
        self.seed()
        first = list(
            Task.objects.filter(workspace__slug=SLUG).values_list('code', flat=True)
        )

        self.seed()

        second = list(
            Task.objects.filter(workspace__slug=SLUG).values_list('code', flat=True)
        )
        self.assertEqual(sorted(first), sorted(second))
        self.assertEqual(len(second), SEEDED_TASKS)
        self.assertEqual(Workspace.objects.filter(slug=SLUG).count(), 1)

    def test_the_owner_opens_somewhere_else(self):
        # Choosing a workspace is one of the journey's steps, so it only means
        # something if the account does not already open on the one with work.
        self.seed()

        owner = User.objects.get(email=ACCOUNTS[0][0])
        default = UserProfile.objects.get(user=owner).default_workspace

        self.assertIsNotNone(default)
        self.assertNotEqual(default.slug, SLUG)
