import json
from datetime import date, timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .models import LeaveRequest, Membership, Memo, WorkLocation, WorkRequest, Workspace, WorkspaceNotification


def monday_after(offset_weeks=1):
    today = timezone.localdate()
    return today - timedelta(days=today.weekday()) + timedelta(weeks=offset_weeks)


class Base(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner@example.com', 'owner@example.com', 'password', first_name='Olive')
        self.manager = User.objects.create_user('manager@example.com', 'manager@example.com', 'password', first_name='Max')
        self.other_manager = User.objects.create_user('m2@example.com', 'm2@example.com', 'password')
        self.member = User.objects.create_user('member@example.com', 'member@example.com', 'password', first_name='Mia')
        self.member2 = User.objects.create_user('member2@example.com', 'member2@example.com', 'password')
        self.workspace = Workspace.objects.create(name='People', slug='people')
        for user, role in ((self.owner, 'owner'), (self.manager, 'manager'), (self.other_manager, 'manager'), (self.member, 'member'), (self.member2, 'member')):
            Membership.objects.create(workspace=self.workspace, user=user, role=role)

    def url(self, name, *args):
        return reverse(name, args=[self.workspace.id, *args])

    def send(self, method, url, data=None):
        return getattr(self.client, method)(url, data=json.dumps(data or {}), content_type='application/json')


class WorkRequestTests(Base):
    def test_a_member_asks_and_the_managers_are_told(self):
        self.client.force_login(self.member)
        response = self.send('post', self.url('work-request-list'), {'title': 'New monitor', 'details': 'Mine flickers'})
        self.assertEqual(response.status_code, 201)
        told = set(WorkspaceNotification.objects.filter(kind='request').values_list('recipient_id', flat=True))
        self.assertEqual(told, {self.owner.id, self.manager.id, self.other_manager.id})

    def test_members_see_only_their_own_but_managers_see_all(self):
        WorkRequest.objects.create(workspace=self.workspace, requester=self.member, title='Mine')
        WorkRequest.objects.create(workspace=self.workspace, requester=self.member2, title='Theirs')
        self.client.force_login(self.member)
        self.assertEqual([r['title'] for r in self.client.get(self.url('work-request-list')).json()['requests']], ['Mine'])
        self.client.force_login(self.manager)
        self.assertEqual(len(self.client.get(self.url('work-request-list')).json()['requests']), 2)

    def test_a_manager_answers_and_the_requester_is_told(self):
        item = WorkRequest.objects.create(workspace=self.workspace, requester=self.member, title='Chair')
        self.client.force_login(self.manager)
        response = self.send('patch', self.url('work-request-detail', item.id), {'decision': 'approved', 'note': 'Ordered'})
        self.assertEqual(response.status_code, 200)
        item.refresh_from_db()
        self.assertEqual((item.status, item.review_note), ('approved', 'Ordered'))
        self.assertTrue(WorkspaceNotification.objects.filter(recipient=self.member, kind='request').exists())
        self.assertEqual(self.send('patch', self.url('work-request-detail', item.id), {'decision': 'declined'}).status_code, 409)

    def test_a_member_cannot_answer_or_see_anothers_request(self):
        item = WorkRequest.objects.create(workspace=self.workspace, requester=self.member, title='Chair')
        self.client.force_login(self.member2)
        self.assertEqual(self.send('patch', self.url('work-request-detail', item.id), {'decision': 'approved'}).status_code, 404)

    def test_the_requester_can_withdraw_but_not_self_approve(self):
        item = WorkRequest.objects.create(workspace=self.workspace, requester=self.manager, title='Mine')
        self.client.force_login(self.manager)
        self.assertEqual(self.send('patch', self.url('work-request-detail', item.id), {'decision': 'approved'}).status_code, 403)
        self.assertEqual(self.send('patch', self.url('work-request-detail', item.id), {'decision': 'cancel'}).status_code, 200)

    def test_bad_input_is_refused(self):
        self.client.force_login(self.member)
        for data in ({'title': ''}, {'title': 'x' * 161}, {'title': 'ok', 'needed_by': 'soon'}):
            self.assertEqual(self.send('post', self.url('work-request-list'), data).status_code, 400)


class RequestMemoTests(Base):
    def post_request_memo(self, **extra):
        self.client.force_login(self.manager)
        data = {'title': 'Send timesheets', 'body': 'Please send them by Friday.', 'kind': 'request', 'due_date': '2030-01-04', **extra}
        return self.send('post', self.url('memo-list'), data)

    def test_a_manager_asks_the_team_and_sees_who_is_waiting(self):
        response = self.post_request_memo()
        self.assertEqual(response.status_code, 201)
        memo = response.json()['memo']
        self.assertEqual((memo['kind'], memo['due_date']), ('request', '2030-01-04'))
        self.assertEqual(len(memo['waiting']), 4)
        self.assertTrue(WorkspaceNotification.objects.filter(recipient=self.member, title__startswith='Request:').exists())

    def test_answering_moves_a_person_off_the_waiting_list_and_tells_the_author(self):
        memo_id = self.post_request_memo().json()['memo']['id']
        self.client.force_login(self.member)
        response = self.send('post', self.url('memo-respond', memo_id), {'note': 'Sent'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['memo']['my_response']['note'], 'Sent')
        self.assertTrue(WorkspaceNotification.objects.filter(recipient=self.manager, title__contains='answered').exists())
        self.client.force_login(self.manager)
        listed = self.client.get(self.url('memo-list')).json()['memos'][0]
        self.assertEqual(listed['response_count'], 1)
        self.assertEqual(len(listed['waiting']), 3)
        self.assertNotIn('Mia', [w['name'] for w in listed['waiting']])

    def test_a_member_does_not_see_other_peoples_answers(self):
        memo_id = self.post_request_memo().json()['memo']['id']
        self.client.force_login(self.member2)
        self.send('post', self.url('memo-respond', memo_id), {'note': 'Done'})
        self.client.force_login(self.member)
        listed = self.client.get(self.url('memo-list')).json()['memos'][0]
        self.assertNotIn('responses', listed)
        self.assertNotIn('waiting', listed)
        self.assertIsNone(listed['my_response'])

    def test_answering_a_plain_memo_is_refused(self):
        self.client.force_login(self.manager)
        memo = Memo.objects.create(workspace=self.workspace, author=self.manager, title='FYI', body='x')
        self.assertEqual(self.send('post', self.url('memo-respond', memo.id), {}).status_code, 404)

    def test_a_member_cannot_post_a_request_memo(self):
        self.client.force_login(self.member)
        data = {'title': 'x', 'body': 'y', 'kind': 'request'}
        self.assertEqual(self.send('post', self.url('memo-list'), data).status_code, 403)

    def test_bad_kind_or_date_is_refused(self):
        self.assertEqual(self.post_request_memo(kind='poll').status_code, 400)
        self.assertEqual(self.post_request_memo(due_date='tomorrow').status_code, 400)


class LeaveTests(Base):
    def ask(self, user, **extra):
        self.client.force_login(user)
        start = monday_after()
        data = {'kind': 'annual', 'start_date': start.isoformat(), 'end_date': (start + timedelta(days=4)).isoformat(), **extra}
        return self.send('post', self.url('leave-list'), data)

    def test_a_members_leave_goes_to_managers_and_owners(self):
        response = self.ask(self.member)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['leave']['status'], 'pending')
        told = set(WorkspaceNotification.objects.filter(kind='leave').values_list('recipient_id', flat=True))
        self.assertEqual(told, {self.owner.id, self.manager.id, self.other_manager.id})

    def test_a_managers_leave_goes_to_the_owner_only(self):
        item_id = self.ask(self.manager).json()['leave']['id']
        told = set(WorkspaceNotification.objects.filter(kind='leave').values_list('recipient_id', flat=True))
        self.assertEqual(told, {self.owner.id})
        self.client.force_login(self.other_manager)
        self.assertEqual(self.send('patch', self.url('leave-detail', item_id), {'decision': 'approved'}).status_code, 404)
        self.client.force_login(self.owner)
        self.assertEqual(self.send('patch', self.url('leave-detail', item_id), {'decision': 'approved'}).status_code, 200)

    def test_an_owners_leave_is_approved_at_once(self):
        self.assertEqual(self.ask(self.owner).json()['leave']['status'], 'approved')

    def test_a_manager_approves_a_member_and_the_member_is_told(self):
        item_id = self.ask(self.member).json()['leave']['id']
        self.client.force_login(self.manager)
        self.assertEqual(self.send('patch', self.url('leave-detail', item_id), {'decision': 'approved', 'note': 'Enjoy'}).status_code, 200)
        self.assertTrue(WorkspaceNotification.objects.filter(recipient=self.member, kind='leave', title__contains='approved').exists())

    def test_nobody_decides_their_own_leave(self):
        item_id = self.ask(self.manager).json()['leave']['id']
        self.client.force_login(self.manager)
        self.assertGreaterEqual(self.send('patch', self.url('leave-detail', item_id), {'decision': 'approved'}).status_code, 403)
        self.assertEqual(LeaveRequest.objects.get(id=item_id).status, 'pending')

    def test_a_member_cannot_decide_anything(self):
        item_id = self.ask(self.member).json()['leave']['id']
        self.client.force_login(self.member2)
        self.assertEqual(self.send('patch', self.url('leave-detail', item_id), {'decision': 'approved'}).status_code, 404)

    def test_everyone_sees_who_is_away_but_not_why(self):
        item_id = self.ask(self.member, kind='sick', note='Private reason').json()['leave']['id']
        self.client.force_login(self.manager)
        self.send('patch', self.url('leave-detail', item_id), {'decision': 'approved'})
        self.client.force_login(self.member2)
        team = self.client.get(self.url('leave-list')).json()['team']
        self.assertEqual(len(team), 1)
        self.assertEqual(team[0]['user_name'], 'Mia')
        self.assertNotIn('kind', team[0])
        self.assertNotIn('note', team[0])
        self.assertEqual(self.client.get(self.url('leave-list')).json()['mine'], [])

    def test_pending_leave_is_not_shown_to_the_team(self):
        self.ask(self.member)
        self.client.force_login(self.member2)
        self.assertEqual(self.client.get(self.url('leave-list')).json()['team'], [])

    def test_the_approver_sees_who_else_is_off_on_those_dates(self):
        first = self.ask(self.member).json()['leave']['id']
        self.client.force_login(self.manager)
        self.send('patch', self.url('leave-detail', first), {'decision': 'approved'})
        self.ask(self.member2)
        self.client.force_login(self.manager)
        waiting = self.client.get(self.url('leave-list')).json()['to_decide']
        self.assertEqual(len(waiting), 1)
        self.assertEqual(waiting[0]['overlapping'][0]['user_name'], 'Mia')

    def test_overlapping_your_own_leave_is_refused(self):
        self.ask(self.member)
        self.assertEqual(self.ask(self.member).status_code, 400)

    def test_withdrawing(self):
        item_id = self.ask(self.member).json()['leave']['id']
        self.assertEqual(self.send('patch', self.url('leave-detail', item_id), {'decision': 'cancel'}).status_code, 200)
        self.assertEqual(LeaveRequest.objects.get(id=item_id).status, 'cancelled')
        self.assertEqual(self.ask(self.member).status_code, 201)

    def test_bad_input_is_refused(self):
        start = monday_after().isoformat()
        for data in ({'kind': 'nap', 'start_date': start}, {'start_date': ''}, {'start_date': start, 'end_date': '2000-01-01'}, {'start_date': 'x'}):
            self.client.force_login(self.member)
            self.assertEqual(self.send('post', self.url('leave-list'), data).status_code, 400, data)

    def test_half_days_count_as_half_and_weekends_are_skipped(self):
        start = monday_after()
        leave = LeaveRequest(start_date=start, end_date=start + timedelta(days=6), start_half=True, end_half=False)
        days = leave.day_fractions((0, 1, 2, 3, 4))
        self.assertEqual(len(days), 5)
        self.assertEqual(days[start], 0.5)
        self.assertEqual(sum(days.values()), 4.5)


class LocationTests(Base):
    def week(self, user):
        self.client.force_login(user)
        start = monday_after()
        url = self.url('work-locations') + f'?start={start.isoformat()}&end={(start + timedelta(days=6)).isoformat()}'
        return start, {m['name']: m for m in self.client.get(url).json()['members']}

    def test_nothing_is_guessed_without_a_pattern_or_policy(self):
        start, members = self.week(self.member)
        self.assertEqual(members['Mia']['days'][start.isoformat()]['location'], None)
        self.assertEqual(members['Mia']['days'][start.isoformat()]['source'], 'none')

    def test_the_usual_pattern_is_assumed_and_a_set_day_wins(self):
        self.client.force_login(self.member)
        self.send('put', self.url('work-location-pattern'), {'pattern': {'0': 'office', '1': 'home'}})
        self.send('put', self.url('work-locations'), {'date': monday_after().isoformat(), 'location': 'other'})
        start, members = self.week(self.owner)
        days = members['Mia']['days']
        self.assertEqual((days[start.isoformat()]['location'], days[start.isoformat()]['source']), ('other', 'set'))
        tuesday = (start + timedelta(days=1)).isoformat()
        self.assertEqual((days[tuesday]['location'], days[tuesday]['source']), ('home', 'pattern'))

    def test_the_optional_office_days_are_the_fallback(self):
        self.client.force_login(self.manager)
        self.assertEqual(self.send('patch', self.url('office-days'), {'office_days': [1, 3]}).status_code, 200)
        start, members = self.week(self.member)
        tuesday = (start + timedelta(days=1)).isoformat()
        self.assertEqual((members['Mia']['days'][tuesday]['location'], members['Mia']['days'][tuesday]['source']), ('office', 'policy'))
        self.assertEqual(members['Mia']['days'][start.isoformat()]['source'], 'none')

    def test_approved_leave_replaces_the_location(self):
        start = monday_after()
        LeaveRequest.objects.create(workspace=self.workspace, user=self.member, start_date=start, end_date=start, status='approved')
        self.client.force_login(self.member)
        self.send('put', self.url('work-location-pattern'), {'pattern': {'0': 'home'}})
        _, members = self.week(self.owner)
        day = members['Mia']['days'][start.isoformat()]
        self.assertEqual((day['location'], day['source']), (None, 'leave'))

    def test_weekends_are_not_working_days(self):
        start, members = self.week(self.member)
        self.assertEqual(members['Mia']['days'][(start + timedelta(days=5)).isoformat()]['source'], 'off')

    def test_clearing_a_day_and_validation(self):
        self.client.force_login(self.member)
        day = monday_after().isoformat()
        self.send('put', self.url('work-locations'), {'date': day, 'location': 'home'})
        self.assertEqual(WorkLocation.objects.count(), 1)
        self.send('put', self.url('work-locations'), {'date': day, 'location': None})
        self.assertEqual(WorkLocation.objects.count(), 0)
        self.assertEqual(self.send('put', self.url('work-locations'), {'date': day, 'location': 'moon'}).status_code, 400)
        self.assertEqual(self.send('put', self.url('work-locations'), {'location': 'home'}).status_code, 400)
        self.assertEqual(self.send('put', self.url('work-location-pattern'), {'pattern': {'9': 'home'}}).status_code, 400)

    def test_only_leaders_set_the_policy_and_people_only_set_their_own_day(self):
        self.client.force_login(self.member)
        self.assertEqual(self.send('patch', self.url('office-days'), {'office_days': [1]}).status_code, 403)
        self.send('put', self.url('work-locations'), {'date': monday_after().isoformat(), 'location': 'home'})
        self.assertEqual(WorkLocation.objects.get().user, self.member)

    def test_the_range_is_limited(self):
        self.client.force_login(self.member)
        url = self.url('work-locations') + '?start=2030-01-01&end=2031-01-01'
        self.assertEqual(self.client.get(url).status_code, 400)
