# Transactional email helpers (invitations, task/calendar reminders).
#
# Sends go through Django's normal mail API, which settings.py points at Brevo's
# SMTP relay when BREVO_SMTP_LOGIN/BREVO_SMTP_PASSWORD are configured, or the
# console backend otherwise. Every call is fail_silently so a misconfigured or
# unreachable mail provider never breaks the request that triggered it (creating
# an invitation, recording a reminder notification, etc).

from django.conf import settings
from django.core.mail import send_mail


def send_workspace_email(to_email, subject, body):
    if not to_email:
        return False
    send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [to_email], fail_silently=True)
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
