# Transactional email helpers (invitations, task/calendar reminders).
#
# Sends go through Django's normal mail API (send_mail), which settings.py points
# at BrevoAPIEmailBackend below when BREVO_API_KEY is configured, or the console
# backend otherwise. A misconfigured or unreachable mail provider never breaks
# the request that triggered it (creating an invitation, recording a reminder
# notification, etc) - the error is logged and the call returns False, so the
# caller can keep going without raising.
#
# This uses Brevo's HTTPS REST API (api.brevo.com, port 443) rather than raw
# SMTP (port 587), mirroring TijhaBooks' core/brevo_api_email.py. WorkSpace
# tried SMTP first; on Railway, connecting to smtp-relay.brevo.com:587 timed
# out on both IPv4 and IPv6 (confirmed via traceback - the hang was a raw
# socket connect, before any auth), consistent with outbound SMTP being
# blocked at the platform/network level while HTTPS is not.

import logging
from email.utils import parseaddr

import requests
from django.conf import settings
from django.core.mail import send_mail
from django.core.mail.backends.base import BaseEmailBackend
from django.template.loader import render_to_string

logger = logging.getLogger(__name__)

BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'


class BrevoAPIEmailBackend(BaseEmailBackend):
    def send_messages(self, email_messages):
        if not email_messages:
            return 0
        api_key = getattr(settings, 'BREVO_API_KEY', '')
        if not api_key:
            if not self.fail_silently:
                raise ValueError('BREVO_API_KEY is not configured.')
            return 0
        headers = {'accept': 'application/json', 'content-type': 'application/json', 'api-key': api_key}
        # BREVO_SENDER_EMAIL/BREVO_SENDER_NAME (same names TijhaBooks uses) take
        # priority when set, since a Brevo API sender must be a verified address -
        # falling back to parsing message.from_email/DEFAULT_FROM_EMAIL otherwise.
        configured_sender_email = getattr(settings, 'BREVO_SENDER_EMAIL', '')
        configured_sender_name = getattr(settings, 'BREVO_SENDER_NAME', '')
        sent = 0
        for message in email_messages:
            parsed_name, parsed_email = parseaddr(message.from_email or settings.DEFAULT_FROM_EMAIL)
            sender_email = configured_sender_email or parsed_email
            sender_name = configured_sender_name or parsed_name or 'WorkSpace'
            payload = {
                'sender': {'name': sender_name, 'email': sender_email},
                'to': [{'email': recipient} for recipient in message.to],
                'subject': message.subject,
                'textContent': message.body,
            }
            # send_mail(html_message=...) attaches the HTML as an alternative
            # part; Brevo takes it as htmlContent alongside the plain-text
            # fallback, so clients that block HTML still get a readable email.
            for alternative in getattr(message, 'alternatives', None) or []:
                content, mimetype = alternative[0], alternative[1]
                if mimetype == 'text/html':
                    payload['htmlContent'] = content
                    break
            try:
                response = requests.post(BREVO_API_URL, json=payload, headers=headers, timeout=10)
            except requests.RequestException:
                logger.exception('Brevo API request failed sending "%s" to %s', message.subject, message.to)
                if not self.fail_silently:
                    raise
                continue
            if response.status_code == 201:
                sent += 1
            else:
                logger.error('Brevo API error (%s) sending "%s" to %s: %s', response.status_code, message.subject, message.to, response.text[:500])
                if not self.fail_silently:
                    raise RuntimeError(f'Brevo API error {response.status_code}: {response.text[:500]}')
        return sent


def render_branded_email(title, paragraphs, cta_label=None, cta_url=None, footer_note=None):
    # Every email goes out as branded HTML with the plain-text body as the
    # fallback part. The template autoescapes, so callers pass raw values.
    return render_to_string('tasks/emails/workspace_email.html', {
        'title': title,
        'paragraphs': paragraphs,
        'cta_label': cta_label,
        'cta_url': cta_url,
        'footer_note': footer_note,
    })


def send_workspace_email(to_email, subject, body, html_body=None):
    if not to_email:
        return False
    try:
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [to_email], fail_silently=False, html_message=html_body)
    except Exception:
        # Broad on purpose: this is a best-effort side effect, and we would rather
        # log the traceback and continue than let a mail outage 500 a request.
        logger.exception('Failed to send email "%s" to %s', subject, to_email)
        return False
    return True


def send_invitation_email(invitation):
    # The link carries the invitation's unguessable token, never its (sequential)
    # id - the public preview endpoint only resolves by token. Never log this URL.
    accept_url = f'{settings.FRONTEND_BASE_URL}/?invite={invitation.token}'
    inviter_name = invitation.invited_by.get_full_name() or invitation.invited_by.email
    workspace_name = invitation.workspace.name
    role_label = invitation.get_role_display()
    subject = f'You are invited to join {workspace_name} on WorkSpace'
    intro = f'{inviter_name} invited you to join "{workspace_name}" on WorkSpace as a {role_label}.'
    fallback_note = 'If you do not already have a WorkSpace account, that link will let you create one with this email address first.'
    body = f'{intro}\n\nAccept your invitation: {accept_url}\n\n{fallback_note}'
    html_body = render_branded_email(
        title=f'You have been invited to {workspace_name}',
        paragraphs=[intro, 'Review the invitation and choose whether to accept it:'],
        cta_label='Review invitation',
        cta_url=accept_url,
        footer_note=fallback_note,
    )
    return send_workspace_email(invitation.email, subject, body, html_body=html_body)


def send_reminder_email(user, title, body):
    if user is None or not user.email:
        return False
    text_body = body or title
    html_body = render_branded_email(
        title=title,
        paragraphs=[text_body],
        cta_label='Open WorkSpace',
        cta_url=settings.FRONTEND_BASE_URL,
        footer_note='You can turn reminder emails off under Settings > Notifications.',
    )
    return send_workspace_email(user.email, title, text_body, html_body=html_body)
