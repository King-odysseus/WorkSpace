from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('tasks', '0043_screen_sharing')]

    operations = [
        migrations.CreateModel(
            name='WorkspaceDocumentRevision',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=200)),
                ('content', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='workspace_document_revisions', to=settings.AUTH_USER_MODEL)),
                ('document', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='revisions', to='tasks.workspacedocument')),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.CreateModel(
            name='WorkspaceDocumentShare',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('permission', models.CharField(choices=[('view', 'View'), ('comment', 'Comment'), ('edit', 'Edit')], default='view', max_length=12)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('document', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='shares', to='tasks.workspacedocument')),
                ('shared_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='workspace_document_shares_created', to=settings.AUTH_USER_MODEL)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='shared_workspace_documents', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.AddConstraint(model_name='workspacedocumentshare', constraint=models.UniqueConstraint(fields=('document', 'user'), name='unique_workspace_document_share')),
        migrations.CreateModel(
            name='WorkspaceDocumentComment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('body', models.TextField(max_length=4000)),
                ('anchor', models.JSONField(blank=True, default=dict)),
                ('resolved_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('author', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='workspace_document_comments', to=settings.AUTH_USER_MODEL)),
                ('document', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='comments', to='tasks.workspacedocument')),
                ('parent', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='replies', to='tasks.workspacedocumentcomment')),
                ('resolved_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='resolved_workspace_document_comments', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['created_at']},
        ),
    ]
