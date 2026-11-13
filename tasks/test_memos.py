import json
from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import Membership, Memo, MemoDismissal, Workspace, WorkspaceNotification


class MemoTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner@example.com', 'owner@example.com', 'password', first_name='Olive', last_name='Owner')
        self.manager = User.objects.create_user('manager@example.com', 'manager@example.com', 'password')
        self.member = User.objects.create_user('member@example.com', 'member@example.com', 'password')
        self.outsider = User.objects.create_user('outsider@example.com', 'outsider@example.com', 'password')
        self.workspace = Workspace.objects.create(name='Memo workspace', slug='memo-workspace')
        Membership.objects.create(workspace=self.workspace, user=self.owner, role='owner')
        Membership.objects.create(workspace=self.workspace, user=self.manager, role='manager')
        Membership.objects.create(workspace=self.workspace, user=self.member, role='member')
        self.client.force_login(self.owner)

    def post_memo(self, **payload):
        data = {'title': 'Holiday schedule', 'body': 'The office is closed on Friday.'}
        data.update(payload)
        return self.client.post(reverse('memo-list', args=[self.workspace.id]), data=json.dumps(data), content_type='application/json')

    def test_an_owner_posts_a_memo_with_a_week_long_banner_by_default(self):
        response = self.post_memo()
        self.assertEqual(response.status_code, 201)
        memo = response.json()['memo']
        self.assertEqual(memo['title'], 'Holiday schedule')
        self.assertEqual(memo['author_name'], 'Olive Owner')
        self.assertTrue(memo['banner_active'])
        stored = Memo.objects.get(id=memo['id'])
        self.assertAlmostEqual((stored.banner_until - timezone.now()).total_seconds(), 7 * 86400, delta=60)

    def test_a_manager_can_post_but_a_plain_member_cannot(self):
        self.client.force_login(self.manager)
        self.assertEqual(self.post_memo().status_code, 201)
        self.client.force_login(self.member)
        refused = self.post_memo(title='Not allowed')
        self.assertEqual(refused.status_code, 403)
        self.assertFalse(Memo.objects.filter(title='Not allowed').exists())
        listed = self.client.get(reverse('memo-list', args=[self.workspace.id])).json()
        self.assertFalse(listed['can_post'])
        self.assertEqual(len(listed['memos']), 1)

    def test_a_manager_whose_permission_was_taken_away_cannot_post(self):
        Membership.objects.filter(user=self.manager).update(permissions=['create_tasks'])
        self.client.force_login(self.manager)
        self.assertEqual(self.post_memo().status_code, 403)

    def test_a_memo_needs_a_title_and_text_within_the_limits(self):
        self.assertEqual(self.post_memo(title='  ').status_code, 400)
        self.assertEqual(self.post_memo(body='').status_code, 400)
        self.assertEqual(self.post_memo(title='x' * 161).status_code, 400)
        self.assertEqual(self.post_memo(body='x' * 5001).status_code, 400)
        self.assertEqual(self.post_memo(banner_days=99).status_code, 400)
        self.assertEqual(self.post_memo(banner_days='soon').status_code, 400)

    def test_banner_days_zero_means_no_banner(self):
        memo = self.post_memo(banner_days=0).json()['memo']
        self.assertFalse(memo['banner_active'])
        self.assertIsNone(Memo.objects.get(id=memo['id']).banner_until)

    def test_posting_notifies_everyone_else_but_not_the_author(self):
        memo = self.post_memo().json()['memo']
        alerts = WorkspaceNotification.objects.filter(kind='memo')
        self.assertEqual({alert.recipient_id for alert in alerts}, {self.manager.id, self.member.id})
        alert = alerts.first()
        self.assertEqual((alert.target_type, alert.target_id), ('memo', str(memo['id'])))
        self.assertIn('Holiday schedule', alert.title)

    def test_dismissing_a_banner_only_affects_the_person_who_closed_it(self):
        memo = self.post_memo().json()['memo']
        self.client.force_login(self.member)
        dismissed = self.client.post(reverse('memo-dismiss', args=[self.workspace.id, memo['id']]))
        self.assertEqual(dismissed.status_code, 200)
        self.client.post(reverse('memo-dismiss', args=[self.workspace.id, memo['id']]))  # harmless twice
        self.assertEqual(MemoDismissal.objects.filter(memo_id=memo['id']).count(), 1)
        mine = self.client.get(reverse('memo-list', args=[self.workspace.id])).json()['memos'][0]
        self.assertTrue(mine['dismissed'])
        self.client.force_login(self.manager)
        theirs = self.client.get(reverse('memo-list', args=[self.workspace.id])).json()['memos'][0]
        self.assertFalse(theirs['dismissed'])

    def test_an_expired_banner_stops_showing_but_the_memo_stays_listed(self):
        memo = self.post_memo().json()['memo']
        Memo.objects.filter(id=memo['id']).update(banner_until=timezone.now() - timedelta(minutes=1))
        listed = self.client.get(reverse('memo-list', args=[self.workspace.id])).json()['memos']
        self.assertEqual([item['id'] for item in listed], [memo['id']])
        self.assertFalse(listed[0]['banner_active'])

    def test_only_the_author_or_an_owner_can_edit_or_remove_a_memo(self):
        self.client.force_login(self.manager)
        memo = self.post_memo(title='Manager memo').json()['memo']
        other_manager = User.objects.create_user('other@example.com', 'other@example.com', 'password')
        Membership.objects.create(workspace=self.workspace, user=other_manager, role='manager')
        self.client.force_login(other_manager)
        url = reverse('memo-detail', args=[self.workspace.id, memo['id']])
        self.assertEqual(self.client.patch(url, data=json.dumps({'title': 'Hijacked'}), content_type='application/json').status_code, 403)
        self.assertEqual(self.client.delete(url).status_code, 403)

        self.client.force_login(self.manager)
        edited = self.client.patch(url, data=json.dumps({'title': 'Updated', 'banner_days': 0}), content_type='application/json')
        self.assertEqual(edited.status_code, 200)
        self.assertEqual(edited.json()['memo']['title'], 'Updated')
        self.assertFalse(edited.json()['memo']['banner_active'])

        self.client.force_login(self.owner)  # an owner may remove anyone's
        self.assertEqual(self.client.delete(url).status_code, 200)
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertTrue(Memo.objects.get(id=memo['id']).archived_at is not None)

    def test_outsiders_cannot_read_post_or_dismiss(self):
        memo = self.post_memo().json()['memo']
        self.client.force_login(self.outsider)
        self.assertEqual(self.client.get(reverse('memo-list', args=[self.workspace.id])).status_code, 403)
        self.assertEqual(self.post_memo().status_code, 403)
        self.assertEqual(self.client.post(reverse('memo-dismiss', args=[self.workspace.id, memo['id']])).status_code, 403)

    def test_memos_do_not_leak_between_workspaces(self):
        other = Workspace.objects.create(name='Other', slug='other')
        Membership.objects.create(workspace=other, user=self.owner, role='owner')
        memo = self.post_memo().json()['memo']
        wrong = self.client.get(reverse('memo-detail', args=[other.id, memo['id']]))
        self.assertEqual(wrong.status_code, 404)


class MemoHistoryTests(MemoTests):
    def test_archived_memos_are_history_and_can_be_restored(self):
        memo_id = self.post_memo().json()['memo']['id']
        self.client.delete(reverse('memo-detail', args=[self.workspace.id, memo_id]))
        url = reverse('memo-list', args=[self.workspace.id])
        self.assertEqual(self.client.get(url).json()['memos'], [])
        history = self.client.get(url + '?archived=1').json()['memos']
        self.assertEqual([m['id'] for m in history], [memo_id])
        self.assertTrue(history[0]['archived'])
        restored = self.client.patch(reverse('memo-detail', args=[self.workspace.id, memo_id]), data=json.dumps({'archived': False}), content_type='application/json')
        self.assertEqual(restored.status_code, 200)
        self.assertEqual(len(self.client.get(url).json()['memos']), 1)

    def test_a_member_cannot_restore_a_memo(self):
        memo_id = self.post_memo().json()['memo']['id']
        self.client.delete(reverse('memo-detail', args=[self.workspace.id, memo_id]))
        self.client.force_login(self.member)
        response = self.client.patch(reverse('memo-detail', args=[self.workspace.id, memo_id]), data=json.dumps({'archived': False}), content_type='application/json')
        self.assertEqual(response.status_code, 403)


class MemoBellTests(MemoTests):
    def test_a_new_memo_shows_in_everyone_elses_notification_list_and_unread_count(self):
        self.post_memo()
        self.client.force_login(self.member)
        payload = self.client.get(reverse('notification-list', args=[self.workspace.id])).json()
        memo_items = [n for n in payload['notifications'] if n['target_type'] == 'memo']
        self.assertEqual(len(memo_items), 1)
        self.assertFalse(memo_items[0]['read'])
        self.assertTrue(memo_items[0]['title'].startswith('Memo:'))

    def test_two_memos_give_two_unread_notifications(self):
        self.post_memo(title='One')
        self.post_memo(title='Two')
        self.client.force_login(self.member)
        payload = self.client.get(reverse('notification-list', args=[self.workspace.id])).json()
        self.assertEqual(len([n for n in payload['notifications'] if n['target_type'] == 'memo' and not n['read']]), 2)
