import json
from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import Membership, Milestone, Task, Workspace


class MilestoneTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner@example.com', 'owner@example.com', 'password')
        self.member = User.objects.create_user('member@example.com', 'member@example.com', 'password')
        self.outsider = User.objects.create_user('out@example.com', 'out@example.com', 'password')
        self.workspace = Workspace.objects.create(name='Plans', slug='plans')
        self.other = Workspace.objects.create(name='Other', slug='other')
        Membership.objects.create(workspace=self.workspace, user=self.owner, role='owner')
        Membership.objects.create(workspace=self.workspace, user=self.member, role='member')
        Membership.objects.create(workspace=self.other, user=self.outsider, role='owner')
        self.today = timezone.localdate()
        self.client.force_login(self.owner)

    def url(self):
        return reverse('milestones', args=[self.workspace.id])

    def post(self, data, user=None):
        if user:
            self.client.force_login(user)
        return self.client.post(self.url(), json.dumps(data), content_type='application/json')

    def test_a_leader_adds_a_milestone_and_everyone_can_read_it(self):
        response = self.post({'title': 'Launch', 'due_date': (self.today + timedelta(days=10)).isoformat()})
        self.assertEqual(response.status_code, 201)
        self.client.force_login(self.member)
        listed = self.client.get(self.url()).json()['milestones']
        self.assertEqual([m['title'] for m in listed], ['Launch'])
        self.assertFalse(listed[0]['complete'])

    def test_a_member_cannot_add_change_or_remove_milestones(self):
        milestone = Milestone.objects.create(workspace=self.workspace, title='Launch', due_date=self.today)
        self.assertEqual(self.post({'title': 'Mine', 'due_date': self.today.isoformat()}, self.member).status_code, 403)
        detail = reverse('milestone-detail', args=[self.workspace.id, milestone.id])
        self.assertEqual(self.client.patch(detail, json.dumps({'title': 'X'}), content_type='application/json').status_code, 403)
        self.assertEqual(self.client.delete(detail).status_code, 403)

    def test_a_title_and_a_date_are_required(self):
        self.assertEqual(self.post({'due_date': self.today.isoformat()}).status_code, 400)
        self.assertEqual(self.post({'title': 'No date'}).status_code, 400)
        self.assertEqual(self.post({'title': 'Bad', 'due_date': 'tomorrow'}).status_code, 400)

    def test_progress_comes_from_the_tasks_on_it_and_reaching_it_is_automatic(self):
        milestone = Milestone.objects.create(workspace=self.workspace, title='Beta', due_date=self.today + timedelta(days=3))
        done = Task.objects.create(workspace=self.workspace, title='Done one', status='done', milestone=milestone)
        Task.objects.create(workspace=self.workspace, title='Open one', milestone=milestone)
        Task.objects.create(workspace=self.workspace, title='Cancelled', status='cancelled', milestone=milestone)
        listed = self.client.get(self.url()).json()['milestones'][0]
        self.assertEqual((listed['task_count'], listed['done_count'], listed['complete']), (2, 1, False))
        Task.objects.exclude(id=done.id).update(status='done')
        self.assertTrue(self.client.get(self.url()).json()['milestones'][0]['complete'])

    def test_a_milestone_past_its_date_is_late_until_it_is_reached(self):
        milestone = Milestone.objects.create(workspace=self.workspace, title='Old', due_date=self.today - timedelta(days=2))
        self.assertTrue(self.client.get(self.url()).json()['milestones'][0]['is_late'])
        detail = reverse('milestone-detail', args=[self.workspace.id, milestone.id])
        response = self.client.patch(detail, json.dumps({'completed': True}), content_type='application/json').json()['milestone']
        self.assertTrue(response['complete'])
        self.assertFalse(response['is_late'])

    def test_a_leader_renames_moves_and_deletes_it_and_its_tasks_stay(self):
        milestone = Milestone.objects.create(workspace=self.workspace, title='Old', due_date=self.today)
        task = Task.objects.create(workspace=self.workspace, title='Stays', milestone=milestone)
        detail = reverse('milestone-detail', args=[self.workspace.id, milestone.id])
        changed = self.client.patch(detail, json.dumps({'title': 'New', 'due_date': (self.today + timedelta(days=5)).isoformat()}), content_type='application/json').json()['milestone']
        self.assertEqual(changed['title'], 'New')
        self.assertEqual(self.client.delete(detail).status_code, 200)
        task.refresh_from_db()
        self.assertIsNone(task.milestone_id)

    def test_other_workspaces_milestones_are_out_of_reach(self):
        theirs = Milestone.objects.create(workspace=self.other, title='Theirs', due_date=self.today)
        self.assertEqual(self.client.get(self.url()).json()['milestones'], [])
        self.assertEqual(self.client.delete(reverse('milestone-detail', args=[self.workspace.id, theirs.id])).status_code, 404)

    def test_a_task_is_attached_and_detached_and_shows_it(self):
        milestone = Milestone.objects.create(workspace=self.workspace, title='Beta', due_date=self.today)
        task = Task.objects.create(workspace=self.workspace, title='Work')
        url = reverse('task-milestone', args=[task.id])
        attached = self.client.put(url, json.dumps({'milestone_id': milestone.id}), content_type='application/json').json()['task']
        self.assertEqual(attached['milestone_id'], milestone.id)
        detached = self.client.put(url, json.dumps({'milestone_id': None}), content_type='application/json').json()['task']
        self.assertIsNone(detached['milestone_id'])

    def test_a_task_cannot_be_attached_to_another_workspaces_milestone(self):
        theirs = Milestone.objects.create(workspace=self.other, title='Theirs', due_date=self.today)
        task = Task.objects.create(workspace=self.workspace, title='Work')
        response = self.client.put(reverse('task-milestone', args=[task.id]), json.dumps({'milestone_id': theirs.id}), content_type='application/json')
        self.assertEqual(response.status_code, 404)

    def test_someone_outside_the_workspace_cannot_attach_its_tasks(self):
        milestone = Milestone.objects.create(workspace=self.workspace, title='Beta', due_date=self.today)
        task = Task.objects.create(workspace=self.workspace, title='Work')
        self.client.force_login(self.outsider)
        response = self.client.put(reverse('task-milestone', args=[task.id]), json.dumps({'milestone_id': milestone.id}), content_type='application/json')
        self.assertIn(response.status_code, (403, 404))
        task.refresh_from_db()
        self.assertIsNone(task.milestone_id)
