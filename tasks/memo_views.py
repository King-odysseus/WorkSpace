"""Company memos: write one announcement for the whole workspace.

A memo is shown on the Memos page, as a banner at the top of the app for a while
after it is posted (each person can close it for themselves), and as a
notification to everyone else in the workspace. Posting needs the post_memos
permission, which owners and managers have by default and members do not.
"""

import json
from datetime import date, timedelta

from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .models import Membership, Memo, MemoDismissal, MemoResponse
from .views import create_notification, require_workspace_member

MEMO_TITLE_LIMIT = 160
MEMO_BODY_LIMIT = 5000
DEFAULT_BANNER_DAYS = 7
MAX_BANNER_DAYS = 60
RESPONSE_LIMIT = 2000


def _json_body(request):
    try:
        return json.loads(request.body or '{}'), None
    except json.JSONDecodeError:
        return None, JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)


def _clean_fields(payload, require_all):
    """Validated title and body, or an error response. With require_all=False only
    the fields that were sent are checked, for an edit."""
    cleaned = {}
    if require_all or 'title' in payload:
        title = str(payload.get('title', '')).strip()
        if not title:
            return None, JsonResponse({'error': 'A memo needs a title.'}, status=400)
        if len(title) > MEMO_TITLE_LIMIT:
            return None, JsonResponse({'error': f'The title must be {MEMO_TITLE_LIMIT} characters or fewer.'}, status=400)
        cleaned['title'] = title
    if require_all or 'body' in payload:
        body = str(payload.get('body', '')).strip()
        if not body:
            return None, JsonResponse({'error': 'A memo needs some text.'}, status=400)
        if len(body) > MEMO_BODY_LIMIT:
            return None, JsonResponse({'error': f'The memo must be {MEMO_BODY_LIMIT} characters or fewer.'}, status=400)
        cleaned['body'] = body
    if require_all and payload.get('kind', 'memo') not in ('memo', 'request'):
        return None, JsonResponse({'error': 'kind must be memo or request.'}, status=400)
    if require_all:
        cleaned['kind'] = payload.get('kind', 'memo')
    if 'due_date' in payload:
        raw = payload['due_date']
        if raw in (None, ''):
            cleaned['due_date'] = None
        else:
            try:
                cleaned['due_date'] = date.fromisoformat(str(raw))
            except ValueError:
                return None, JsonResponse({'error': 'due_date must use YYYY-MM-DD format.'}, status=400)
    if 'banner_days' in payload:
        try:
            days = int(payload['banner_days'])
        except (TypeError, ValueError):
            return None, JsonResponse({'error': 'banner_days must be a whole number.'}, status=400)
        if not 0 <= days <= MAX_BANNER_DAYS:
            return None, JsonResponse({'error': f'banner_days must be between 0 and {MAX_BANNER_DAYS}.'}, status=400)
        cleaned['banner_days'] = days
    return cleaned, None


def _banner_until(days):
    return timezone.now() + timedelta(days=days) if days > 0 else None


def _dismissed_ids(user, memos):
    return set(MemoDismissal.objects.filter(user=user, memo__in=memos).values_list('memo_id', flat=True))


def _memo_for(request, workspace_id, memo_id):
    return Memo.objects.filter(id=memo_id, workspace_id=workspace_id, archived_at__isnull=True).select_related('author').first()


def decorate(memo, user, can_post, dismissed_ids=frozenset()):
    """The memo as the signed-in person sees it. A request memo carries that person's
    own answer; people who can post also see everyone's answers and who is still owed."""
    data = memo.as_dict(dismissed_ids)
    if memo.kind != 'request':
        return data
    answers = list(memo.responses.select_related('user'))
    mine = next((a for a in answers if a.user_id == user.id), None)
    data['my_response'] = {'note': mine.note, 'created_at': mine.created_at.isoformat()} if mine else None
    data['response_count'] = len(answers)
    if can_post:
        answered = {a.user_id for a in answers}
        data['responses'] = [{'user_id': a.user_id, 'name': a.user.get_full_name() or a.user.email, 'note': a.note, 'created_at': a.created_at.isoformat()} for a in answers]
        waiting = Membership.objects.filter(workspace_id=memo.workspace_id).exclude(user_id=memo.author_id).exclude(user_id__in=answered).select_related('user')
        data['waiting'] = [{'user_id': m.user_id, 'name': m.user.get_full_name() or m.user.email} for m in waiting]
    return data


def notify_memo(memo, author):
    """Tell everyone else in the workspace, in the app and by push where they use it."""
    label = 'Request' if memo.kind == 'request' else 'Memo'
    for membership in Membership.objects.filter(workspace_id=memo.workspace_id).exclude(user=author).select_related('user'):
        create_notification(
            memo.workspace_id, membership.user, 'memo', f'{label}: {memo.title}'[:200], memo.body[:200],
            target_type='memo', target_id=memo.id, notify_webhooks=False,
        )


def create_memo(workspace_id, author, title, body, banner_days=DEFAULT_BANNER_DAYS, kind='memo', due_date=None):
    """The one place a memo is made, so the page and Zuri post it the same way."""
    memo = Memo.objects.create(workspace_id=workspace_id, author=author, title=title, body=body, banner_until=_banner_until(banner_days), kind=kind, due_date=due_date)
    notify_memo(memo, author)
    return memo


@require_http_methods(['GET', 'POST'])
def memo_list(request, workspace_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    can_post = membership.has_permission('post_memos')
    if request.method == 'GET':
        memos = list(Memo.objects.filter(workspace_id=workspace_id, archived_at__isnull=True).select_related('author')[:100])
        dismissed = _dismissed_ids(request.user, memos)
        return JsonResponse({'memos': [decorate(memo, request.user, can_post, dismissed) for memo in memos], 'can_post': can_post})
    if not can_post:
        return JsonResponse({'error': 'You do not have permission to post memos.'}, status=403)
    payload, error = _json_body(request)
    if error:
        return error
    cleaned, error = _clean_fields(payload, require_all=True)
    if error:
        return error
    memo = create_memo(workspace_id, request.user, cleaned['title'], cleaned['body'], cleaned.get('banner_days', DEFAULT_BANNER_DAYS), cleaned['kind'], cleaned.get('due_date'))
    return JsonResponse({'memo': decorate(memo, request.user, True)}, status=201)


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def memo_detail(request, workspace_id, memo_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    memo = _memo_for(request, workspace_id, memo_id)
    if memo is None:
        return JsonResponse({'error': 'Memo was not found.'}, status=404)
    if request.method == 'GET':
        return JsonResponse({'memo': decorate(memo, request.user, membership.has_permission('post_memos'), _dismissed_ids(request.user, [memo]))})
    # Changing or removing a memo is for people who can post, and only their own
    # unless they are an owner.
    if not membership.has_permission('post_memos') or (memo.author_id != request.user.id and membership.role != 'owner'):
        return JsonResponse({'error': 'You can only change memos you posted.'}, status=403)
    if request.method == 'DELETE':
        memo.archived_at = timezone.now()
        memo.save(update_fields=['archived_at', 'updated_at'])
        return JsonResponse({'deleted': memo.id})
    payload, error = _json_body(request)
    if error:
        return error
    cleaned, error = _clean_fields(payload, require_all=False)
    if error:
        return error
    for field in ('title', 'body'):
        if field in cleaned:
            setattr(memo, field, cleaned[field])
    if 'banner_days' in cleaned:
        memo.banner_until = _banner_until(cleaned['banner_days'])
    if 'due_date' in cleaned:
        memo.due_date = cleaned['due_date']
    memo.save()
    return JsonResponse({'memo': decorate(memo, request.user, True, _dismissed_ids(request.user, [memo]))})


@require_http_methods(['POST'])
def memo_dismiss(request, workspace_id, memo_id):
    """Close this memo's banner for the signed-in member only. Repeating it is harmless."""
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    memo = _memo_for(request, workspace_id, memo_id)
    if memo is None:
        return JsonResponse({'error': 'Memo was not found.'}, status=404)
    MemoDismissal.objects.get_or_create(memo=memo, user=request.user)
    return JsonResponse({'memo': decorate(memo, request.user, membership.has_permission('post_memos'), {memo.id})})


@require_http_methods(['POST', 'DELETE'])
def memo_respond(request, workspace_id, memo_id):
    """Answer a request memo (once; answering again replaces the earlier answer)."""
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    memo = _memo_for(request, workspace_id, memo_id)
    if memo is None or memo.kind != 'request':
        return JsonResponse({'error': 'Request memo was not found.'}, status=404)
    if request.method == 'DELETE':
        MemoResponse.objects.filter(memo=memo, user=request.user).delete()
        return JsonResponse({'memo': decorate(memo, request.user, False)})
    payload, error = _json_body(request)
    if error:
        return error
    note = str(payload.get('note', '')).strip()
    if len(note) > RESPONSE_LIMIT:
        return JsonResponse({'error': f'The answer must be {RESPONSE_LIMIT} characters or fewer.'}, status=400)
    _, created = MemoResponse.objects.update_or_create(memo=memo, user=request.user, defaults={'note': note})
    if created and memo.author_id and memo.author_id != request.user.id:
        who = request.user.get_full_name() or request.user.email
        create_notification(
            memo.workspace_id, memo.author, 'memo', f'{who} answered: {memo.title}'[:200], (note or 'Done')[:200],
            target_type='memo', target_id=memo.id, notify_webhooks=False,
        )
    return JsonResponse({'memo': decorate(memo, request.user, False)})
