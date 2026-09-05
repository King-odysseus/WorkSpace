import secrets

from django.db import migrations, models
import django.utils.timezone

from tasks.models import generate_invitation_token


def backfill_tokens(apps, schema_editor):
    WorkspaceInvitation = apps.get_model('tasks', 'WorkspaceInvitation')
    for invitation in WorkspaceInvitation.objects.filter(token__isnull=True):
        invitation.token = secrets.token_urlsafe(32)
        invitation.save(update_fields=['token'])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('tasks', '0049_pushsubscription'),
    ]

    operations = [
        migrations.AddField(
            model_name='workspaceinvitation',
            name='token',
            field=models.CharField(max_length=64, null=True, editable=False),
        ),
        migrations.AddField(
            model_name='workspaceinvitation',
            name='last_sent_at',
            field=models.DateTimeField(default=django.utils.timezone.now),
        ),
        migrations.RunPython(backfill_tokens, noop),
        migrations.AlterField(
            model_name='workspaceinvitation',
            name='token',
            field=models.CharField(default=generate_invitation_token, editable=False, max_length=64, unique=True),
        ),
        migrations.AlterField(
            model_name='workspaceinvitation',
            name='status',
            field=models.CharField(choices=[('pending', 'Pending'), ('accepted', 'Accepted'), ('declined', 'Declined'), ('cancelled', 'Revoked')], default='pending', max_length=20),
        ),
    ]
