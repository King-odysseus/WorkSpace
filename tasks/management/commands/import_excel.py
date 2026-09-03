"""Preview and commit an Excel migration for a workspace.

Usage:
    python manage.py import_excel WORKSPACE_ID path/to/tasks.xlsx --preview
    python manage.py import_excel WORKSPACE_ID path/to/tasks.xlsx --commit

The General sheet is authoritative (upsert by task code); Lists is configuration;
every other sheet enriches existing tasks by code only.
"""

from django.core.management.base import BaseCommand, CommandError

from tasks.importer import build_import_plan, commit_import_plan
from tasks.models import Workspace


class Command(BaseCommand):
    help = 'Preview or commit an Excel task migration for a workspace.'

    def add_arguments(self, parser):
        parser.add_argument('workspace_id', type=int, help='Workspace to import into.')
        parser.add_argument('path', help='Path to the .xlsx workbook.')
        parser.add_argument(
            '--preview', action='store_true',
            help='Parse and validate only; print the plan without writing anything.',
        )
        parser.add_argument(
            '--commit', action='store_true',
            help='Apply the parsed plan transactionally.',
        )

    def handle(self, *args, **options):
        if options['preview'] == options['commit']:
            raise CommandError('Specify exactly one of --preview or --commit.')

        workspace = Workspace.objects.filter(id=options['workspace_id']).first()
        if workspace is None:
            raise CommandError(f'Workspace {options["workspace_id"]} does not exist.')

        plan = build_import_plan(workspace, options['path'])

        if plan.get('error'):
            self.stdout.write(self.style.ERROR(plan['error']))
            return

        if options['preview']:
            self._print_preview(plan)
            return

        result = commit_import_plan(workspace, None, plan)
        self.stdout.write(self.style.SUCCESS(
            'Committed: {created} created, {updated} updated, '
            '{invitations} invitation(s), {exceptions} row exception(s).'.format(
                created=result['created'],
                updated=result['updated'],
                invitations=result['invitations'],
                exceptions=len(result['exceptions']),
            )
        ))
        for exc in result['exceptions']:
            self.stdout.write(self.style.WARNING(
                '  Row {row} [{field}]: {message}'.format(**exc)
            ))

    def _print_preview(self, plan):
        summary = plan['summary']
        self.stdout.write(self.style.SUCCESS(
            'Preview: {total_rows} row(s) -> {creates} create, {updates} update, '
            '{exceptions} exception(s), {invitations} invitation(s).'.format(**summary)
        ))
        self.stdout.write('')
        for exc in plan['exceptions']:
            self.stdout.write(self.style.WARNING(
                '  Row {row} [{field}]: {message}'.format(**exc)
            ))
        if plan['lists']:
            self.stdout.write('')
            self.stdout.write('Lists sheet configuration:')
            for kind, values in plan['lists'].items():
                self.stdout.write(f'  {kind}: {", ".join(values)}')
