import json

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from .models import Membership, PersonalPlanner, PersonalTask, Workspace


class StickyNoteTests(TestCase):
    def setUp(self):
        self.ada = User.objects.create_user('ada@example.com', 'ada@example.com', 'password')
        self.bo = User.objects.create_user('bo@example.com', 'bo@example.com', 'password')
        self.workspace = Workspace.objects.create(name='Notes', slug='notes')
        for user in (self.ada, self.bo):
            Membership.objects.create(workspace=self.workspace, user=user, role='member')
        self.planner = PersonalPlanner.objects.create(workspace=self.workspace, owner=self.ada, name='My day')
        self.task = PersonalTask.objects.create(planner=self.planner, owner=self.ada, title='Call the bank')
        self.client.force_login(self.ada)

    def patch(self, **data):
        return self.client.patch(reverse('personal-task-detail', args=[self.workspace.id, self.task.id]), data=json.dumps(data), content_type='application/json')

    def listing(self):
        return self.client.get(reverse('personal-planner-list', args=[self.workspace.id])).json()

    def test_a_note_keeps_its_colour_and_where_it_was_dropped(self):
        response = self.patch(color='pink', pos_x=320, pos_y=140)
        self.assertEqual(response.status_code, 200)
        task = self.listing()['tasks'][0]
        self.assertEqual((task['color'], task['pos_x'], task['pos_y']), ('pink', 320, 140))

    def test_bad_colours_and_positions_are_refused(self):
        for data in ({'color': 'neon'}, {'pos_x': -1}, {'pos_y': 99999}, {'pos_x': 'left'}, {'pos_x': True}, {'archived': 'yes'}):
            self.assertEqual(self.patch(**data).status_code, 400, data)

    def test_archiving_hides_a_note_and_restoring_brings_it_back(self):
        self.patch(archived=True)
        listing = self.listing()
        self.assertEqual(listing['tasks'], [])
        self.assertEqual([t['title'] for t in listing['archived_tasks']], ['Call the bank'])
        self.patch(archived=False)
        listing = self.listing()
        self.assertEqual([t['title'] for t in listing['tasks']], ['Call the bank'])
        self.assertEqual(listing['archived_tasks'], [])

    def test_moving_a_note_never_touches_somebody_elses(self):
        self.client.force_login(self.bo)
        self.assertEqual(self.patch(pos_x=10).status_code, 404)
        self.assertIsNone(PersonalTask.objects.get(id=self.task.id).pos_x)

    def test_the_today_note_saves_per_person_and_can_be_cleared(self):
        url = reverse('personal-quick-note', args=[self.workspace.id])
        self.assertEqual(self.client.get(url).json()['note']['body'], '')
        self.client.put(url, data=json.dumps({'body': 'Ring Sam at 3', 'color': 'green'}), content_type='application/json')
        self.assertEqual(self.client.get(url).json()['note'], {**self.client.get(url).json()['note'], 'body': 'Ring Sam at 3', 'color': 'green'})
        self.client.force_login(self.bo)
        self.assertEqual(self.client.get(url).json()['note']['body'], '')
        self.client.force_login(self.ada)
        self.client.delete(url)
        self.assertEqual(self.client.get(url).json()['note']['body'], '')

    def test_the_today_note_refuses_bad_input(self):
        url = reverse('personal-quick-note', args=[self.workspace.id])
        self.assertEqual(self.client.put(url, data=json.dumps({'color': 'neon'}), content_type='application/json').status_code, 400)
        self.assertEqual(self.client.put(url, data=json.dumps({'body': 'x' * 2001}), content_type='application/json').status_code, 400)
