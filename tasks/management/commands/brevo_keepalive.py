import os
import sys

from django.conf import settings
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.utils import timezone

from tasks.mailer import render_branded_email, send_workspace_email


class Command(BaseCommand):
    help = (
        'Send one small email through Brevo so the API key counts as in use. '
        'Brevo expires keys that go unused for about 20 days; run this on a '
        'schedule of at most every 15 days (cron: 0 9 1,15 * *).'
    )

    def add_arguments(self, parser):
        parser.add_argument('--to', help='Recipient. Defaults to BREVO_KEEPALIVE_TO, then the first superuser.')

    def handle(self, *args, **options):
        if not settings.BREVO_API_KEY:
            self.stderr.write(self.style.ERROR('BREVO_API_KEY is not set; nothing to keep alive.'))
            sys.exit(1)
        recipient = (
            options.get('to')
            or os.environ.get('BREVO_KEEPALIVE_TO', '').strip()
            or (User.objects.filter(is_superuser=True).exclude(email='').values_list('email', flat=True).first() or '')
        )
        if not recipient:
            self.stderr.write(self.style.ERROR('No recipient: pass --to, set BREVO_KEEPALIVE_TO, or create a superuser with an email.'))
            sys.exit(1)
        stamp = timezone.now().strftime('%Y-%m-%d')
        body = f'WorkSpace sent this on {stamp} to keep the Brevo API key active. No action needed.'
        html = render_branded_email(
            title='Brevo keepalive',
            paragraphs=[body],
            footer_note='Sent automatically about every 15 days because Brevo expires keys unused for 20.',
        )
        if not send_workspace_email(recipient, f'WorkSpace Brevo keepalive {stamp}', body, html_body=html):
            self.stderr.write(self.style.ERROR('Keepalive email failed; see the log for the Brevo error.'))
            sys.exit(1)
        self.stdout.write(self.style.SUCCESS(f'Keepalive email sent to {recipient}.'))
