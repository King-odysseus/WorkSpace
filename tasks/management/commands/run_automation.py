import logging

from django.core.management.base import BaseCommand

from tasks.automation import run_workspace_automation
from tasks.models import Workspace

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Run idempotent due-soon, overdue, blocked, stale and digest reminders for every workspace.'

    def add_arguments(self, parser):
        parser.add_argument('--workspace-id', type=int, help='Run for a single workspace instead of all.')

    def handle(self, *args, **options):
        workspace_ids = [options['workspace_id']] if options['workspace_id'] else list(Workspace.objects.values_list('id', flat=True))
        totals = {
            'due_soon': 0, 'overdue': 0, 'blocked': 0, 'stale': 0,
            'operations_digest': 0, 'project_digest': 0,
        }
        for workspace_id in workspace_ids:
            try:
                counts = run_workspace_automation(workspace_id)
            except Exception:
                # One broken workspace must not stop the others in this idempotent
                # cron run - log the failure and move on.
                logger.exception('Automation failed for workspace %s', workspace_id)
                continue
            for key in totals:
                totals[key] += counts.get(key, 0)

        self.stdout.write(self.style.SUCCESS(
            'Automation complete: {due_soon} due-soon, {overdue} overdue, {blocked} blocked, '
            '{stale} stale, {operations_digest} operations digest(s), {project_digest} project digest(s).'.format(**totals)
        ))
