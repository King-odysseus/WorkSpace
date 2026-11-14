# Web push helpers: sends a browser notification bubble even when the PWA is
# closed, via the standard Web Push protocol (no proprietary push service).
#
# Silently does nothing when VAPID keys are not configured (settings.WEB_PUSH_CONFIGURED),
# so environments without push set up behave exactly as before this feature existed.
# Delivery failures are logged, never raised, and one expired subscription never
# aborts the loop over the rest.

import json
import logging
import threading

from django.conf import settings
from pywebpush import WebPushException, webpush

logger = logging.getLogger(__name__)

PUSH_TTL_SECONDS = 24 * 60 * 60
PUSH_TIMEOUT_SECONDS = 10


def normalize_vapid_private_key(value):
    """Return the base64url DER body pywebpush expects.

    Railway and similar dashboards commonly preserve a private key as a PEM
    block. pywebpush's string input still needs the body without the PEM
    markers or line breaks, otherwise it tries to decode the whole block as
    DER and every push fails before reaching the browser.
    """
    value = str(value or '').strip()
    if '-----BEGIN' not in value:
        return value
    return ''.join(
        line.strip()
        for line in value.splitlines()
        if line.strip() and not line.strip().startswith('-----')
    )


def _deliver(subscriptions, payload, user_id):
    """Network half of a push. Runs off the request thread so a slow or dead push
    service never holds up the API response that created the notification."""
    from django.db import close_old_connections
    from .models import PushSubscription

    sent = 0
    try:
        for subscription_id, endpoint, p256dh, auth in subscriptions:
            try:
                webpush(
                    subscription_info={'endpoint': endpoint, 'keys': {'p256dh': p256dh, 'auth': auth}},
                    data=payload,
                    vapid_private_key=normalize_vapid_private_key(settings.VAPID_PRIVATE_KEY),
                    vapid_claims={'sub': f'mailto:{settings.VAPID_CLAIM_EMAIL}'},
                    # pywebpush defaults to ttl=0, which tells the push service to
                    # drop the message unless the browser is reachable right now, so
                    # a closed app or sleeping machine never got the notification.
                    # Hold it for a day and mark it high urgency so it is delivered
                    # promptly instead of being batched.
                    ttl=PUSH_TTL_SECONDS,
                    headers={'Urgency': 'high'},
                    timeout=PUSH_TIMEOUT_SECONDS,
                )
                sent += 1
            except WebPushException as error:
                status_code = getattr(error.response, 'status_code', None)
                if status_code in (404, 410):
                    # The endpoint no longer exists (user revoked the subscription or
                    # cleared site data) - drop it so it is not retried forever.
                    PushSubscription.objects.filter(id=subscription_id).delete()
                    logger.info('Deleted stale push subscription %s for user %s (%s)', subscription_id, user_id, status_code)
                else:
                    logger.warning('Push delivery failed for subscription %s: %s', subscription_id, error)
            except Exception:
                logger.exception('Push delivery failed for subscription %s', subscription_id)
    finally:
        close_old_connections()
    return sent


def send_push_to_user(user, title, body='', url='/', sound=True, sound_name='chime', volume=70, workspace_id=None, wait=False):
    """Queue a push for every device the user has subscribed. Returns the number of
    devices it was queued for (or, with ``wait=True``, delivered to)."""
    if user is None or not settings.WEB_PUSH_CONFIGURED:
        return 0
    from .models import PushSubscription

    payload = json.dumps({
        'title': title,
        'body': body,
        'url': url,
        'sound': sound,
        'sound_name': sound_name,
        'volume': volume,
        'workspace_id': workspace_id,
    })
    subscriptions = list(PushSubscription.objects.filter(user=user).values_list('id', 'endpoint', 'p256dh', 'auth'))
    if not subscriptions:
        return 0
    if wait:
        return _deliver(subscriptions, payload, user.id)
    threading.Thread(target=_deliver, args=(subscriptions, payload, user.id), name='web-push', daemon=True).start()
    return len(subscriptions)
