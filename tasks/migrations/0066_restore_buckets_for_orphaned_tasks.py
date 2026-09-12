from django.db import migrations


def restore_missing_buckets(apps, schema_editor):
    """Give every task a live bucket to render in.

    A task records its bucket as a plain name and the planner pairs the two by
    name, drawing a column per bucket. Deleting a bucket used to leave its tasks
    naming a bucket that no longer existed - and permanently deleting one blanked
    the name outright - so those tasks rendered in no column at all and looked
    lost. Only the deletes run since have moved their tasks, which leaves rows
    already in that state stranded.

    Nothing about a name says which scope its bucket had, so a missing one is
    restored unscoped: that is the lane every planner mode draws. An archived
    bucket with the name is revived instead, so a task keeps the lane it was
    filed into. Buckets are only added here - a workspace whose tasks all name
    live buckets is left untouched.
    """
    PlanBucket = apps.get_model('tasks', 'PlanBucket')
    Task = apps.get_model('tasks', 'Task')

    def unscoped(workspace_id):
        return PlanBucket.objects.filter(
            workspace_id=workspace_id, project__isnull=True, workstream__isnull=True,
        )

    def ensure(workspace_id, name):
        bucket = unscoped(workspace_id).filter(name=name).first()
        if bucket is None:
            position = 0 if name == 'Backlog' else unscoped(workspace_id).count()
            return PlanBucket.objects.create(workspace_id=workspace_id, name=name, position=position)
        if not bucket.is_active:
            bucket.is_active = True
            bucket.save(update_fields=['is_active'])
        return bucket

    for workspace_id in Task.objects.values_list('workspace_id', flat=True).distinct():
        tasks = Task.objects.filter(workspace_id=workspace_id)
        # A permanently deleted bucket used to blank its tasks' bucket name, and a
        # task naming nothing belongs on the default lane like any other.
        blank = tasks.filter(bucket='').count() + tasks.filter(bucket__isnull=True).count()
        if blank:
            ensure(workspace_id, 'Backlog')
            tasks.filter(bucket='').update(bucket='Backlog')
            tasks.filter(bucket__isnull=True).update(bucket='Backlog')

        active_names = set(
            PlanBucket.objects.filter(workspace_id=workspace_id, is_active=True).values_list('name', flat=True),
        )
        for name in tasks.values_list('bucket', flat=True).distinct():
            if name and name not in active_names:
                ensure(workspace_id, name)


def noop(apps, schema_editor):
    # Buckets this added cannot be told apart from the workspace's own, so
    # reversing would delete lanes the user may since have filled.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('tasks', '0065_backfill_task_project_from_bucket'),
    ]

    operations = [
        migrations.RunPython(restore_missing_buckets, noop),
    ]
