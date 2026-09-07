from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('tasks', '0061_checkincomment'),
    ]

    operations = [
        migrations.CreateModel(
            name='FollowUpComment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('body', models.TextField(max_length=2000)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('author', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='follow_up_comments', to=settings.AUTH_USER_MODEL)),
                ('follow_up', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='comments', to='tasks.followup')),
            ],
            options={'ordering': ['created_at', 'id']},
        ),
    ]
