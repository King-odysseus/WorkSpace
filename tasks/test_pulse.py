"""The pulse tells the client which domains moved, so it can refresh just those.

The risk in that is quiet: a label that belongs to no domain moves the overall
fingerprint without telling the client what to refetch, and the change sits
unseen until something unrelated happens to move. These tests hold the mapping
and the behaviour around it.
"""

from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase

from .models import Membership, Task, Workspace
from .pulse import DOMAIN_LABELS, WORKSPACE_COLLECTIONS, workspace_domains, workspace_parts


class PulseDomainMappingTests(SimpleTestCase):
    """Every label the parts query can produce has to belong to one domain."""

    def test_every_label_belongs_to_exactly_one_domain(self):
        produced = {label for label, _model, _field in WORKSPACE_COLLECTIONS}
        produced.update({'channel_reads', 'conversation_reads'})
        produced.update({'notifications', 'direct', 'presence'})

        claimed = [label for labels in DOMAIN_LABELS.values() for label in labels]

        self.assertEqual(
            sorted(claimed),
            sorted(produced),
            'DOMAIN_LABELS and the labels the pulse produces have drifted apart',
        )
        self.assertEqual(
            len(claimed),
            len(set(claimed)),
            'a label is claimed by more than one domain',
        )

    def test_every_domain_claims_at_least_one_label(self):
        for domain, labels in DOMAIN_LABELS.items():
            self.assertTrue(labels, f'{domain} claims no labels')


class PulseDomainTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user('owner@example.com', 'owner@example.com', 'password')
        self.workspace = Workspace.objects.create(name='Test workspace', slug='test-workspace')
        Membership.objects.create(workspace=self.workspace, user=self.owner, role='owner')

    def test_a_new_task_moves_the_tasks_domain_and_leaves_chat_alone(self):
        before = workspace_domains(self.workspace.id, self.owner)

        Task.objects.create(workspace=self.workspace, title='Ship it')

        after = workspace_domains(self.workspace.id, self.owner)

        self.assertNotEqual(before['tasks'], after['tasks'])
        # The point of the split: a task arriving must not drag the chat along.
        self.assertEqual(before['chat'], after['chat'])
        self.assertEqual(before['calendar'], after['calendar'])

    def test_the_domains_are_derived_from_the_same_parts_as_the_fingerprint(self):
        # Passing the parts in is what keeps the pulse to one round trip; if the
        # two disagreed, the client would be told to refresh the wrong thing.
        parts = workspace_parts(self.workspace.id, self.owner)
        self.assertEqual(
            workspace_domains(self.workspace.id, self.owner, parts),
            workspace_domains(self.workspace.id, self.owner),
        )
