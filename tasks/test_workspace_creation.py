import json

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from .models import Membership, PlanBucket, Workspace


class WorkspaceCreationApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username='create-owner@example.com', email='create-owner@example.com', password='secure-pass-123')
        self.manager = User.objects.create_user(username='create-manager@example.com', email='create-manager@example.com', password='secure-pass-123')
        self.member = User.objects.create_user(username='create-member@example.com', email='create-member@example.com', password='secure-pass-123')
        self.workspace = Workspace.objects.create(name='First Company', slug='first-company')
        Membership.objects.create(workspace=self.workspace, user=self.owner, role='owner')
        Membership.objects.create(workspace=self.workspace, user=self.manager, role='manager')
        Membership.objects.create(workspace=self.workspace, user=self.member, role='member')

    def test_owner_can_create_another_independent_workspace(self):
        self.client.force_login(self.owner)
        response = self.client.post(
            reverse('workspace-create'),
            data=json.dumps({'name': 'Second Company'}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 201)
        workspace_id = response.json()['workspace']['id']
        self.assertNotEqual(workspace_id, self.workspace.id)
        self.assertTrue(Membership.objects.filter(workspace_id=workspace_id, user=self.owner, role='owner').exists())
        self.assertTrue(PlanBucket.objects.filter(workspace_id=workspace_id, name='Backlog', position=0).exists())
        self.assertEqual(
            {workspace['id'] for workspace in response.json()['user']['workspaces']},
            {self.workspace.id, workspace_id},
        )

    def test_duplicate_names_receive_distinct_workspace_slugs(self):
        self.client.force_login(self.owner)
        payload = json.dumps({'name': 'Acme'})

        first = self.client.post(reverse('workspace-create'), data=payload, content_type='application/json')
        second = self.client.post(reverse('workspace-create'), data=payload, content_type='application/json')

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertNotEqual(first.json()['workspace']['slug'], second.json()['workspace']['slug'])

    def test_only_existing_owners_can_create_workspaces(self):
        payload = json.dumps({'name': 'Not allowed'})
        for user in (self.manager, self.member):
            with self.subTest(role=user.username):
                self.client.force_login(user)
                response = self.client.post(reverse('workspace-create'), data=payload, content_type='application/json')
                self.assertEqual(response.status_code, 403)
        self.client.logout()
        self.assertEqual(self.client.post(reverse('workspace-create'), data=payload, content_type='application/json').status_code, 401)

    def test_workspace_creation_validates_the_name(self):
        self.client.force_login(self.owner)
        for name in ('   ', 'x' * 121):
            with self.subTest(name=name):
                response = self.client.post(
                    reverse('workspace-create'),
                    data=json.dumps({'name': name}),
                    content_type='application/json',
                )
                self.assertEqual(response.status_code, 400)
