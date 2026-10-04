"""Seed the disposable workspace the browser journeys drive.

The journeys run the real app in a real browser, so they need real rows: one
workspace with each of the three roles, and enough work on the board for a task
to be created, opened, and updated. Everything here is disposable and
idempotent, so running it twice leaves the same fixture behind rather than a
second copy of it.

Two things it deliberately does not do. It does not carry a password in the
repository - the caller passes one, and the runner generates a fresh one per
run. And it is meant to be pointed at a throwaway database; the runner sets
WORKSPACE_DB_NAME so it cannot touch the development one by accident, because
it deletes and recreates the workspace's tasks on every run.
"""

import json

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from tasks.models import (
    Membership,
    Project,
    Task,
    UserProfile,
    Workspace,
    WorkspaceNotification,
)

SLUG = 'browser-fixtures'
# A second, empty workspace the owner also belongs to, and opens on. Choosing
# where to work is part of the journey, and a switch is only a switch if there
# is somewhere to switch from.
OTHER_SLUG = 'browser-fixtures-elsewhere'

# One account per role, so a journey can sign in as whoever the behaviour under
# test depends on. The domain is reserved for examples and cannot receive mail.
ACCOUNTS = (
    ('browser-owner@example.invalid', 'owner'),
    ('browser-manager@example.invalid', 'manager'),
    ('browser-member@example.invalid', 'member'),
)

SEEDED_TASKS = 6


class Command(BaseCommand):
    help = 'Create or refresh the disposable workspace the browser journeys use.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--password',
            required=True,
            help='Password for the three fixture accounts. Passed in rather than stored.',
        )

    def handle(self, *args, **options):
        password = options['password']
        if not password:
            raise CommandError('--password must not be empty.')

        workspace, _ = Workspace.objects.get_or_create(
            slug=SLUG, defaults={'name': 'Browser Fixtures'}
        )

        for email, role in ACCOUNTS:
            user, _ = User.objects.get_or_create(email=email, defaults={'username': email})
            user.set_password(password)
            # Named, so anything the app renders from a display name reads as a
            # person rather than as an email address.
            user.first_name = 'Browser'
            user.last_name = role.capitalize()
            user.save()
            Membership.objects.update_or_create(
                workspace=workspace, user=user, defaults={'role': role}
            )

        Project.objects.get_or_create(
            workspace=workspace, name='Fixture project', defaults={'status': 'active'}
        )

        elsewhere, _ = Workspace.objects.get_or_create(
            slug=OTHER_SLUG, defaults={'name': 'Browser Fixtures Elsewhere'}
        )
        owner = User.objects.get(email=ACCOUNTS[0][0])
        Membership.objects.update_or_create(
            workspace=elsewhere, user=owner, defaults={'role': 'owner'}
        )
        # The owner opens here, so the journey has to choose the workspace with
        # the work in it rather than being handed it.
        profile, _ = UserProfile.objects.get_or_create(user=owner)
        profile.default_workspace = elsewhere
        profile.save(update_fields=['default_workspace'])

        # Recreated rather than reused: a journey that creates and updates tasks
        # must start from the same board every time.
        Task.objects.filter(workspace=workspace).delete()
        today = timezone.localdate()
        # Assigned to the owner deliberately. The daily view shows what is
        # assigned to you, so an unassigned board would look empty to the person
        # the journeys sign in as, and there would be nothing on screen to open.
        Task.objects.bulk_create(
            [
                Task(
                    workspace=workspace,
                    title=f'Fixture task {index + 1}',
                    code=f'FIX-{index + 1}',
                    description='Seed row for the browser journeys.',
                    assignee=owner,
                    assignee_name=owner.get_full_name() or owner.email,
                    bucket='Backlog',
                    status='todo',
                    due_date=today,
                    position=index,
                )
                for index in range(SEEDED_TASKS)
            ]
        )

        # One unread alert naming the first task, so the bell has a row to open
        # and following it can be checked to land on the record it names.
        target = Task.objects.filter(workspace=workspace).order_by('position').first()
        WorkspaceNotification.objects.filter(
            workspace=workspace, recipient=owner, kind='test_fixture'
        ).delete()
        WorkspaceNotification.objects.create(
            workspace=workspace,
            recipient=owner,
            kind='test_fixture',
            title='Fixture alert naming a task',
            body='Seeded for the notification journey.',
            target_type='task',
            target_id=str(target.id),
        )

        # Ids, counts and addresses only. Nothing secret, so this is safe in CI
        # logs, and the accounts go out as JSON so the runner can pass them to
        # the journeys rather than repeating the list and letting it drift.
        self.stdout.write(
            f'workspace_slug={workspace.slug} '
            f'workspace_id={workspace.id} '
            f'tasks={Task.objects.filter(workspace=workspace).count()} '
            f'notification_target={target.code}'
        )
        self.stdout.write(
            'fixture_accounts='
            + json.dumps({role: address for address, role in ACCOUNTS})
        )
