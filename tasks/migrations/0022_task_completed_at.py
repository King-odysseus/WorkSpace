from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('tasks', '0021_task_position')]

    operations = [
        migrations.AddField(
            model_name='task',
            name='completed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
