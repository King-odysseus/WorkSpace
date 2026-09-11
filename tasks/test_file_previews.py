import shutil
import tempfile

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from .models import Membership, Task, TaskAttachment, Workspace, WorkspaceFile

TEMP_MEDIA = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=TEMP_MEDIA)
class FilePreviewTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(TEMP_MEDIA, ignore_errors=True)

    def setUp(self):
        self.user = User.objects.create_user(username='viewer@example.com', email='viewer@example.com', password='Pass12345!')
        self.workspace = Workspace.objects.create(name='Preview', slug='preview')
        Membership.objects.create(workspace=self.workspace, user=self.user, role='owner')
        self.task = Task.objects.create(workspace=self.workspace, title='Has files')
        self.client.force_login(self.user)

    def attachment(self, name, content=b'data'):
        return TaskAttachment.objects.create(task=self.task, uploaded_by=self.user, file=SimpleUploadedFile(name, content), original_name=name)

    def test_image_attachment_opens_inline_with_sandbox(self):
        attachment = self.attachment('photo.png')
        response = self.client.get(f'/api/attachments/{attachment.id}/download/')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response['Content-Disposition'].startswith('inline'))
        self.assertEqual(response['Content-Type'], 'image/png')
        self.assertIn('sandbox', response['Content-Security-Policy'])

    def test_pdf_opens_inline_without_sandbox(self):
        attachment = self.attachment('report.pdf')
        response = self.client.get(f'/api/attachments/{attachment.id}/download/')
        self.assertTrue(response['Content-Disposition'].startswith('inline'))
        self.assertNotIn('Content-Security-Policy', response)

    def test_other_types_still_download(self):
        attachment = self.attachment('sheet.xlsx')
        response = self.client.get(f'/api/attachments/{attachment.id}/download/')
        self.assertTrue(response['Content-Disposition'].startswith('attachment'))

    def test_download_param_forces_attachment(self):
        attachment = self.attachment('photo.jpg')
        response = self.client.get(f'/api/attachments/{attachment.id}/download/?download=1')
        self.assertTrue(response['Content-Disposition'].startswith('attachment'))

    def test_workspace_image_file_opens_inline(self):
        item = WorkspaceFile.objects.create(workspace=self.workspace, file=SimpleUploadedFile('shot.webp', b'data'), original_name='shot.webp', mime_type='image/webp', size=4, uploaded_by=self.user)
        response = self.client.get(f'/api/workspace-files/{item.id}/download/')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response['Content-Disposition'].startswith('inline'))
