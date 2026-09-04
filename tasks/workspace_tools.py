import json
import mimetypes
import os
import base64
import hashlib
import logging
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings as django_settings
from django.http import FileResponse, JsonResponse
from django.views.decorators.http import require_http_methods

from .models import Membership, WorkspaceDocument, WorkspaceDocumentComment, WorkspaceDocumentRevision, WorkspaceDocumentShare, WorkspaceFile, WorkspaceSetting
from .views import require_workspace_leader, require_workspace_member

logger = logging.getLogger(__name__)


def _setting(workspace_id):
    return WorkspaceSetting.objects.get_or_create(workspace_id=workspace_id)[0]


def _document_permission(document, membership, user):
    if membership.role in {'owner', 'manager'} or document.created_by_id == user.id:
        return 'edit'
    share = document.shares.filter(user=user).only('permission').first()
    return share.permission if share else 'view'


AI_PROVIDER_DEFAULTS = {
    'openai': {'base_url': 'https://api.openai.com/v1', 'model': 'gpt-4o-mini', 'key_env': ('OPENAI_API_KEY', 'AI_API_KEY'), 'url_env': 'AI_API_URL', 'model_env': 'AI_MODEL'},
    'claude': {'base_url': 'https://api.anthropic.com/v1', 'model': 'claude-3-5-haiku-latest', 'key_env': ('ANTHROPIC_API_KEY',), 'url_env': 'CLAUDE_API_URL', 'model_env': 'CLAUDE_MODEL'},
    'kimi': {'base_url': 'https://api.moonshot.cn/v1', 'model': 'moonshot-v1-8k', 'key_env': ('KIMI_API_KEY',), 'url_env': 'KIMI_API_URL', 'model_env': 'KIMI_MODEL'},
    'deepseek': {'base_url': 'https://api.deepseek.com', 'model': 'deepseek-v4-flash', 'key_env': ('DEEPSEEK_API_KEY',), 'url_env': 'DEEPSEEK_API_URL', 'model_env': 'DEEPSEEK_MODEL'},
}


def _secret_cipher():
    key = base64.urlsafe_b64encode(hashlib.sha256(django_settings.SECRET_KEY.encode('utf-8')).digest())
    return Fernet(key)


def _encrypt_secret(value):
    return _secret_cipher().encrypt(value.encode('utf-8')).decode('ascii')


def _decrypt_secret(value):
    if not value:
        return ''
    try:
        return _secret_cipher().decrypt(value.encode('ascii')).decode('utf-8')
    except (InvalidToken, ValueError, TypeError):
        return ''


def _environment_value(names):
    return next((os.environ.get(name, '').strip() for name in names if os.environ.get(name, '').strip()), '')


def _provider_values(setting, provider):
    defaults = AI_PROVIDER_DEFAULTS[provider]
    stored = (setting.ai_provider_config or {}).get(provider, {})
    api_key = _decrypt_secret(stored.get('api_key_encrypted')) or _environment_value(defaults['key_env'])
    base_url = stored.get('base_url') or os.environ.get(defaults['url_env'], '').strip() or defaults['base_url']
    model = stored.get('model') or os.environ.get(defaults['model_env'], '').strip() or (setting.ai_model if provider == setting.ai_default_provider else '') or defaults['model']
    return {'api_key': api_key, 'base_url': base_url.rstrip('/'), 'model': model}


def _safe_provider_config(setting):
    result = {}
    for provider in AI_PROVIDER_DEFAULTS:
        values = _provider_values(setting, provider)
        result[provider] = {
            'base_url': values['base_url'],
            'model': values['model'],
            'has_api_key': bool(values['api_key']),
            'key_hint': f"••••{values['api_key'][-4:]}" if values['api_key'] else '',
        }
    return result


def _provider_endpoint(provider, base_url):
    base_url = base_url.rstrip('/')
    expected_path = '/messages' if provider == 'claude' else '/chat/completions'
    return base_url if base_url.endswith(expected_path) else f'{base_url}{expected_path}'


@require_http_methods(['GET', 'PATCH'])
def workspace_ai_settings(request, workspace_id):
    membership, error = (require_workspace_leader(request, workspace_id) if request.method == 'PATCH' else require_workspace_member(request, workspace_id))
    if error:
        return error
    setting = _setting(workspace_id)
    provider_config = _safe_provider_config(setting)
    providers = {provider: values['has_api_key'] for provider, values in provider_config.items()}
    if request.method == 'GET':
        return JsonResponse({'settings': setting.as_dict(), 'can_manage': membership.role in {'owner', 'manager'}, 'providers': providers, 'provider_config': provider_config})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    member_ids = {member.user_id for member in setting.workspace.memberships.all()}
    selected = [int(value) for value in payload.get('ai_user_ids', []) if str(value).isdigit()]
    if not set(selected).issubset(member_ids):
        return JsonResponse({'error': 'AI access can only be granted to workspace members.'}, status=400)
    setting.ai_enabled = bool(payload.get('ai_enabled', setting.ai_enabled))
    setting.ai_user_ids = selected
    setting.ai_model = str(payload.get('ai_model', setting.ai_model or os.environ.get('AI_MODEL', ''))).strip()[:120]
    setting.ai_default_provider = payload.get('ai_default_provider', setting.ai_default_provider) if payload.get('ai_default_provider') in providers else setting.ai_default_provider
    stored_config = dict(setting.ai_provider_config or {})
    submitted_config = payload.get('provider_config', {})
    if submitted_config is not None and not isinstance(submitted_config, dict):
        return JsonResponse({'error': 'Provider configuration must be an object.'}, status=400)
    for provider, defaults in AI_PROVIDER_DEFAULTS.items():
        submitted = submitted_config.get(provider, {}) if isinstance(submitted_config, dict) else {}
        if not isinstance(submitted, dict):
            return JsonResponse({'error': f'Invalid {provider} configuration.'}, status=400)
        current = dict(stored_config.get(provider, {}))
        if 'base_url' in submitted:
            base_url = str(submitted.get('base_url', '')).strip().rstrip('/') or defaults['base_url']
            parsed = urlparse(base_url)
            if parsed.scheme != 'https' or not parsed.netloc:
                return JsonResponse({'error': f'{provider.title()} base URL must be a valid HTTPS address.'}, status=400)
            current['base_url'] = base_url[:500]
        if 'model' in submitted:
            current['model'] = str(submitted.get('model', '')).strip()[:120] or defaults['model']
        api_key = str(submitted.get('api_key', '')).strip()
        if api_key:
            current['api_key_encrypted'] = _encrypt_secret(api_key)
        elif submitted.get('clear_api_key'):
            current.pop('api_key_encrypted', None)
        stored_config[provider] = current
    setting.ai_provider_config = stored_config
    provider_config = _safe_provider_config(setting)
    providers = {provider: values['has_api_key'] for provider, values in provider_config.items()}
    requested_enabled = payload.get('ai_enabled_providers', setting.ai_enabled_providers or [])
    missing_keys = [provider for provider in requested_enabled if provider in providers and not providers[provider]]
    if missing_keys:
        labels = ', '.join(provider.title() for provider in missing_keys)
        return JsonResponse({'error': f'Add and save an API key before enabling {labels}.'}, status=400)
    setting.ai_enabled_providers = [provider for provider in requested_enabled if provider in providers and providers[provider]]
    setting.save(update_fields=['ai_enabled', 'ai_user_ids', 'ai_model', 'ai_default_provider', 'ai_enabled_providers', 'ai_provider_config', 'updated_at'])
    return JsonResponse({'settings': setting.as_dict(), 'providers': providers, 'provider_config': provider_config})


@require_http_methods(['POST'])
def workspace_ai_chat(request, workspace_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    setting = _setting(workspace_id)
    if not setting.ai_enabled or (membership.role == 'member' and request.user.id not in (setting.ai_user_ids or [])):
        return JsonResponse({'error': 'AI assistant access has not been enabled for your account.'}, status=403)
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    message = str(payload.get('message', '')).strip()
    if not message or len(message) > 12000:
        return JsonResponse({'error': 'Enter a message up to 12,000 characters.'}, status=400)
    provider = str(payload.get('provider') or setting.ai_default_provider or 'openai').lower()
    if provider not in AI_PROVIDER_DEFAULTS:
        return JsonResponse({'error': 'Unknown AI provider.'}, status=400)
    if setting.ai_enabled_providers and provider not in setting.ai_enabled_providers:
        return JsonResponse({'error': 'That AI provider is not enabled by your workspace administrator.'}, status=403)
    provider_values = _provider_values(setting, provider)
    api_key = provider_values['api_key']
    if not api_key:
        return JsonResponse({'error': 'The company AI API key has not been configured yet.'}, status=503)
    model = provider_values['model']
    endpoint = _provider_endpoint(provider, provider_values['base_url'])
    if provider == 'claude':
        body = json.dumps({'model': model, 'max_tokens': 1200, 'system': 'You are the company workspace assistant. Be concise, practical, and protect confidential information.', 'messages': [{'role': 'user', 'content': message}]}).encode()
        req = urlrequest.Request(endpoint, data=body, headers={'x-api-key': api_key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json'}, method='POST')
    else:
        body = json.dumps({'model': model, 'messages': [{'role': 'system', 'content': 'You are the company workspace assistant. Be concise, practical, and protect confidential information.'}, {'role': 'user', 'content': message}], 'temperature': 0.3}).encode()
        req = urlrequest.Request(endpoint, data=body, headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}, method='POST')
    try:
        with urlrequest.urlopen(req, timeout=45) as response:
            result = json.loads(response.read().decode())
        answer = (result.get('content', [{}])[0].get('text', '') if provider == 'claude' else result.get('choices', [{}])[0].get('message', {}).get('content', '')).strip()
        return JsonResponse({'answer': answer or 'The assistant returned an empty response.'})
    except (HTTPError, URLError, TimeoutError, ValueError) as exc:
        return JsonResponse({'error': f'AI service unavailable: {exc}'}, status=502)


@require_http_methods(['GET', 'POST'])
def workspace_document_list(request, workspace_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    if request.method == 'GET':
        documents = list(WorkspaceDocument.objects.filter(workspace_id=workspace_id))
        shared_permissions = dict(WorkspaceDocumentShare.objects.filter(document__workspace_id=workspace_id, user=request.user).values_list('document_id', 'permission'))
        can_lead = membership.role in {'owner', 'manager'}
        payload = [{**document.as_dict(), 'permission': 'edit' if can_lead or document.created_by_id == request.user.id else shared_permissions.get(document.id, 'view')} for document in documents]
        return JsonResponse({'documents': payload})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    title = str(payload.get('title', '')).strip()[:200] or 'Untitled document'
    kind = payload.get('kind', 'document') if payload.get('kind') in {'document', 'presentation'} else 'document'
    document = WorkspaceDocument.objects.create(workspace_id=workspace_id, title=title, kind=kind, content=payload.get('content') or {}, created_by=request.user)
    return JsonResponse({'document': {**document.as_dict(), 'permission': 'edit'}}, status=201)


@require_http_methods(['GET', 'PATCH', 'DELETE'])
def workspace_document_detail(request, workspace_id, document_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    document = WorkspaceDocument.objects.filter(workspace_id=workspace_id, id=document_id).first()
    if not document:
        return JsonResponse({'error': 'Document not found.'}, status=404)
    permission = _document_permission(document, membership, request.user)
    if request.method == 'GET':
        return JsonResponse({'document': {**document.as_dict(), 'permission': permission}})
    if request.method == 'DELETE':
        if membership.role not in {'owner', 'manager'} and document.created_by_id != request.user.id:
            return JsonResponse({'error': 'Only the document owner or a workspace leader can delete it.'}, status=403)
        document.delete()
        return JsonResponse({'status': 'deleted'})
    if permission != 'edit':
        return JsonResponse({'error': 'Edit access is required.'}, status=403)
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    if 'title' in payload:
        document.title = str(payload['title']).strip()[:200] or document.title
    if 'content' in payload and isinstance(payload['content'], dict):
        try:
            json.dumps(payload['content'], allow_nan=False)
        except (TypeError, ValueError):
            return JsonResponse({'error': 'Document content contains invalid values.'}, status=400)
        if payload['content'] != document.content:
            WorkspaceDocumentRevision.objects.create(document=document, created_by=request.user, title=document.title, content=document.content or {})
        document.content = payload['content']
    try:
        document.save(update_fields=['title', 'content', 'updated_at'])
    except (TypeError, ValueError) as exc:
        logger.exception('Document save failed for %s', document.id)
        return JsonResponse({'error': f'Document could not be saved: {exc}'}, status=400)
    return JsonResponse({'document': {**document.as_dict(), 'permission': permission}})


@require_http_methods(['GET', 'POST'])
def workspace_document_share_list(request, workspace_id, document_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    document = WorkspaceDocument.objects.filter(workspace_id=workspace_id, id=document_id).first()
    if not document:
        return JsonResponse({'error': 'Document not found.'}, status=404)
    if request.method == 'GET':
        return JsonResponse({'shares': [share.as_dict() for share in document.shares.select_related('user', 'shared_by')]})
    if membership.role not in {'owner', 'manager'} and document.created_by_id != request.user.id:
        return JsonResponse({'error': 'Only the document owner or a workspace leader can share it.'}, status=403)
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    user_id = payload.get('user_id')
    permission = payload.get('permission', 'view')
    if permission not in {'view', 'comment', 'edit'}:
        return JsonResponse({'error': 'Permission must be view, comment, or edit.'}, status=400)
    member = Membership.objects.filter(workspace_id=workspace_id, user_id=user_id).select_related('user').first()
    if not member:
        return JsonResponse({'error': 'Choose a member of this workspace.'}, status=400)
    share, _ = WorkspaceDocumentShare.objects.update_or_create(document=document, user=member.user, defaults={'permission': permission, 'shared_by': request.user})
    return JsonResponse({'share': share.as_dict()}, status=201)


@require_http_methods(['DELETE'])
def workspace_document_share_detail(request, workspace_id, document_id, share_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    document = WorkspaceDocument.objects.filter(workspace_id=workspace_id, id=document_id).first()
    if not document:
        return JsonResponse({'error': 'Document not found.'}, status=404)
    if membership.role not in {'owner', 'manager'} and document.created_by_id != request.user.id:
        return JsonResponse({'error': 'Only the document owner or a workspace leader can change sharing.'}, status=403)
    share = document.shares.filter(id=share_id).first()
    if not share:
        return JsonResponse({'error': 'Share not found.'}, status=404)
    share.delete()
    return JsonResponse({'status': 'deleted'})


@require_http_methods(['GET', 'POST'])
def workspace_document_comment_list(request, workspace_id, document_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    document = WorkspaceDocument.objects.filter(workspace_id=workspace_id, id=document_id).first()
    if not document:
        return JsonResponse({'error': 'Document not found.'}, status=404)
    if request.method == 'GET':
        return JsonResponse({'comments': [comment.as_dict() for comment in document.comments.select_related('author')]})
    if _document_permission(document, membership, request.user) not in {'comment', 'edit'}:
        return JsonResponse({'error': 'Comment access is required.'}, status=403)
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    body = str(payload.get('body', '')).strip()
    if not body or len(body) > 4000:
        return JsonResponse({'error': 'Comment must be between 1 and 4,000 characters.'}, status=400)
    parent = document.comments.filter(id=payload.get('parent_id')).first() if payload.get('parent_id') else None
    comment = WorkspaceDocumentComment.objects.create(document=document, author=request.user, parent=parent, body=body, anchor=payload.get('anchor') if isinstance(payload.get('anchor'), dict) else {})
    return JsonResponse({'comment': comment.as_dict()}, status=201)


@require_http_methods(['PATCH'])
def workspace_document_comment_detail(request, workspace_id, document_id, comment_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    comment = WorkspaceDocumentComment.objects.filter(document_id=document_id, document__workspace_id=workspace_id, id=comment_id).first()
    if not comment:
        return JsonResponse({'error': 'Comment not found.'}, status=404)
    if membership.role not in {'owner', 'manager'} and comment.document.created_by_id != request.user.id and comment.author_id != request.user.id:
        return JsonResponse({'error': 'Only the comment author, document owner, or a workspace leader can update it.'}, status=403)
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    if payload.get('resolved', True):
        from django.utils import timezone
        comment.resolved_at = timezone.now()
        comment.resolved_by = request.user
    else:
        comment.resolved_at = None
        comment.resolved_by = None
    comment.save(update_fields=['resolved_at', 'resolved_by'])
    return JsonResponse({'comment': comment.as_dict()})


@require_http_methods(['GET', 'POST'])
def workspace_file_list(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    if request.method == 'GET':
        return JsonResponse({'files': [item.as_dict() for item in WorkspaceFile.objects.filter(workspace_id=workspace_id)]})
    uploaded = request.FILES.get('file')
    if not uploaded:
        return JsonResponse({'error': 'Choose a file to upload.'}, status=400)
    item = WorkspaceFile.objects.create(workspace_id=workspace_id, file=uploaded, original_name=uploaded.name[:255], mime_type=uploaded.content_type or mimetypes.guess_type(uploaded.name)[0] or '', size=uploaded.size, uploaded_by=request.user)
    cloudinary_url = os.environ.get('CLOUDINARY_URL', '').strip()
    if cloudinary_url:
        try:
            import cloudinary.uploader
            uploaded.seek(0)
            result = cloudinary.uploader.upload(uploaded, resource_type='auto', folder=f'workspace/{workspace_id}')
            item.cloudinary_url = result.get('secure_url', '')
            item.cloudinary_public_id = result.get('public_id', '')
            item.save(update_fields=['cloudinary_url', 'cloudinary_public_id'])
        except Exception:
            logger.exception('Cloudinary upload failed for workspace file %s', item.id)
    return JsonResponse({'file': item.as_dict()}, status=201)


@require_http_methods(['GET'])
def workspace_file_download(request, file_id):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Authentication is required.'}, status=401)
    item = WorkspaceFile.objects.filter(id=file_id, workspace__members=request.user).first()
    if not item or not item.file:
        return JsonResponse({'error': 'File not found.'}, status=404)
    return FileResponse(item.file.open('rb'), as_attachment=True, filename=item.original_name)
