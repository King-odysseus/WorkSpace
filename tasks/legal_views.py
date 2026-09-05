"""Public, unauthenticated legal pages required by Google's OAuth consent screen.

These mirror the content shown in the in-app Legal tab (StaticViews.jsx LegalView),
which is only reachable after sign-in. Google's Branding page needs a plain URL
anyone can open without logging in, so this content is duplicated here deliberately
- keep both in sync by hand when the policy text changes.
"""
from django.http import HttpResponse
from django.views.decorators.http import require_GET

_PAGE_STYLE = """
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 720px;
         margin: 0 auto; padding: 48px 24px; line-height: 1.6; color: #1a1a1a; }
  h1 { font-size: 1.75rem; margin-bottom: 0.25rem; }
  .eyebrow { color: #666; font-size: 0.9rem; margin-top: 0; }
  h2 { font-size: 1.15rem; margin-top: 2rem; }
  .meta { color: #666; font-size: 0.85rem; margin-top: 3rem; }
</style>
"""


def _legal_page(title, intro, sections):
    body = ''.join(f'<h2>{heading}</h2><p>{text}</p>' for heading, text in sections)
    html = (
        f'<!doctype html><html lang="en"><head><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width, initial-scale=1">'
        f'<title>{title} - WorkSpace</title>{_PAGE_STYLE}</head><body>'
        f'<p class="eyebrow">WorkSpace policies</p><h1>{title}</h1>'
        f'<p>{intro}</p>{body}'
        f'<h2>Contact</h2><p>For questions about these policies or requests about your '
        f'personal data, email <a href="mailto:tijha01@gmail.com">tijha01@gmail.com</a>.</p>'
        f'<nav aria-label="Policy navigation"><a href="/">WorkSpace home</a> | '
        f'<a href="/privacy-policy">Privacy policy</a> | '
        f'<a href="/terms-of-service">Terms of service</a></nav>'
        f'<p class="meta">Last updated: 5 September 2026</p>'
        f'</body></html>'
    )
    return HttpResponse(html, content_type='text/html; charset=utf-8')


@require_GET
def privacy_policy(request):
    return _legal_page(
        'Privacy notice',
        'This notice explains what personal data WorkSpace uses, why it is used, and the choices available to you.',
        [
            ('What we collect', 'Account details, workspace membership, tasks, messages, calendar entries, '
                                 'check-ins, and technical information needed to keep the service secure.'),
            ('Why we use it', 'We use this data to provide the workspace, authenticate users, deliver '
                               'notifications, support collaboration, prevent abuse, and improve reliability.'),
            ('Your rights', 'Depending on your location, you may have rights to access, correct, export, '
                             'restrict, object to, or delete your personal data. Contact your workspace '
                             'administrator to make a request.'),
            ('Screen sharing and screenshots', 'If your workspace owner enables screen sharing, a manager may '
                                                'send you a request. Sharing never starts on its own: you must '
                                                'accept and pick a screen, window, or tab in your browser, and '
                                                'you can stop at any time. While a session is active WorkSpace '
                                                'saves still screenshots at the interval shown to you. No audio, '
                                                'webcam, keystroke, or remote-control data is collected. Only '
                                                'workspace owners and managers can view or download screenshots, '
                                                'you can review your own, every access is audited, and '
                                                'screenshots are deleted automatically after the retention '
                                                'period your workspace has configured.'),
            ('Retention and security', 'We retain workspace data for as long as the workspace is active or as '
                                        'required for legitimate business and legal purposes. Screen-sharing '
                                        'screenshots are deleted automatically after their configured retention '
                                        'period. Access controls, authentication, and audit records help '
                                        'protect it.'),
        ],
    )


@require_GET
def terms_of_service(request):
    return _legal_page(
        'Terms of service',
        'By using WorkSpace, you agree to use it lawfully, protect your login, and respect the people and '
        'data in your workspace.',
        [
            ('Your account', 'Provide accurate account information, keep credentials private, and tell your '
                              'administrator if you suspect unauthorized access.'),
            ('Workspace content', 'You remain responsible for the content you add and for ensuring you have '
                                   'permission to share it with workspace members.'),
            ('Availability', 'We aim to keep WorkSpace reliable, but maintenance, outages, and changes may '
                              'occur. Do not use the service for emergency or safety-critical decisions.'),
        ],
    )
