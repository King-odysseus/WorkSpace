from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('tasks', '0062_followupcomment'),
    ]

    operations = [
        migrations.AddField(
            model_name='notificationpreference',
            name='notification_sound',
            field=models.BooleanField(default=True),
        ),
    ]
