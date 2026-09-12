from django.db import migrations


def fill_project_from_bucket(apps, schema_editor):
    """Give tasks the project their bucket already implies.

    A project-scoped bucket was the only project signal a task created through
    the planner carried, while the planner's project scope reads the task's own
    project - so a task filed into a project bucket was invisible whenever the
    planner was scoped to that project. Task creation now copies the bucket's
    project; this fills in the rows created before it did.
    """
    PlanBucket = apps.get_model('tasks', 'PlanBucket')
    Task = apps.get_model('tasks', 'Task')

    workspace_ids = Task.objects.values_list('workspace_id', flat=True).distinct()
    for workspace_id in workspace_ids:
        project_by_bucket_name = {}
        for bucket in PlanBucket.objects.filter(workspace_id=workspace_id, project__isnull=False).values_list('name', 'project_id'):
            project_by_bucket_name.setdefault(bucket[0], set()).add(bucket[1])

        for name, project_ids in project_by_bucket_name.items():
            # Ambiguous when the same name is used by buckets in two projects,
            # so leave those to the user rather than guessing a project.
            if len(project_ids) == 1:
                Task.objects.filter(
                    workspace_id=workspace_id, bucket=name, project_ref__isnull=True,
                ).update(project_ref_id=project_ids.pop())


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('tasks', '0064_workspacesetting_check_in_reminder_hour'),
    ]

    operations = [
        migrations.RunPython(fill_project_from_bucket, noop),
    ]
