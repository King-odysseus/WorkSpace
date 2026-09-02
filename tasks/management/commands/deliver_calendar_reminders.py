from django.core.management.base import BaseCommand

from tasks.models import Workspace
from tasks.views import deliver_due_calendar_reminders


class Command(BaseCommand):
    help = 'Deliver due calendar reminders for every workspace.'

    def handle(self, *args, **options):
        delivered_count = sum(
            deliver_due_calendar_reminders(workspace_id)
            for workspace_id in Workspace.objects.values_list('id', flat=True)
        )
        self.stdout.write(self.style.SUCCESS(f'Delivered {delivered_count} calendar reminder(s).'))
