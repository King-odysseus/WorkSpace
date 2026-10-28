from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('tasks', '0088_board_members'),
    ]

    operations = [
        migrations.AddField(
            model_name='personaltask',
            name='progress_percent',
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.AddConstraint(
            model_name='personaltask',
            constraint=models.CheckConstraint(condition=models.Q(('progress_percent__lte', 100)), name='personal_task_progress_at_most_100'),
        ),
    ]
