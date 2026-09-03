from django.core.management.base import BaseCommand

from tasks.webhooks import drain_webhook_deliveries


class Command(BaseCommand):
    help = 'Send queued outbound webhook notifications to Teams/Slack endpoints.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=100, help='Maximum deliveries to attempt in this run.')

    def handle(self, *args, **options):
        sent, failed = drain_webhook_deliveries(limit=options['limit'])
        self.stdout.write(f'Webhook deliveries sent: {sent}, failed: {failed}')
