import json

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from .ai_actions import PrivacyRegistry, build_workspace_snapshot
from .models import LookupValue, Membership, PlanBucket, Project, Task, TaskAssignee, Workspace


class BoardAccessTests(TestCase):
    """Boards (projects and operations workstreams) belong to the people added to them."""

    def setUp(self):
        self.workspace = Workspace.objects.create(name='Boards', slug='boards')
        self.owner = self._person('owner', 'owner')
        self.manager = self._person('manager', 'manager')
        self.ada = self._person('ada', 'member')
        self.ben = self._person('ben', 'member')
        self.p1 = Project.objects.create(workspace=self.workspace, name='Website')
        self.p2 = Project.objects.create(workspace=self.workspace, name='Academy')
        self.p1.members.add(self.ada)
        self.daily = LookupValue.objects.create(workspace=self.workspace, kind='workstream', name='Daily operations', slug='daily-operations')
        self.daily.members.add(self.ben)
        self.t1 = Task.objects.create(workspace=self.workspace, title='Website task', project_ref=self.p1)
        self.t2 = Task.objects.create(workspace=self.workspace, title='Academy task', project_ref=self.p2)
        self.t3 = Task.objects.create(workspace=self.workspace, title='Daily task', workstream_ref=self.daily)
        self.t4 = Task.objects.create(workspace=self.workspace, title='Loose task')

    def _person(self, name, role):
        user = User.objects.create_user(username=f'{name}@example.com', email=f'{name}@example.com', password='secure-pass-123')
        Membership.objects.create(workspace=self.workspace, user=user, role=role)
        return user

    def _titles(self, user):
        self.client.force_login(user)
        response = self.client.get(reverse('task-list'), {'workspace_id': self.workspace.id, 'page_size': 200})
        self.assertEqual(response.status_code, 200)
        return {task['title'] for task in response.json()['tasks']}

    def _patch(self, user, task, payload):
        self.client.force_login(user)
        return self.client.patch(reverse('task-detail', args=[task.id]), data=json.dumps(payload), content_type='application/json')

    def _members_url(self, kind, board):
        return reverse('board-members', args=[self.workspace.id, kind, board.id])

    # --- who sees what -------------------------------------------------------------------

    def test_owners_and_managers_see_every_board_and_members_only_their_own(self):
        everything = {'Website task', 'Academy task', 'Daily task', 'Loose task'}
        self.assertEqual(self._titles(self.owner), everything)
        self.assertEqual(self._titles(self.manager), everything)
        self.assertEqual(self._titles(self.ada), {'Website task', 'Loose task'})
        self.assertEqual(self._titles(self.ben), {'Daily task', 'Loose task'})

    def test_a_task_given_to_someone_stays_visible_to_them_off_their_board(self):
        TaskAssignee.objects.create(task=self.t2, user=self.ada, position=0)
        self.assertIn('Academy task', self._titles(self.ada))

    def test_a_task_on_a_board_the_person_cannot_see_is_not_found(self):
        self.client.force_login(self.ada)
        self.assertEqual(self.client.get(reverse('task-detail', args=[self.t2.id])).status_code, 404)
        self.assertEqual(self.client.get(reverse('task-detail', args=[self.t1.id])).status_code, 200)

    def test_board_lists_follow_the_same_rule(self):
        self.client.force_login(self.ada)
        projects = self.client.get(reverse('project-list', args=[self.workspace.id])).json()['projects']
        self.assertEqual([project['name'] for project in projects], ['Website'])
        streams = self.client.get(reverse('lookup-value-list', args=[self.workspace.id]), {'kind': 'workstream'}).json()['lookup_values']
        self.assertEqual(streams, [])
        PlanBucket.objects.create(workspace=self.workspace, project=self.p1, name='Doing')
        PlanBucket.objects.create(workspace=self.workspace, project=self.p2, name='Hidden lane')
        PlanBucket.objects.create(workspace=self.workspace, name='Shared lane')
        names = {bucket['name'] for bucket in self.client.get(reverse('plan-bucket-list', args=[self.workspace.id])).json()['buckets']}
        self.assertIn('Doing', names)
        self.assertIn('Shared lane', names)
        self.assertNotIn('Hidden lane', names)

        self.client.force_login(self.manager)
        projects = self.client.get(reverse('project-list', args=[self.workspace.id])).json()['projects']
        self.assertEqual({project['name'] for project in projects}, {'Website', 'Academy'})

    def test_search_does_not_show_tasks_from_boards_the_person_is_not_on(self):
        self.client.force_login(self.ada)
        results = self.client.get(reverse('workspace-search', args=[self.workspace.id]), {'q': 'task'}).json()['results']
        titles = {item['title'] for item in results if item['kind'] == 'task'}
        self.assertEqual(titles, {'Website task', 'Loose task'})

    # --- editing -------------------------------------------------------------------------

    def test_anyone_on_a_board_can_edit_its_tasks_and_no_one_elses(self):
        ok = self._patch(self.ada, self.t1, {'title': 'Website task v2', 'status': 'in_progress', 'bucket': 'Backlog'})
        self.assertEqual(ok.status_code, 200)
        self.t1.refresh_from_db()
        self.assertEqual((self.t1.title, self.t1.status), ('Website task v2', 'in_progress'))
        self.assertIn(self._patch(self.ada, self.t2, {'title': 'Hijack'}).status_code, (403, 404))
        self.t2.refresh_from_db()
        self.assertEqual(self.t2.title, 'Academy task')

    def test_a_board_member_cannot_move_a_task_to_another_board_or_archive_it(self):
        self.assertEqual(self._patch(self.ada, self.t1, {'project_id': self.p2.id}).status_code, 403)
        self.assertEqual(self._patch(self.ada, self.t1, {'state': 'archived'}).status_code, 403)

    def test_a_member_can_add_tasks_only_to_boards_they_are_on(self):
        self.client.force_login(self.ada)
        url = f"{reverse('task-list')}?workspace_id={self.workspace.id}"
        created = self.client.post(url, data=json.dumps({'title': 'New on Website', 'project_id': self.p1.id}), content_type='application/json')
        self.assertEqual(created.status_code, 201, created.content)
        refused = self.client.post(url, data=json.dumps({'title': 'Sneaky', 'project_id': self.p2.id}), content_type='application/json')
        self.assertEqual(refused.status_code, 403)

    # --- who is on a board ---------------------------------------------------------------

    def test_owners_and_managers_choose_who_is_on_a_board(self):
        self.client.force_login(self.manager)
        saved = self.client.put(self._members_url('project', self.p2), data=json.dumps({'member_ids': [self.ada.id, self.ben.id]}), content_type='application/json')
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(set(saved.json()['member_ids']), {self.ada.id, self.ben.id})
        self.assertIn('Academy task', self._titles(self.ada))
        self.client.force_login(self.manager)
        saved = self.client.put(self._members_url('workstream', self.daily), data=json.dumps({'member_ids': []}), content_type='application/json')
        self.assertEqual(saved.status_code, 200)
        self.assertNotIn('Daily task', self._titles(self.ben))

    def test_a_member_can_read_their_boards_people_but_not_change_them(self):
        self.client.force_login(self.ada)
        read = self.client.get(self._members_url('project', self.p1))
        self.assertEqual(read.status_code, 200)
        self.assertEqual(read.json()['member_ids'], [self.ada.id])
        self.assertEqual(self.client.put(self._members_url('project', self.p1), data=json.dumps({'member_ids': [self.ada.id, self.ben.id]}), content_type='application/json').status_code, 403)
        self.assertEqual(self.client.get(self._members_url('project', self.p2)).status_code, 404)

    def test_only_people_in_the_workspace_can_be_added(self):
        outsider = User.objects.create_user(username='outsider@example.com', email='outsider@example.com', password='secure-pass-123')
        self.client.force_login(self.owner)
        refused = self.client.put(self._members_url('project', self.p1), data=json.dumps({'member_ids': [outsider.id]}), content_type='application/json')
        self.assertEqual(refused.status_code, 404)
        self.assertEqual(self.client.put(self._members_url('project', self.p1), data=json.dumps({'member_ids': 'all'}), content_type='application/json').status_code, 400)

    def test_someone_who_left_is_not_offered_back_and_does_not_block_saving(self):
        gone = User.objects.create_user(username='gone@example.com', email='gone@example.com', password='secure-pass-123')
        self.p1.members.add(gone)
        self.client.force_login(self.owner)
        read = self.client.get(self._members_url('project', self.p1)).json()
        self.assertNotIn(gone.id, read['member_ids'])
        saved = self.client.put(self._members_url('project', self.p1), data=json.dumps({'member_ids': read['member_ids'] + [self.owner.id]}), content_type='application/json')
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(set(saved.json()['member_ids']), {self.ada.id, self.owner.id})
        self.assertFalse(self.p1.members.filter(id=gone.id).exists())

    def test_the_owner_can_put_themselves_on_a_board(self):
        self.client.force_login(self.owner)
        saved = self.client.put(self._members_url('workstream', self.daily), data=json.dumps({'member_ids': [self.ben.id, self.owner.id]}), content_type='application/json')
        self.assertEqual(saved.status_code, 200)
        self.assertIn(self.owner.id, saved.json()['member_ids'])

    # --- private boards ------------------------------------------------------------------

    def test_a_private_board_is_seen_by_its_maker_alone_not_even_the_owner(self):
        private = Project.objects.create(workspace=self.workspace, name='Manager only', is_private=True, created_by=self.manager)
        Task.objects.create(workspace=self.workspace, title='Secret plan', project_ref=private)
        self.assertIn('Secret plan', self._titles(self.manager))
        self.assertNotIn('Secret plan', self._titles(self.owner))
        self.assertNotIn('Secret plan', self._titles(self.ada))
        self.client.force_login(self.owner)
        self.assertEqual(self.client.get(self._members_url('project', private)).status_code, 404)

    def test_a_board_made_through_the_api_starts_with_its_maker_on_it(self):
        self.client.force_login(self.manager)
        created = self.client.post(reverse('project-list', args=[self.workspace.id]), data=json.dumps({'name': 'Fresh board'}), content_type='application/json')
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json()['project']['member_ids'], [self.manager.id])
        self.assertFalse(created.json()['project']['is_private'])

    # --- Zuri ----------------------------------------------------------------------------

    def test_zuri_only_reads_what_the_person_can_see(self):
        registry = PrivacyRegistry(self.workspace.id, self.ada)
        snapshot = build_workspace_snapshot(self.workspace.id, self.ada, registry)
        titles = {row['title'] for row in snapshot['tasks']}
        self.assertEqual(titles, {'Website task', 'Loose task'})
        self.assertEqual([row['name'] for row in snapshot['projects']], ['Website'])
        self.assertEqual(snapshot['workstreams'], [])
        self.assertEqual(snapshot['task_count'], 2)

        owner_snapshot = build_workspace_snapshot(self.workspace.id, self.owner, PrivacyRegistry(self.workspace.id, self.owner))
        self.assertEqual(owner_snapshot['task_count'], 4)
