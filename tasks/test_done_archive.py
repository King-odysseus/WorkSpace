from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import Membership, Task, Workspace
from .views import archive_old_done_tasks


class DoneArchiveTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('o@example.com', 'o@example.com', 'password')
        self.workspace = Workspace.objects.create(name='Archive', slug='archive')
        Membership.objects.create(workspace=self.workspace, user=self.user, role='owner')
        self.client.force_login(self.user)

    def make(self, title, status='done', days_ago=0, completed=True):
        task = Task.objects.create(workspace=self.workspace, title=title, status=status, assignee=self.user)
        when = timezone.now() - timedelta(days=days_ago)
        Task.objects.filter(pk=task.pk).update(completed_at=when if completed else None, updated_at=when)
        return task

    def test_only_tasks_done_over_60_days_ago_move(self):
        old = self.make('Old', days_ago=61)
        recent = self.make('Recent', days_ago=59)
        open_task = self.make('Open', status='todo', days_ago=200, completed=False)
        self.assertEqual(archive_old_done_tasks(self.workspace.id), 1)
        for task in (old, recent, open_task):
            task.refresh_from_db()
        self.assertEqual((old.state, recent.state, open_task.state), ('archived', 'active', 'active'))

    def test_the_board_hides_them_and_the_archive_still_lists_them(self):
        self.make('Old', days_ago=90)
        self.make('Recent', days_ago=5)
        url = reverse('workspace-task-list', args=[self.workspace.id]) if False else f'/api/workspaces/{self.workspace.id}/tasks/'
        titles = [t['title'] for t in self.client.get(url).json()['tasks']]
        self.assertEqual(titles, ['Recent'])
        archived = [t['title'] for t in self.client.get(url + '?archived=true').json()['tasks']]
        self.assertEqual(archived, ['Old'])

    def test_running_it_twice_changes_nothing_more(self):
        self.make('Old', days_ago=90)
        archive_old_done_tasks(self.workspace.id)
        self.assertEqual(archive_old_done_tasks(self.workspace.id), 0)
