import json

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from .models import (
    MANAGER_DEFAULT_PERMISSIONS,
    MEMBER_DEFAULT_PERMISSIONS,
    PERMISSION_KEYS,
    Membership,
    Workspace,
)

# The desktop assistant is the one capability an owner must grant explicitly,
# so every test here pins its exact key instead of spelling the string inline.
ASSISTANT_PERMISSION = 'use_copilot'


class AssistantPermissionTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            username='assistant-owner@example.com',
            email='assistant-owner@example.com',
            password='secure-pass-123',
        )
        self.manager = User.objects.create_user(
            username='assistant-manager@example.com',
            email='assistant-manager@example.com',
            password='secure-pass-123',
        )
        self.other_manager = User.objects.create_user(
            username='assistant-other-manager@example.com',
            email='assistant-other-manager@example.com',
            password='secure-pass-123',
        )
        self.member = User.objects.create_user(
            username='assistant-member@example.com',
            email='assistant-member@example.com',
            password='secure-pass-123',
        )
        self.workspace = Workspace.objects.create(name='Assistant Grants Co', slug='assistant-grants-co')
        Membership.objects.create(workspace=self.workspace, user=self.owner, role='owner')
        Membership.objects.create(workspace=self.workspace, user=self.manager, role='manager')
        Membership.objects.create(workspace=self.workspace, user=self.other_manager, role='manager')
        Membership.objects.create(workspace=self.workspace, user=self.member, role='member')

    def member_url(self, user):
        return reverse('member-detail', args=[self.workspace.id, user.id])

    def patch_member(self, user, payload):
        return self.client.patch(
            self.member_url(user),
            data=json.dumps(payload),
            content_type='application/json',
        )

    def stored_membership(self, user):
        return Membership.objects.get(workspace=self.workspace, user=user)

    def grant_assistant_to_manager(self):
        """Give the manager the assistant key through the API so each test
        starts from a persisted grant rather than a hand-written row."""
        self.client.force_login(self.owner)
        return self.patch_member(self.manager, {
            'permissions': sorted(MANAGER_DEFAULT_PERMISSIONS | {ASSISTANT_PERMISSION}),
        })

    def test_owner_always_has_assistant_without_a_stored_grant(self):
        membership = self.stored_membership(self.owner)
        self.assertIn(ASSISTANT_PERMISSION, membership.effective_permissions())
        self.assertTrue(membership.has_permission(ASSISTANT_PERMISSION))
        # Owners derive every key from their role, so nothing is written to the
        # row: a stored list would freeze the owner out of future capabilities.
        self.assertIsNone(membership.permissions)
        self.assertIn(ASSISTANT_PERMISSION, membership.as_dict()['permissions'])

    def test_manager_defaults_exclude_assistant_and_keep_every_other_key(self):
        self.assertEqual(
            set(MANAGER_DEFAULT_PERMISSIONS),
            set(PERMISSION_KEYS) - {ASSISTANT_PERMISSION},
        )
        self.assertNotIn(ASSISTANT_PERMISSION, MANAGER_DEFAULT_PERMISSIONS)
        # Introducing the assistant gate must not narrow any existing manager
        # capability, so assert the rest of the default set survived intact.
        for key in set(PERMISSION_KEYS) - {ASSISTANT_PERMISSION}:
            self.assertIn(key, MANAGER_DEFAULT_PERMISSIONS)

        membership = self.stored_membership(self.manager)
        self.assertIsNone(membership.permissions)
        self.assertNotIn(ASSISTANT_PERMISSION, membership.effective_permissions())
        self.assertFalse(membership.has_permission(ASSISTANT_PERMISSION))

    def test_member_never_has_assistant(self):
        membership = self.stored_membership(self.member)
        self.assertEqual(membership.effective_permissions(), set(MEMBER_DEFAULT_PERMISSIONS))
        self.assertNotIn(ASSISTANT_PERMISSION, membership.effective_permissions())
        self.assertFalse(membership.has_permission(ASSISTANT_PERMISSION))
        self.assertIsNone(membership.permissions)

    def test_owner_can_grant_assistant_to_a_manager(self):
        response = self.grant_assistant_to_manager()
        self.assertEqual(response.status_code, 200)
        self.assertIn(ASSISTANT_PERMISSION, response.json()['member']['permissions'])

        membership = self.stored_membership(self.manager)
        self.assertIsNotNone(membership.permissions)
        self.assertTrue(membership.has_permission(ASSISTANT_PERMISSION))

    def test_owner_can_revoke_assistant_again(self):
        self.assertEqual(self.grant_assistant_to_manager().status_code, 200)

        self.client.force_login(self.owner)
        response = self.patch_member(self.manager, {'permissions': sorted(MANAGER_DEFAULT_PERMISSIONS)})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(ASSISTANT_PERMISSION, response.json()['member']['permissions'])

        membership = self.stored_membership(self.manager)
        self.assertFalse(membership.has_permission(ASSISTANT_PERMISSION))
        # Revoking one key must not wipe the manager's other grants.
        self.assertTrue(membership.has_permission('create_tasks'))

    def test_reset_to_defaults_drops_assistant_and_restores_the_default_set(self):
        self.assertEqual(self.grant_assistant_to_manager().status_code, 200)

        self.client.force_login(self.owner)
        response = self.patch_member(self.manager, {'permissions': None})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(ASSISTANT_PERMISSION, response.json()['member']['permissions'])

        membership = self.stored_membership(self.manager)
        self.assertIsNone(membership.permissions)
        self.assertEqual(membership.effective_permissions(), set(MANAGER_DEFAULT_PERMISSIONS))
        for key in MANAGER_DEFAULT_PERMISSIONS:
            self.assertTrue(membership.has_permission(key))

    def test_explicit_grant_survives_an_unrelated_update(self):
        self.assertEqual(self.grant_assistant_to_manager().status_code, 200)

        self.client.force_login(self.owner)
        response = self.patch_member(self.manager, {'daily_capacity_minutes': 450})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['member']['daily_capacity_minutes'], 450)
        self.assertIn(ASSISTANT_PERMISSION, response.json()['member']['permissions'])

        membership = self.stored_membership(self.manager)
        self.assertTrue(membership.has_permission(ASSISTANT_PERMISSION))
        self.assertEqual(membership.daily_capacity_minutes, 450)

    def test_manager_cannot_grant_assistant(self):
        payload = {'permissions': sorted(MANAGER_DEFAULT_PERMISSIONS | {ASSISTANT_PERMISSION})}

        self.client.force_login(self.manager)
        response = self.patch_member(self.other_manager, payload)
        self.assertEqual(response.status_code, 403)
        self.assertIsNone(self.stored_membership(self.other_manager).permissions)

        # A manager is not allowed to widen their own grants either.
        response = self.patch_member(self.manager, payload)
        self.assertEqual(response.status_code, 403)
        self.assertIsNone(self.stored_membership(self.manager).permissions)

    def test_member_actor_cannot_change_permissions(self):
        self.client.force_login(self.member)
        response = self.patch_member(self.manager, {'permissions': sorted(MANAGER_DEFAULT_PERMISSIONS)})
        self.assertEqual(response.status_code, 403)
        self.assertIsNone(self.stored_membership(self.manager).permissions)

    def test_member_target_cannot_be_given_assistant(self):
        self.client.force_login(self.owner)
        response = self.patch_member(self.member, {'permissions': [ASSISTANT_PERMISSION]})
        self.assertEqual(response.status_code, 400)
        self.assertIsNone(self.stored_membership(self.member).permissions)
        self.assertFalse(self.stored_membership(self.member).has_permission(ASSISTANT_PERMISSION))

    def test_unknown_permission_key_is_rejected(self):
        self.client.force_login(self.owner)
        response = self.patch_member(self.manager, {
            'permissions': sorted(MANAGER_DEFAULT_PERMISSIONS) + ['fly_the_ship'],
        })
        self.assertEqual(response.status_code, 400)
        self.assertIsNone(self.stored_membership(self.manager).permissions)

    def test_granting_only_assistant_narrows_the_override_to_that_key(self):
        self.client.force_login(self.owner)
        response = self.patch_member(self.manager, {'permissions': [ASSISTANT_PERMISSION]})
        self.assertEqual(response.status_code, 200)

        membership = self.stored_membership(self.manager)
        # An explicit list replaces the defaults rather than extending them, so
        # the same request can both grant and revoke in one write.
        self.assertEqual(membership.effective_permissions(), {ASSISTANT_PERMISSION})
        self.assertTrue(membership.has_permission(ASSISTANT_PERMISSION))
        self.assertFalse(membership.has_permission('create_tasks'))
