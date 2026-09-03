"""Cheap change-detection probe for the workspace polling loop.

The client used to refetch roughly twenty collections every fifteen seconds and
replace all of its state, whether or not anything had changed. This endpoint
answers the only question that loop actually needs to ask - "has anything moved
since I last looked?" - and the client pays for the full refresh only when the
answer changes.

That keeps the existing (well covered) full-refresh path as the single place
that writes client state, rather than introducing per-collection merge logic on
the client.

Cost matters here because this runs on a timer in every open tab, so the
per-collection aggregates are folded into one ``UNION ALL`` round trip instead
of one query each.
"""

import hashlib

from django.db import connection
from django.db.models import Count, Max, Q
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .models import (
    ActivityEvent,
    CalendarEvent,
    ChatChannel,
    ChatMessage,
    CheckIn,
    DirectMessage,
    FollowUp,
    LookupValue,
    Membership,
    PlanBucket,
    Project,
    RiskIssue,
    Task,
    WorkspaceInvitation,
    WorkspaceNotification,
    WorkShift,
)

# (label, model, timestamp column) - every collection the client renders that is
# scoped to the workspace rather than to the individual viewer.
WORKSPACE_COLLECTIONS = [
    ('tasks', Task, 'updated_at'),
    ('projects', Project, 'updated_at'),
    ('events', CalendarEvent, 'updated_at'),
    ('check_ins', CheckIn, 'updated_at'),
    ('work_shifts', WorkShift, 'updated_at'),
    ('follow_ups', FollowUp, 'updated_at'),
    ('risks', RiskIssue, 'updated_at'),
    ('messages', ChatMessage, 'created_at'),
    ('channels', ChatChannel, 'created_at'),
    ('activity', ActivityEvent, 'created_at'),
    ('buckets', PlanBucket, 'created_at'),
    ('invitations', WorkspaceInvitation, 'created_at'),
    ('lookup_values', LookupValue, 'created_at'),
    ('members', Membership, 'joined_at'),
]


def _workspace_parts(workspace_id):
    """One round trip returning ``(label, newest_timestamp, row_count)`` per collection.

    Table and column names come from the model metadata so a rename in the ORM
    cannot silently desynchronise this query.
    """
    selects = []
    params = []
    for label, model, timestamp_field in WORKSPACE_COLLECTIONS:
        table = connection.ops.quote_name(model._meta.db_table)
        column = connection.ops.quote_name(model._meta.get_field(timestamp_field).column)
        primary_key = connection.ops.quote_name(model._meta.pk.column)
        workspace_column = connection.ops.quote_name(model._meta.get_field('workspace').column)
        selects.append(
            f'SELECT %s AS label, MAX({table}.{column}) AS newest, COUNT({table}.{primary_key}) AS total '
            f'FROM {table} WHERE {table}.{workspace_column} = %s'
        )
        params.extend([label, workspace_id])

    with connection.cursor() as cursor:
        cursor.execute(' UNION ALL '.join(selects), params)
        return [f'{label}:{newest or ""}:{total}' for label, newest, total in cursor.fetchall()]


def workspace_fingerprint(workspace_id, user):
    """A short digest that changes whenever anything this viewer renders changes.

    Row counts sit alongside the newest timestamp so deletions register too - a
    removed row moves the count without moving ``max(updated_at)``.
    """
    parts = _workspace_parts(workspace_id)

    # Per-viewer collections: two people in the same workspace legitimately see
    # different notification and direct-message state.
    notifications = WorkspaceNotification.objects.filter(workspace_id=workspace_id, recipient=user).aggregate(
        newest=Max('created_at'),
        total=Count('id'),
        unread=Count('id', filter=Q(read_at__isnull=True)),
    )
    parts.append(
        f'notifications:{notifications["newest"] or ""}:{notifications["total"]}:{notifications["unread"]}'
    )

    direct = DirectMessage.objects.filter(
        conversation__workspace_id=workspace_id, conversation__participants=user
    ).aggregate(newest=Max('created_at'), total=Count('id'))
    parts.append(f'direct:{direct["newest"] or ""}:{direct["total"]}')

    return hashlib.sha256('|'.join(str(part) for part in parts).encode('utf-8')).hexdigest()[:32]


@require_http_methods(['GET'])
def workspace_pulse(request, workspace_id):
    from .views import require_workspace_member

    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    return JsonResponse({'fingerprint': workspace_fingerprint(workspace_id, request.user)})
