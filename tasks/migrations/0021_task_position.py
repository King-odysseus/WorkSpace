from django.db import migrations, models


def create_backlog_buckets(apps, schema_editor):
    Workspace = apps.get_model('tasks', 'Workspace')
    PlanBucket = apps.get_model('tasks', 'PlanBucket')
    for workspace_id in Workspace.objects.values_list('id', flat=True):
        PlanBucket.objects.get_or_create(workspace_id=workspace_id, name='Backlog', defaults={'position': 0})


class Migration(migrations.Migration):
    dependencies = [('tasks', '0020_workspacenotification_target_id_and_more')]

    operations = [
        migrations.AddField(
            model_name='task',
            name='position',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.RunPython(create_backlog_buckets, migrations.RunPython.noop),
    ]
