import json
from unittest import mock
from urllib.error import HTTPError

from django.test import TestCase
from django.urls import reverse

from .models import Membership, User, Workspace
from .workspace_tools import AI_PROVIDER_DEFAULTS, _setting


class WorkspaceAiProviderAuthTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            username='ai-provider-owner@example.com',
            email='ai-provider-owner@example.com',
            password='secure-pass-123',
        )
        self.workspace = Workspace.objects.create(
            name='AI Provider Workspace',
            slug='ai-provider-workspace',
        )
        Membership.objects.create(
            workspace=self.workspace,
            user=self.owner,
            role='owner',
        )
        setting = _setting(self.workspace.id)
        setting.ai_enabled = True
        setting.ai_default_provider = 'deepseek'
        setting.ai_enabled_providers = ['deepseek']
        setting.save()
        self.client.force_login(self.owner)

        blank_keys = {
            name: ''
            for config in AI_PROVIDER_DEFAULTS.values()
            for name in config['key_env']
        }
        environment = mock.patch.dict('os.environ', {
            **blank_keys,
            'DEEPSEEK_API_KEY': 'sk-test-key',
        })
        environment.start()
        self.addCleanup(environment.stop)

    def test_rejected_provider_key_returns_actionable_message(self):
        url = 'https://api.deepseek.com/chat/completions'
        rejected = HTTPError(url, 401, 'Unauthorized', {}, None)

        with mock.patch(
            'tasks.workspace_tools.urlrequest.urlopen',
            side_effect=rejected,
        ):
            response = self.client.post(
                reverse('workspace-ai-chat', args=[self.workspace.id]),
                data=json.dumps({'message': 'Hello'}),
                content_type='application/json',
            )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(
            response.json()['code'],
            'ai_provider_unauthorized',
        )
        self.assertIn('API key was rejected', response.json()['error'])
        self.assertNotIn('HTTP Error 401', response.json()['error'])
