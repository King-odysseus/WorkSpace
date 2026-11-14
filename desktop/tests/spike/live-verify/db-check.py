"""Report what one live verification run left in its throwaway database.

The Electron run record proves what the API answered. This proves what the
database holds now: how many tasks the throwaway workspace has, and whether the
probe's marked task survived. It reads through the ORM, so a row that was
archived instead of deleted is still counted - that difference is the point of
the check.

Run it from the repository root with the parent environment already pointing at
the throwaway database:

    python db-check.py --workspace-id 3 --database <run>/probe.sqlite3
    python db-check.py --workspace-id 3 --database <run>/probe.sqlite3 \\
        --marker-prefix 'LIVE-VERIFY-' --marker 'LIVE-VERIFY-abc123'

It prints one JSON object on stdout and exits 0. Anything else - a broken
environment, a missing database - is reported on stderr as one line.
"""

import argparse
import json
import os
import sys
from pathlib import Path

# desktop/tests/spike/live-verify/db-check.py -> the repository root, so
# `backend.settings` and `tasks` import the same way manage.py finds them.
REPO_ROOT = Path(__file__).resolve().parents[4]


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description='Count the tasks one live verification run left in its database.',
    )
    parser.add_argument('--workspace-id', type=int, required=True)
    parser.add_argument('--database', required=True)
    parser.add_argument('--marker-prefix', default='')
    parser.add_argument('--marker', default='')
    return parser.parse_args(argv)


def start_django():
    """Load Django against whatever database the parent process configured."""
    sys.path.insert(0, str(REPO_ROOT))
    # setdefault, not assignment: the parent decided which database to read and
    # overriding it here would check a different one than the run used.
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')

    import django

    try:
        django.setup()
    except Exception as error:  # noqa: BLE001 - a one-line report beats a traceback
        print(
            f'db-check.py: Django could not start ({type(error).__name__}): {error}',
            file=sys.stderr,
        )
        raise SystemExit(1)


def warn_if_other_database(database):
    """Say so loudly if the ORM is not reading the file we were asked about.

    Without this the numbers would look plausible and describe the wrong file.
    """
    from django.conf import settings

    configured = settings.DATABASES.get('default', {}).get('NAME')
    if not configured:
        return
    if Path(str(configured)).resolve() == Path(database).resolve():
        return
    print(
        f'db-check.py: warning: the ORM is reading {configured}, not {database}',
        file=sys.stderr,
    )


def count_tasks(workspace_id, marker_prefix, marker):
    from tasks.models import Task, Workspace

    if not Workspace.objects.filter(pk=workspace_id).exists():
        return {
            'workspace_id': workspace_id,
            'tasksInWorkspace': 0,
            'markersInWorkspace': 0,
            'markerPresent': False,
            'workspaceExists': False,
        }

    tasks = Task.objects.filter(workspace_id=workspace_id)
    return {
        'workspace_id': workspace_id,
        'tasksInWorkspace': tasks.count(),
        # No prefix means no marker was written, so nothing can be left over.
        'markersInWorkspace': tasks.filter(title__startswith=marker_prefix).count() if marker_prefix else 0,
        'markerPresent': tasks.filter(title=marker).exists() if marker else False,
        'workspaceExists': True,
    }


def main(argv):
    args = parse_args(argv)
    start_django()
    warn_if_other_database(args.database)

    from django.db import DatabaseError

    try:
        payload = count_tasks(args.workspace_id, args.marker_prefix, args.marker)
    except DatabaseError as error:
        # The usual cause is a database that was never migrated, or a parent
        # environment pointing at a file that holds no tables.
        print(
            f'db-check.py: could not read {Path(args.database).name}: {error}',
            file=sys.stderr,
        )
        raise SystemExit(1)

    # The basename only: the full path is already in the evidence file, and a
    # Windows path in JSON is noise for the reader.
    payload['database'] = Path(args.database).name
    print(json.dumps(payload))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
