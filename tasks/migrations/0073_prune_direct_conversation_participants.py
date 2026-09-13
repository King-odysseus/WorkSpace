from django.db import migrations
from django.utils import timezone


def prune_removed_workspace_members(apps, schema_editor):
    """Remove workspace members who are no longer active from existing chats."""
    DirectConversation = apps.get_model('tasks', 'DirectConversation')
    DirectConversationRead = apps.get_model('tasks', 'DirectConversationRead')
    Membership = apps.get_model('tasks', 'Membership')

    conversations = DirectConversation.objects.prefetch_related('participants').all()
    for conversation in conversations:
        active_user_ids = set(
            Membership.objects
            .filter(workspace_id=conversation.workspace_id)
            .values_list('user_id', flat=True)
        )
        existing_user_ids = {user.id for user in conversation.participants.all()}
        remaining_user_ids = sorted(existing_user_ids & active_user_ids)
        if remaining_user_ids == sorted(existing_user_ids):
            continue

        conversation.participants.set(remaining_user_ids)
        DirectConversationRead.objects.filter(conversation_id=conversation.id).exclude(
            user_id__in=remaining_user_ids
        ).delete()

        if len(remaining_user_ids) < 2:
            if conversation.archived_at is None:
                conversation.archived_at = timezone.now()
                conversation.save(update_fields=['archived_at', 'updated_at'])
            continue

        conversation_key = ':'.join(str(value) for value in remaining_user_ids)
        key_in_use = (
            DirectConversation.objects
            .filter(workspace_id=conversation.workspace_id, conversation_key=conversation_key)
            .exclude(id=conversation.id)
            .exists()
        )
        if key_in_use:
            if conversation.archived_at is None:
                conversation.archived_at = timezone.now()
                conversation.save(update_fields=['archived_at', 'updated_at'])
            continue

        conversation.conversation_key = conversation_key
        conversation.save(update_fields=['conversation_key', 'updated_at'])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('tasks', '0072_direct_conversation_archive'),
    ]

    operations = [
        migrations.RunPython(prune_removed_workspace_members, noop),
    ]
