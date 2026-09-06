# Transactional email helpers (invitations, task/calendar reminders).
#
# Sends go through Django's normal mail API, which settings.py points at Brevo's
# SMTP relay when BREVO_SMTP_LOGIN/BREVO_SMTP_PASSWORD are configured, or the
# console backend otherwise. A misconfigured or unreachable mail provider never
# breaks the request that triggered it (creating an invitation, recording a
# reminder notification, etc) - the error is logged and the call returns False,
# so the caller can keep going without raising.

import logging
import smtplib
import socket

from django.conf import settings
from django.core.mail import send_mail
from django.core.mail.backends.smtp import EmailBackend as DjangoSMTPBackend

logger = logging.getLogger(__name__)


def _ipv4_create_connection(address, timeout=socket._GLOBAL_DEFAULT_TIMEOUT, source_address=None):
    # Same shape as socket.create_connection(), restricted to AF_INET. Plain
    # create_connection() tries every address getaddrinfo() returns for the
    # host - IPv6 first, on most resolvers. On hosts whose outbound IPv6
    # route is blackholed (no rejection, packets just dropped) rather than
    # genuinely unreachable, that first attempt hangs for minutes with no
    # error, tying up a whole gunicorn sync worker per send. Brevo's relay
    # serves IPv4 fine, so skip the IPv6 attempt entirely.
    host, port = address
    err = None
    for family, socktype, proto, _canonname, sockaddr in socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM):
        sock = None
        try:
            sock = socket.socket(family, socktype, proto)
            if timeout is not socket._GLOBAL_DEFAULT_TIMEOUT:
                sock.settimeout(timeout)
            if source_address:
                sock.bind(source_address)
            sock.connect(sockaddr)
            return sock
        except OSError as exc:
            err = exc
            if sock is not None:
                sock.close()
    if err is not None:
        raise err
    raise OSError('getaddrinfo returned no IPv4 address for %s' % (host,))


class _IPv4SMTP(smtplib.SMTP):
    def _get_socket(self, host, port, timeout):
        return _ipv4_create_connection((host, port), timeout, self.source_address)


class WorkspaceEmailBackend(DjangoSMTPBackend):
    connection_class = _IPv4SMTP


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
    # The link carries the invitation's unguessable token, never its (sequential)
    # id - the public preview endpoint only resolves by token. Never log this URL.
    accept_url = f'{settings.FRONTEND_BASE_URL}/?invite={invitation.token}'
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
