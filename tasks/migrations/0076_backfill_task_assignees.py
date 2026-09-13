from django.db import migrations


def backfill_task_assignees(apps, schema_editor):
    """Give every already-assigned task one assignee row at position 0.

    Position 0 is the primary, so this is exactly the value `Task.assignee`
    already holds; nothing about the existing data changes meaning.
    """
    Task = apps.get_model('tasks', 'Task')
    TaskAssignee = apps.get_model('tasks', 'TaskAssignee')
    rows = [
        TaskAssignee(task_id=task_id, user_id=user_id, position=0)
        for task_id, user_id in Task.objects.filter(assignee_id__isnull=False).values_list('id', 'assignee_id')
    ]
    if rows:
        TaskAssignee.objects.bulk_create(rows, batch_size=500, ignore_conflicts=True)


def drop_task_assignees(apps, schema_editor):
    apps.get_model('tasks', 'TaskAssignee').objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ('tasks', '0075_taskassignee_task_assignees_and_more'),
    ]

    operations = [
        migrations.RunPython(backfill_task_assignees, drop_task_assignees),
    ]
