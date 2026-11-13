import json
from unittest import mock

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from .automation import run_workspace_automation
from .models import CheckIn, Membership, Workspace, WorkspaceNotification, WorkspaceSetting


class CheckInPreferenceTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner@example.com', 'owner@example.com', 'password')
        self.manager = User.objects.create_user('manager@example.com', 'manager@example.com', 'password')
        self.member = User.objects.create_user('member@example.com', 'member@example.com', 'password')
        self.workspace = Workspace.objects.create(name='Preference workspace', slug='preference-workspace')
        Membership.objects.create(workspace=self.workspace, user=self.owner, role='owner')
        Membership.objects.create(workspace=self.workspace, user=self.manager, role='manager')
        Membership.objects.create(workspace=self.workspace, user=self.member, role='member')

    def url(self):
        return reverse('check-in-preference', args=[self.workspace.id])

    def set_preference(self, value):
        return self.client.patch(self.url(), data=json.dumps({'skips_check_ins': value}), content_type='application/json')

    def test_owners_and_managers_can_opt_out_and_back_in(self):
        for user in (self.owner, self.manager):
            self.client.force_login(user)
            self.assertTrue(self.client.get(self.url()).json()['can_opt_out'])
            self.assertEqual(self.set_preference(True).status_code, 200)
            self.assertTrue(Membership.objects.get(workspace=self.workspace, user=user).skips_check_ins)
            self.assertEqual(self.set_preference(False).status_code, 200)
            self.assertFalse(Membership.objects.get(workspace=self.workspace, user=user).skips_check_ins)

    def test_a_member_cannot_opt_out(self):
        self.client.force_login(self.member)
        self.assertFalse(self.client.get(self.url()).json()['can_opt_out'])
        self.assertEqual(self.set_preference(True).status_code, 403)
        self.assertFalse(Membership.objects.get(user=self.member).skips_check_ins)

    def test_the_value_must_be_a_real_boolean(self):
        self.client.force_login(self.owner)
        self.assertEqual(self.set_preference('yes').status_code, 400)
        self.assertEqual(self.client.patch(self.url(), data='{', content_type='application/json').status_code, 400)

    def test_the_choice_only_changes_the_persons_own_membership(self):
        self.client.force_login(self.manager)
        self.set_preference(True)
        self.assertFalse(Membership.objects.get(user=self.owner).skips_check_ins)

    def test_the_member_list_shows_who_skips(self):
        Membership.objects.filter(user=self.manager).update(skips_check_ins=True)
        self.client.force_login(self.owner)
        members = {item['email']: item for item in self.client.get(reverse('member-list', args=[self.workspace.id])).json()['members']}
        self.assertTrue(members['manager@example.com']['skips_check_ins'])
        self.assertFalse(members['member@example.com']['skips_check_ins'])

    def test_the_daily_reminder_and_summary_leave_out_leaders_who_opted_out(self):
        Membership.objects.filter(user=self.manager).update(skips_check_ins=True)
        WorkspaceSetting.objects.update_or_create(workspace=self.workspace, defaults={'check_in_reminder_hour': timezone.localtime().hour})

        run_workspace_automation(self.workspace.id)

        reminded = set(WorkspaceNotification.objects.filter(kind='check_in_reminder').values_list('recipient_id', flat=True))
        # The owner and the member still need to check in; the manager does not.
        self.assertEqual(reminded, {self.owner.id, self.member.id})
        summary = WorkspaceNotification.objects.filter(kind='check_in_summary').first()
        self.assertIn('0 of 2 checked in', summary.title)

    def test_a_leader_who_opted_out_but_checked_in_anyway_still_counts(self):
        Membership.objects.filter(user=self.manager).update(skips_check_ins=True)
        CheckIn.objects.create(workspace=self.workspace, user=self.manager, date=timezone.localdate(), completed='Did things')
        WorkspaceSetting.objects.update_or_create(workspace=self.workspace, defaults={'check_in_reminder_hour': timezone.localtime().hour})

        run_workspace_automation(self.workspace.id)

        summary = WorkspaceNotification.objects.filter(kind='check_in_summary').first()
        self.assertIn('1 of 3 checked in', summary.title)
