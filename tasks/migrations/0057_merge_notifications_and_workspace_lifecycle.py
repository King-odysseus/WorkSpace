# Merge migration: 0055 (notification grouping) and 0056 (workspace
# lifecycle + granular permissions) were authored concurrently as independent
# branches off 0054, each touching disjoint models/fields, so this merge
# carries no operations of its own.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('tasks', '0055_manager_notifications'),
        ('tasks', '0056_workspace_lifecycle_and_permissions'),
    ]

    operations = []
