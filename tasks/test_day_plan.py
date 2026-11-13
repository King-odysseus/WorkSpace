import json

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import Membership, PersonalPlanner, PersonalTask, PlannerDayNote, Workspace


class DayPlanTests(TestCase):
    def setUp(self):
        self.ada = User.objects.create_user('ada@example.com', 'ada@example.com', 'password')
        self.bo = User.objects.create_user('bo@example.com', 'bo@example.com', 'password')
        self.workspace = Workspace.objects.create(name='Plans', slug='plans')
        for user in (self.ada, self.bo):
            Membership.objects.create(workspace=self.workspace, user=user, role='member')
        self.url = reverse('personal-day-plan', args=[self.workspace.id])
        self.client.force_login(self.ada)

    def put(self, body, **extra):
        return self.client.put(self.url, data=json.dumps({'body': body, **extra}), content_type='application/json')

    def test_save_read_replace_and_delete(self):
        self.assertIsNone(self.client.get(self.url).json()['note'])
        self.assertEqual(self.put('9:00 Report (2h)\n11:00 Break').status_code, 200)
        self.assertIn('Break', self.client.get(self.url).json()['note']['body'])
        self.put('New plan')
        self.assertEqual(PlannerDayNote.objects.count(), 1)
        self.assertEqual(self.client.get(self.url).json()['note']['body'], 'New plan')
        self.client.delete(self.url)
        self.assertEqual(PlannerDayNote.objects.count(), 0)

    def test_each_day_has_its_own_note(self):
        self.put('Today', date='2026-01-05')
        self.put('Later', date='2026-01-06')
        self.assertEqual(self.client.get(self.url + '?date=2026-01-05').json()['note']['body'], 'Today')
        self.assertEqual(self.client.get(self.url + '?date=2026-01-06').json()['note']['body'], 'Later')

    def test_nobody_else_sees_or_deletes_it(self):
        self.put('Private plan')
        self.client.force_login(self.bo)
        self.assertIsNone(self.client.get(self.url).json()['note'])
        self.client.delete(self.url)
        self.assertEqual(PlannerDayNote.objects.count(), 1)

    def test_bad_input_and_outsiders_are_refused(self):
        self.assertEqual(self.put('').status_code, 400)
        self.assertEqual(self.put('x' * 6001).status_code, 400)
        self.assertEqual(self.put('ok', date='nope').status_code, 400)
        self.client.force_login(User.objects.create_user('out@example.com', 'out@example.com', 'password'))
        self.assertGreaterEqual(self.client.get(self.url).status_code, 400)

    def test_a_note_never_counts_as_planner_work(self):
        planner = PersonalPlanner.objects.create(workspace=self.workspace, owner=self.ada, name='My day')
        PersonalTask.objects.create(planner=planner, owner=self.ada, title='Real', due_date=timezone.localdate())
        self.put('A plan')
        self.assertEqual(PersonalTask.objects.count(), 1)
        self.assertEqual(self.client.get(reverse('personal-planner-list', args=[self.workspace.id])).json()['tasks'].__len__(), 1)
