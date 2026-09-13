import json

from django.test import TestCase
from django.urls import reverse

from .models import Membership, User, Workspace
from .workspace_tools import _setting


class WorkspaceAiAccessTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            username='ai-access-owner@example.com',
            email='ai-access-owner@example.com',
            password='secure-pass-123',
        )
        self.workspace = Workspace.objects.create(
            name='AI Access Workspace',
            slug='ai-access-workspace',
        )
        Membership.objects.create(
            workspace=self.workspace,
            user=self.owner,
            role='owner',
        )
        self.client.force_login(self.owner)

    def test_stale_member_access_id_is_pruned_when_settings_are_saved(self):
        departed = User.objects.create_user(
            username='departed@example.com',
            email='departed@example.com',
            password='secure-pass-123',
        )
        setting = _setting(self.workspace.id)
        setting.ai_user_ids = [departed.id]
        setting.save(update_fields=['ai_user_ids'])

        response = self.client.patch(
            reverse('workspace-ai-settings', args=[self.workspace.id]),
            data=json.dumps({'ai_user_ids': [departed.id]}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200)
        setup = _setting(self.workspace.id)
        self.assertEqual(setup.ai_user_ids, [])
