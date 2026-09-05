# Web push helpers: sends a browser notification bubble even when the PWA is
# closed, via the standard Web Push protocol (no proprietary push service).
#
# Silently does nothing when VAPID keys are not configured (settings.WEB_PUSH_CONFIGURED),
# so environments without push set up behave exactly as before this feature existed.

import json

from django.conf import settings
from pywebpush import WebPushException, webpush


def send_push_to_user(user, title, body='', url='/'):
    if user is None or not settings.WEB_PUSH_CONFIGURED:
        return 0
    from .models import PushSubscription

    payload = json.dumps({'title': title, 'body': body, 'url': url})
    sent = 0
    for subscription in PushSubscription.objects.filter(user=user):
        try:
            webpush(
                subscription_info={
                    'endpoint': subscription.endpoint,
                    'keys': {'p256dh': subscription.p256dh, 'auth': subscription.auth},
                },
                data=payload,
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={'sub': f'mailto:{settings.VAPID_CLAIM_EMAIL}'},
            )
            sent += 1
        except WebPushException as error:
            status_code = getattr(error.response, 'status_code', None)
            if status_code in (404, 410):
                subscription.delete()
    return sent
