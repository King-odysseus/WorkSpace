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
    ChannelReadState,
    ChatChannel,
    ChatMessage,
    CheckIn,
    DirectConversation,
    DirectConversationDismissal,
    DirectConversationRead,
    DirectMessage,
    FollowUp,
    LookupValue,
    Membership,
    PlanBucket,
    Project,
    RiskIssue,
    Task,
    UserProfile,
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
    ('direct_conversations', DirectConversation, 'updated_at'),
    ('activity', ActivityEvent, 'created_at'),
    ('buckets', PlanBucket, 'created_at'),
    ('invitations', WorkspaceInvitation, 'created_at'),
    ('lookup_values', LookupValue, 'created_at'),
    ('members', Membership, 'joined_at'),
]

# Collections whose rows can be rewritten in place without a new row appearing.
# ``max(created_at)`` cannot see an edit or a delete, so a viewer who is not the
# author would keep rendering the old body until something unrelated happened to
# move the fingerprint. The newest of these stamps stands in for the row's
# timestamp, and any edit or delete sets one of them to now.
MUTATION_STAMPS = {
    'messages': ('deleted_at', 'edited_at'),
}


def _workspace_parts(workspace_id, user):
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
        # COALESCE rather than GREATEST: SQLite has no GREATEST, and only one of
        # these stamps is ever the live one, the most recent mutation first. The
        # mutation stamps have to lead: created_at is never null, so putting it
        # first would make COALESCE ignore every edit and delete.
        mutation_stamps = [
            connection.ops.quote_name(model._meta.get_field(field).column)
            for field in MUTATION_STAMPS.get(label, ())
        ]
        stamps = mutation_stamps + [column]
        newest = f'MAX(COALESCE({", ".join(stamps)}))' if len(stamps) > 1 else f'MAX({column})'
        selects.append(
            f'SELECT %s AS label, {newest} AS newest, COUNT({table}.{primary_key}) AS total '
            f'FROM {table} WHERE {table}.{workspace_column} = %s'
        )
        params.extend([label, workspace_id])

    read_selects, read_params = _read_state_selects(workspace_id, user)

    with connection.cursor() as cursor:
        cursor.execute(' UNION ALL '.join(selects + read_selects), params + read_params)
        return [f'{label}:{newest or ""}:{total}' for label, newest, total in cursor.fetchall()]


def _read_state_selects(workspace_id, user):
    """The two chat read-watermark tables, in the ``WORKSPACE_COLLECTIONS`` shape.

    Who has read what decides whether the viewer's own messages still show one
    tick, but reading a thread adds no row to any listed collection - so without
    these parts a tick would only flip to two when some unrelated change happened
    to trip the refresh. They sit here rather than in that list because both need
    a join: a channel mark reaches its workspace through the channel it names, and
    a conversation mark only counts when the viewer is in that conversation.
    """
    quote = connection.ops.quote_name

    channel = ChannelReadState._meta
    channel_table = quote(channel.db_table)
    chat_channel = ChatChannel._meta
    chat_channel_table = quote(chat_channel.db_table)
    selects = [
        f'SELECT %s AS label, MAX({channel_table}.{quote(channel.get_field("last_read_at").column)}) AS newest, '
        f'COUNT({channel_table}.{quote(channel.pk.column)}) AS total '
        f'FROM {channel_table} JOIN {chat_channel_table} '
        f'ON {chat_channel_table}.{quote(chat_channel.get_field("workspace").column)} = {channel_table}.{quote(channel.get_field("workspace").column)} '
        f'AND {chat_channel_table}.{quote(chat_channel.get_field("name").column)} = {channel_table}.{quote(channel.get_field("channel_name").column)} '
        f'WHERE {channel_table}.{quote(channel.get_field("workspace").column)} = %s'
    ]
    params = ['channel_reads', workspace_id]

    read = DirectConversationRead._meta
    conversation = DirectConversation._meta
    read_table = quote(read.db_table)
    conversation_table = quote(conversation.db_table)
    participants = conversation.get_field('participants')
    through_table = quote(DirectConversation.participants.through._meta.db_table)
    selects.append(
        f'SELECT %s AS label, MAX({read_table}.{quote(read.get_field("last_read_at").column)}) AS newest, '
        f'COUNT({read_table}.{quote(read.pk.column)}) AS total '
        f'FROM {read_table} JOIN {conversation_table} '
        f'ON {conversation_table}.{quote(conversation.pk.column)} = {read_table}.{quote(read.get_field("conversation").column)} '
        f'JOIN {through_table} '
        f'ON {through_table}.{quote(participants.m2m_column_name())} = {conversation_table}.{quote(conversation.pk.column)} '
        f'WHERE {conversation_table}.{quote(conversation.get_field("workspace").column)} = %s '
        f'AND {through_table}.{quote(participants.m2m_reverse_name())} = %s'
    )
    params.extend(['conversation_reads', workspace_id, user.id])

    dismissal = DirectConversationDismissal._meta
    dismissal_table = quote(dismissal.db_table)
    selects.append(
        f'SELECT %s AS label, MAX({dismissal_table}.{quote(dismissal.get_field("hidden_at").column)}) AS newest, '
        f'COUNT({dismissal_table}.{quote(dismissal.pk.column)}) AS total '
        f'FROM {dismissal_table} JOIN {conversation_table} '
        f'ON {conversation_table}.{quote(conversation.pk.column)} = {dismissal_table}.{quote(dismissal.get_field("conversation").column)} '
        f'WHERE {conversation_table}.{quote(conversation.get_field("workspace").column)} = %s '
        f'AND {dismissal_table}.{quote(dismissal.get_field("user").column)} = %s'
    )
    params.extend(['conversation_dismissals', workspace_id, user.id])

    return selects, params


def workspace_fingerprint(workspace_id, user):
    """A short digest that changes whenever anything this viewer renders changes.

    Row counts sit alongside the newest timestamp so deletions register too - a
    removed row moves the count without moving ``max(updated_at)``.
    """
    parts = _workspace_parts(workspace_id, user)

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
    ).aggregate(
        newest=Max('created_at'),
        total=Count('id'),
        edited=Max('edited_at'),
        deleted=Max('deleted_at'),
    )
    parts.append(f'direct:{direct["newest"] or ""}:{direct["total"]}:{direct["edited"] or ""}:{direct["deleted"] or ""}')

    # Presence and last-seen live on UserProfile (not Membership), so a member's
    # status change or a LastSeenMiddleware stamp would otherwise leave this
    # fingerprint unchanged and the team-online card would go stale.
    presence = UserProfile.objects.filter(user__workspace_memberships__workspace_id=workspace_id).aggregate(
        newest_presence=Max('presence_updated_at'),
        newest_seen=Max('last_seen_at'),
    )
    parts.append(f'presence:{presence["newest_presence"] or ""}:{presence["newest_seen"] or ""}')

    return hashlib.sha256('|'.join(str(part) for part in parts).encode('utf-8')).hexdigest()[:32]


@require_http_methods(['GET'])
def workspace_pulse(request, workspace_id):
    from .views import require_workspace_member

    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    return JsonResponse({'fingerprint': workspace_fingerprint(workspace_id, request.user)})
