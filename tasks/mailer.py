# Transactional email helpers (invitations, task/calendar reminders).
#
# Sends go through Django's normal mail API, which settings.py points at Brevo's
# SMTP relay when BREVO_SMTP_LOGIN/BREVO_SMTP_PASSWORD are configured, or the
# console backend otherwise. A misconfigured or unreachable mail provider never
# breaks the request that triggered it (creating an invitation, recording a
# reminder notification, etc) - the error is logged and the call returns False,
# so the caller can keep going without raising.

import logging

from django.conf import settings
from django.core.mail import send_mail

logger = logging.getLogger(__name__)


def send_workspace_email(to_email, subject, body):
    if not to_email:
        return False
    try:
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [to_email], fail_silently=False)
    except Exception:
        # Broad on purpose: this is a best-effort side effect, and we would rather
        # log the traceback and continue than let an SMTP outage 500 a request.
        logger.exception('Failed to send email "%s" to %s', subject, to_email)
        return False
    return True


def send_invitation_email(invitation):
    accept_url = f'{settings.FRONTEND_BASE_URL}/?invite={invitation.id}'
    inviter_name = invitation.invited_by.get_full_name() or invitation.invited_by.email
    subject = f'You are invited to join {invitation.workspace.name} on WorkSpace'
    body = (
        f'{inviter_name} invited you to join "{invitation.workspace.name}" on WorkSpace as a {invitation.get_role_display()}.\n\n'
        f'Accept your invitation: {accept_url}\n\n'
        'If you do not already have a WorkSpace account, that link will let you create one with this email address first.'
    )
    return send_workspace_email(invitation.email, subject, body)


def send_reminder_email(user, title, body):
    if user is None or not user.email:
        return False
    return send_workspace_email(user.email, title, body or title)
