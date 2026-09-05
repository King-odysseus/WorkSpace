"""Outbound delivery of workspace notifications to Teams/Slack-style incoming webhooks."""

import json
import logging
import urllib.error
import urllib.request

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT_SECONDS = 5


def _teams_payload(title, body):
    return {
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        'summary': title,
        'themeColor': '5B5FEF',
        'title': title,
        'text': body or '',
    }


def _slack_payload(title, body):
    text = f'*{title}*' + (f'\n{body}' if body else '')
    return {'text': text}


def _generic_payload(title, body, kind, target_type, target_id):
    return {
        'title': title,
        'body': body,
        'kind': kind,
        'target_type': target_type,
        'target_id': str(target_id) if target_id else '',
    }


def _build_payload(hook_kind, title, body, kind, target_type, target_id):
    if hook_kind == 'teams':
        return _teams_payload(title, body)
    if hook_kind == 'slack':
        return _slack_payload(title, body)
    return _generic_payload(title, body, kind, target_type, target_id)


def deliver_webhook(url, hook_kind, title, body, kind, target_type='', target_id=''):
    """POST a single event to one webhook URL. Failures are logged, never raised."""
    payload = _build_payload(hook_kind, title, body, kind, target_type, target_id)
    data = json.dumps(payload).encode('utf-8')
    request = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS):
            return True
    except (urllib.error.URLError, ValueError, OSError) as error:
        logger.warning('Webhook delivery failed for %s: %s', url, error)
        return False


def notify_workspace_webhooks(workspace_id, kind, title, body='', target_type='', target_id=''):
    """Queue a notification event for every active webhook in the workspace.

    This only writes rows - the HTTP calls happen in :func:`drain_webhook_deliveries`,
    so a slow endpoint can never stall the request that produced the notification.
    """
    from .models import WebhookDelivery, WorkspaceWebhook

    hooks = WorkspaceWebhook.objects.filter(workspace_id=workspace_id, is_active=True)
    WebhookDelivery.objects.bulk_create([
        WebhookDelivery(
            webhook=hook,
            workspace_id=workspace_id,
            kind=kind,
            title=title[:200],
            body=(body or '')[:500],
            target_type=target_type,
            target_id=str(target_id) if target_id else '',
        )
        for hook in hooks
    ])


def drain_webhook_deliveries(limit=100):
    """Send queued webhook posts. Returns ``(sent, failed)`` counts.

    A delivery is retried until :attr:`WebhookDelivery.MAX_ATTEMPTS` is reached,
    after which it is marked failed and left in place for inspection.
    """
    from .models import WebhookDelivery

    pending = list(
        WebhookDelivery.objects
        .filter(status='pending', attempts__lt=WebhookDelivery.MAX_ATTEMPTS)
        .select_related('webhook')[:limit]
    )
    sent = 0
    failed = 0
    for delivery in pending:
        delivery.attempts += 1
        succeeded = deliver_webhook(
            delivery.webhook.url,
            delivery.webhook.kind,
            delivery.title,
            delivery.body,
            delivery.kind,
            target_type=delivery.target_type,
            target_id=delivery.target_id,
        )
        if succeeded:
            delivery.status = 'sent'
            delivery.last_error = ''
            sent += 1
        else:
            delivery.last_error = 'Delivery failed.'
            if delivery.attempts >= WebhookDelivery.MAX_ATTEMPTS:
                delivery.status = 'failed'
                logger.warning('Webhook delivery %s gave up after %s attempts', delivery.id, delivery.attempts)
            failed += 1
        delivery.save(update_fields=['status', 'attempts', 'last_error', 'updated_at'])
    logger.info('Drained %s webhook deliveries: %s sent, %s failed', len(pending), sent, failed)
    return sent, failed
