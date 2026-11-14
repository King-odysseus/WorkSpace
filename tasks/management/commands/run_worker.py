import io
import logging
import time

from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import close_old_connections

logger = logging.getLogger(__name__)

JOBS = ('deliver_calendar_reminders', 'deliver_webhooks', 'run_automation', 'purge_screen_captures')


class Command(BaseCommand):
    help = (
        'Long-running background worker: delivers calendar reminders, webhooks and automation '
        '(due-soon / overdue alerts, which also send push) every few seconds, so notifications '
        'arrive on time even when nobody has the app open. Replaces a once-a-minute cron job.'
    )

    def add_arguments(self, parser):
        parser.add_argument('--interval', type=int, default=30, help='Seconds between passes (default 30).')
        parser.add_argument('--once', action='store_true', help='Run one pass and exit.')

    def handle(self, *args, **options):
        interval = max(5, options['interval'])
        self.stdout.write(f'Worker started; running every {interval}s.')
        while True:
            for job in JOBS:
                try:
                    call_command(job, stdout=io.StringIO())
                except Exception:
                    # One failing job must never stop reminders from going out.
                    logger.exception('Worker job %s failed', job)
                finally:
                    close_old_connections()
            if options['once']:
                return
            time.sleep(interval)
