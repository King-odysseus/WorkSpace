"""Workspace learning articles."""

import json

from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .models import Article
from .views import require_workspace_member

TITLE_LIMIT = 180
BODY_LIMIT = 50000


def _payload(request):
    try:
        value = json.loads(request.body or b'{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None, JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    if not isinstance(value, dict):
        return None, JsonResponse({'error': 'Request body must be an object.'}, status=400)
    cleaned = {}
    for field, limit in (('title', TITLE_LIMIT), ('body', BODY_LIMIT)):
        if field in value:
            item = value[field]
            if not isinstance(item, str):
                return None, JsonResponse({'error': f'{field} must be text.'}, status=400)
            item = item.strip()
            if len(item) > limit:
                return None, JsonResponse({'error': f'{field} must be {limit} characters or fewer.'}, status=400)
            if not item:
                return None, JsonResponse({'error': f'{field} cannot be empty.'}, status=400)
            cleaned[field] = item
    if 'status' in value:
        if value['status'] not in (Article.DRAFT, Article.PUBLISHED):
            return None, JsonResponse({'error': 'status must be draft or published.'}, status=400)
        cleaned['status'] = value['status']
    return cleaned, None


def _can_manage(membership, article, user):
    can_write = membership.role == 'owner' or (membership.role == 'manager' and membership.has_permission('post_memos'))
    return can_write and (article.author_id == user.id or membership.role == 'owner')


@require_http_methods(['GET', 'POST'])
def article_list(request, workspace_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    can_write = membership.role == 'owner' or (membership.role == 'manager' and membership.has_permission('post_memos'))
    if request.method == 'GET':
        articles = Article.objects.filter(workspace_id=workspace_id, status=Article.PUBLISHED)
        if can_write:
            from django.db.models import Q
            drafts = Q(status=Article.DRAFT) if membership.role == 'owner' else Q(status=Article.DRAFT, author=request.user)
            articles = Article.objects.filter(workspace_id=workspace_id).filter(
                Q(status=Article.PUBLISHED) | drafts
            )
        articles = articles.select_related('author').order_by('-published_at', '-created_at', '-id')[:200]
        return JsonResponse({'articles': [article.as_dict() for article in articles], 'can_write': can_write})
    if not can_write:
        return JsonResponse({'error': 'You do not have permission to write articles.'}, status=403)
    cleaned, error = _payload(request)
    if error:
        return error
    if 'title' not in cleaned or 'body' not in cleaned:
        return JsonResponse({'error': 'An article needs a title and body.'}, status=400)
    status = cleaned.get('status', Article.DRAFT)
    article = Article.objects.create(
        workspace_id=workspace_id,
        author=request.user,
        title=cleaned['title'],
        body=cleaned['body'],
        status=status,
        published_at=timezone.now() if status == Article.PUBLISHED else None,
    )
    return JsonResponse({'article': article.as_dict()}, status=201)


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def article_detail(request, workspace_id, article_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    article = Article.objects.filter(id=article_id, workspace_id=workspace_id).select_related('author').first()
    if article is None:
        return JsonResponse({'error': 'Article was not found.'}, status=404)
    can_manage = _can_manage(membership, article, request.user)
    if article.status != Article.PUBLISHED and not can_manage:
        return JsonResponse({'error': 'Article was not found.'}, status=404)
    if request.method == 'GET':
        return JsonResponse({'article': article.as_dict(), 'can_manage': can_manage})
    if not can_manage:
        return JsonResponse({'error': 'You can only change articles you wrote.'}, status=403)
    if request.method == 'DELETE':
        article.delete()
        return JsonResponse({'deleted': article_id})
    cleaned, error = _payload(request)
    if error:
        return error
    for field in ('title', 'body'):
        if field in cleaned:
            setattr(article, field, cleaned[field])
    if 'status' in cleaned:
        previous = article.status
        article.status = cleaned['status']
        if article.status == Article.PUBLISHED and previous != Article.PUBLISHED:
            article.published_at = timezone.now()
        elif article.status == Article.DRAFT:
            article.published_at = None
    article.save()
    return JsonResponse({'article': article.as_dict()})
