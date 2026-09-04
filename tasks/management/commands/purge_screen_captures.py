from django.core.management.base import BaseCommand

from tasks.screen_sharing import expire_screen_sharing_data


class Command(BaseCommand):
    help = 'Expire abandoned screen-share sessions and permanently delete elapsed screenshots.'

    def handle(self, *args, **options):
        result = expire_screen_sharing_data()
        self.stdout.write(self.style.SUCCESS(f"Expired {result['expired_sessions']} sessions; deleted {result['deleted_captures']} screenshots."))
