import io
import json
from unittest import mock
from urllib.error import HTTPError

from django.test import TestCase
from django.urls import reverse

from .models import Membership, User, Workspace
from .workspace_tools import (
    AI_MAX_RESPONSE_TOKENS,
    AI_PROVIDER_DEFAULTS,
    AI_SYSTEM_PROMPT,
    _setting,
)


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

    def _answered(self, body):
        """A provider response shaped like an OpenAI-compatible completion."""
        return mock.MagicMock(
            __enter__=mock.Mock(return_value=mock.MagicMock(
                read=mock.Mock(return_value=json.dumps(body).encode()),
            )),
            __exit__=mock.Mock(return_value=False),
        )

    def _chat(self):
        return self.client.post(
            reverse('workspace-ai-chat', args=[self.workspace.id]),
            data=json.dumps({'message': 'Hello'}),
            content_type='application/json',
        )

    def test_answer_is_sent_room_to_run_to_two_thousand_five_hundred_words(self):
        # 5,000 tokens is roughly 3,300 words of prose. The assertion is on the
        # prose estimate rather than the token count so the test says why the
        # number is what it is, and fails if someone lowers it back to a ceiling
        # that truncates a long answer.
        self.assertGreaterEqual(AI_MAX_RESPONSE_TOKENS * 0.66, 2500)

        body = {'choices': [{'message': {'content': 'Hello.'}}]}
        with mock.patch(
            'tasks.workspace_tools.urlrequest.urlopen',
            return_value=self._answered(body),
        ) as urlopen:
            response = self._chat()

        self.assertEqual(response.status_code, 200)
        sent = json.loads(urlopen.call_args.args[0].data.decode())
        self.assertEqual(sent['max_tokens'], AI_MAX_RESPONSE_TOKENS)

    def test_a_model_that_cannot_produce_that_many_tokens_is_asked_without_the_cap(self):
        # A lower-ceiling model rejects the call outright instead of shortening
        # the answer, so the cap is dropped rather than losing the turn to it.
        url = 'https://api.deepseek.com/chat/completions'
        # The provider has to say why, because the cap is only dropped for a
        # refusal that names the size of the answer. A bare 400 is left to the
        # retry that handles whatever else went wrong.
        refusal = json.dumps(
            {'error': {'message': 'max_tokens is too large for this model'}},
        ).encode()
        refused = HTTPError(url, 400, 'Bad Request', {}, io.BytesIO(refusal))
        body = {'choices': [{'message': {'content': 'Hello.'}}]}

        with mock.patch(
            'tasks.workspace_tools.urlrequest.urlopen',
            side_effect=[refused, self._answered(body)],
        ) as urlopen:
            response = self._chat()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(urlopen.call_count, 2)
        first = json.loads(urlopen.call_args_list[0].args[0].data.decode())
        second = json.loads(urlopen.call_args_list[1].args[0].data.decode())
        self.assertEqual(first['max_tokens'], AI_MAX_RESPONSE_TOKENS)
        self.assertNotIn('max_tokens', second)

    def test_the_prompt_asks_for_length_by_request_rather_than_brevity(self):
        # The ceiling alone does not lengthen an answer; the prompt used to tell
        # Zuri to be concise, so a raised cap changed nothing the reader could
        # see. Guard the instruction, not the wording.
        self.assertNotIn('Be concise', AI_SYSTEM_PROMPT)
        self.assertIn('Match the length to what was asked', AI_SYSTEM_PROMPT)
        self.assertIn('Never stop an answer part-way', AI_SYSTEM_PROMPT)
