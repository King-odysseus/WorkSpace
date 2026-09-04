"""Consent-bound screen sharing and screenshot APIs.

The server never starts device capture. Only an employee-side call to the
browser's getDisplayMedia API can produce uploads for an active, consented
session.
"""

import hashlib
import json
from datetime import timedelta

from PIL import Image, UnidentifiedImageError
from django.contrib.auth.models import User
from django.db import IntegrityError, transaction
from django.db.models import Count
from django.http import FileResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .models import AuditLog, Membership, ScreenCapture, ScreenShareSession, WorkspaceSetting
from .views import create_notification


MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024
REQUEST_LIFETIME = timedelta(minutes=10)
ACTIVE_SESSION_LIFETIME = timedelta(hours=4)
HEARTBEAT_TIMEOUT = timedelta(seconds=180)


def _membership(request, workspace_id, leader=False, owner=False):
    if not request.user.is_authenticated:
        return None, JsonResponse({'error': 'Authentication is required.'}, status=401)
    membership = Membership.objects.filter(workspace_id=workspace_id, user=request.user).first()
    if membership is None:
        return None, JsonResponse({'error': 'You do not belong to this workspace.'}, status=403)
    if owner and membership.role != 'owner':
        return None, JsonResponse({'error': 'Workspace owner access is required.'}, status=403)
    if leader and membership.role not in {'owner', 'manager'}:
        return None, JsonResponse({'error': 'Owner or manager access is required.'}, status=403)
    return membership, None


def _audit(workspace_id, actor, action, target_type, target_id, details=None):
    return AuditLog.objects.create(
        workspace_id=workspace_id, actor=actor, action=action,
        target_type=target_type, target_id=str(target_id), details=details or {},
    )


def _notify_requester(session, summary):
    """Let the leader who asked know how the employee responded."""
    if session.requested_by_id is None or session.requested_by_id == session.employee_id:
        return
    create_notification(
        session.workspace_id, session.requested_by, 'screen_share_response',
        'Screen-sharing update', f'{session.employee_name or session.employee_email} {summary}.',
        'screen_share_session', session.id,
    )


def _policy_payload(setting, can_manage=False):
    return {
        'enabled': setting.screen_sharing_enabled,
        'capture_interval_seconds': setting.screen_capture_interval_seconds,
        'capture_retention_days': setting.screen_capture_retention_days,
        'text': setting.screen_sharing_policy,
        'version': setting.screen_sharing_policy_version,
        'can_manage': can_manage,
    }


def expire_screen_sharing_data(workspace_id=None):
    """Expire abandoned sessions and permanently remove elapsed captures."""
    now = timezone.now()
    sessions = ScreenShareSession.objects.filter(status__in=['pending', 'active'])
    captures = ScreenCapture.objects.filter(expires_at__lte=now)
    if workspace_id is not None:
        sessions = sessions.filter(workspace_id=workspace_id)
        captures = captures.filter(workspace_id=workspace_id)
    expired_sessions = 0
    for session in sessions.iterator():
        heartbeat_stale = session.status == 'active' and session.last_heartbeat_at and session.last_heartbeat_at < now - HEARTBEAT_TIMEOUT
        if session.expires_at <= now or heartbeat_stale:
            session.status = 'expired'
            session.ended_at = now
            session.stop_reason = 'heartbeat_timeout' if heartbeat_stale else 'time_limit'
            session.save(update_fields=['status', 'ended_at', 'stop_reason', 'updated_at'])
            _audit(session.workspace_id, None, 'screen_share_expired', 'screen_share_session', session.id, {'employee_id': session.employee_id, 'reason': session.stop_reason})
            expired_sessions += 1
    deleted_captures = 0
    for capture in captures.iterator():
        capture_id = capture.id
        _audit(capture.workspace_id, None, 'screen_capture_expired', 'screen_capture', capture_id, {'session_id': str(capture.session_id)})
        capture.delete()
        deleted_captures += 1
    return {'expired_sessions': expired_sessions, 'deleted_captures': deleted_captures}


@require_http_methods(['GET', 'PATCH'])
def screen_sharing_policy(request, workspace_id):
    membership, error = _membership(request, workspace_id, owner=request.method == 'PATCH')
    if error:
        return error
    setting, _ = WorkspaceSetting.objects.get_or_create(workspace_id=workspace_id)
    if request.method == 'GET':
        return JsonResponse({'policy': _policy_payload(setting, membership.role == 'owner')})
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    if set(payload) - {'enabled', 'capture_interval_seconds', 'capture_retention_days', 'text'}:
        return JsonResponse({'error': 'Unsupported policy fields.'}, status=400)
    try:
        interval = int(payload.get('capture_interval_seconds', setting.screen_capture_interval_seconds))
        retention = int(payload.get('capture_retention_days', setting.screen_capture_retention_days))
    except (TypeError, ValueError):
        return JsonResponse({'error': 'Capture interval and retention must be integers.'}, status=400)
    if not 30 <= interval <= 300:
        return JsonResponse({'error': 'Capture interval must be between 30 and 300 seconds.'}, status=400)
    if not 1 <= retention <= 30:
        return JsonResponse({'error': 'Capture retention must be between 1 and 30 days.'}, status=400)
    text = str(payload.get('text', setting.screen_sharing_policy)).strip()
    if len(text) < 100 or len(text) > 5000:
        return JsonResponse({'error': 'Policy text must be between 100 and 5000 characters.'}, status=400)
    previous = {'enabled': setting.screen_sharing_enabled, 'interval': setting.screen_capture_interval_seconds, 'retention': setting.screen_capture_retention_days, 'version': setting.screen_sharing_policy_version}
    text_changed = text != setting.screen_sharing_policy
    if 'enabled' in payload and not isinstance(payload['enabled'], bool):
        return JsonResponse({'error': 'enabled must be a boolean.'}, status=400)
    setting.screen_sharing_enabled = payload.get('enabled', setting.screen_sharing_enabled)
    setting.screen_capture_interval_seconds = interval
    setting.screen_capture_retention_days = retention
    setting.screen_sharing_policy = text
    if text_changed:
        setting.screen_sharing_policy_version += 1
    setting.save(update_fields=['screen_sharing_enabled', 'screen_capture_interval_seconds', 'screen_capture_retention_days', 'screen_sharing_policy', 'screen_sharing_policy_version', 'updated_at'])
    _audit(workspace_id, request.user, 'screen_sharing_policy_updated', 'workspace', workspace_id, {'previous': previous, 'new': {'enabled': setting.screen_sharing_enabled, 'interval': interval, 'retention': retention, 'version': setting.screen_sharing_policy_version}})
    return JsonResponse({'policy': _policy_payload(setting, True)})


@require_http_methods(['GET', 'POST'])
def screen_share_session_list(request, workspace_id):
    membership, error = _membership(request, workspace_id, leader=request.method == 'POST')
    if error:
        return error
    expire_screen_sharing_data(workspace_id)
    sessions = ScreenShareSession.objects.filter(workspace_id=workspace_id).select_related('requested_by', 'employee')
    own_only = request.GET.get('scope') == 'mine'
    if membership.role == 'member' or own_only:
        sessions = sessions.filter(employee=request.user)
    if request.method == 'GET':
        with_counts = not own_only
        if with_counts:
            sessions = sessions.annotate(capture_total=Count('captures'))
        return JsonResponse({'sessions': [item.as_dict(include_capture_count=with_counts) for item in sessions[:100]]})
    setting, _ = WorkspaceSetting.objects.get_or_create(workspace_id=workspace_id)
    if not setting.screen_sharing_enabled:
        return JsonResponse({'error': 'Screen sharing is disabled until the workspace owner enables and publishes the policy.'}, status=409)
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    employee = User.objects.filter(id=payload.get('employee_id'), workspace_memberships__workspace_id=workspace_id).first()
    if employee is None:
        return JsonResponse({'error': 'Employee was not found in this workspace.'}, status=404)
    if employee.id == request.user.id:
        return JsonResponse({'error': 'Choose another workspace member.'}, status=400)
    message = str(payload.get('message', '') or '').strip()
    if len(message) > 500:
        return JsonResponse({'error': 'Message must be 500 characters or fewer.'}, status=400)
    try:
        with transaction.atomic():
            session = ScreenShareSession.objects.create(
                workspace_id=workspace_id, requested_by=request.user, employee=employee,
                employee_name=employee.get_full_name() or employee.email, employee_email=employee.email,
                message=message, policy_text=setting.screen_sharing_policy,
                policy_version=setting.screen_sharing_policy_version,
                capture_interval_seconds=setting.screen_capture_interval_seconds,
                capture_retention_days=setting.screen_capture_retention_days,
                expires_at=timezone.now() + REQUEST_LIFETIME,
            )
    except IntegrityError:
        return JsonResponse({'error': 'This employee already has a pending or active screen-sharing session.'}, status=409)
    _audit(workspace_id, request.user, 'screen_share_requested', 'screen_share_session', session.id, {'employee_id': employee.id})
    create_notification(workspace_id, employee, 'screen_share_request', 'Screen-sharing request', f'{request.user.get_full_name() or request.user.email} requested a consent-based screen-sharing session.', 'screen_share_session', session.id)
    return JsonResponse({'session': session.as_dict(include_capture_count=True)}, status=201)


@require_http_methods(['PATCH'])
def screen_share_session_detail(request, workspace_id, session_id):
    membership, error = _membership(request, workspace_id)
    if error:
        return error
    expire_screen_sharing_data(workspace_id)
    session = ScreenShareSession.objects.select_related('requested_by', 'employee').filter(id=session_id, workspace_id=workspace_id).first()
    if session is None:
        return JsonResponse({'error': 'Screen-sharing session was not found.'}, status=404)
    try:
        payload = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)
    action = payload.get('action')
    now = timezone.now()
    if action in {'accept', 'decline'}:
        if session.employee_id != request.user.id:
            return JsonResponse({'error': 'Only the requested employee can respond.'}, status=403)
        if session.status != 'pending' or session.expires_at <= now:
            return JsonResponse({'error': 'This request is no longer pending.'}, status=409)
        if action == 'decline':
            session.status, session.ended_at, session.stop_reason = 'declined', now, 'employee_declined'
            audit_action = 'screen_share_declined'
        else:
            session.status = 'active'
            session.accepted_at = session.started_at = session.last_heartbeat_at = now
            session.expires_at = now + ACTIVE_SESSION_LIFETIME
            audit_action = 'screen_share_accepted'
        session.save()
        _audit(workspace_id, request.user, audit_action, 'screen_share_session', session.id, {'policy_version': session.policy_version})
        _notify_requester(session, 'accepted and started sharing' if action == 'accept' else 'declined the request')
        return JsonResponse({'session': session.as_dict()})
    if action == 'stop':
        if session.employee_id != request.user.id:
            return JsonResponse({'error': 'Only the sharing employee can stop this session.'}, status=403)
        if session.status != 'active':
            return JsonResponse({'error': 'This session is not active.'}, status=409)
        session.status, session.ended_at, session.stop_reason = 'stopped', now, 'employee_stopped'
        session.save(update_fields=['status', 'ended_at', 'stop_reason', 'updated_at'])
        _audit(workspace_id, request.user, 'screen_share_stopped', 'screen_share_session', session.id)
        _notify_requester(session, 'stopped sharing')
        return JsonResponse({'session': session.as_dict()})
    if action == 'cancel':
        if membership.role not in {'owner', 'manager'}:
            return JsonResponse({'error': 'Only workspace leaders can cancel requests.'}, status=403)
        if session.status != 'pending':
            return JsonResponse({'error': 'Only pending requests can be cancelled.'}, status=409)
        session.status, session.ended_at, session.stop_reason = 'cancelled', now, 'manager_cancelled'
        session.save(update_fields=['status', 'ended_at', 'stop_reason', 'updated_at'])
        _audit(workspace_id, request.user, 'screen_share_cancelled', 'screen_share_session', session.id)
        return JsonResponse({'session': session.as_dict(include_capture_count=True)})
    return JsonResponse({'error': 'action must be accept, decline, stop, or cancel.'}, status=400)


@require_http_methods(['POST'])
def screen_share_heartbeat(request, workspace_id, session_id):
    _, error = _membership(request, workspace_id)
    if error:
        return error
    session = ScreenShareSession.objects.filter(id=session_id, workspace_id=workspace_id, employee=request.user).first()
    if session is None:
        return JsonResponse({'error': 'Screen-sharing session was not found.'}, status=404)
    now = timezone.now()
    if session.status != 'active' or session.expires_at <= now:
        expire_screen_sharing_data(workspace_id)
        return JsonResponse({'error': 'This session is not active.'}, status=409)
    session.last_heartbeat_at = now
    session.save(update_fields=['last_heartbeat_at', 'updated_at'])
    return JsonResponse({'active': True, 'expires_at': session.expires_at.isoformat()})


@require_http_methods(['GET', 'POST'])
def screen_capture_list(request, workspace_id, session_id):
    membership, error = _membership(request, workspace_id)
    if error:
        return error
    expire_screen_sharing_data(workspace_id)
    session = ScreenShareSession.objects.filter(id=session_id, workspace_id=workspace_id).first()
    if session is None:
        return JsonResponse({'error': 'Screen-sharing session was not found.'}, status=404)
    if request.method == 'GET':
        is_subject = session.employee_id == request.user.id
        if membership.role not in {'owner', 'manager'} and not is_subject:
            return JsonResponse({'error': 'Only authorised workspace leaders can view screenshots.'}, status=403)
        captures = session.captures.all()[:200]
        _audit(workspace_id, request.user, 'screen_captures_viewed', 'screen_share_session', session.id, {'capture_count': len(captures)})
        return JsonResponse({'captures': [capture.as_dict() for capture in captures]})
    if session.employee_id != request.user.id:
        return JsonResponse({'error': 'Only the sharing employee can upload captures.'}, status=403)
    now = timezone.now()
    if session.status != 'active' or session.expires_at <= now:
        return JsonResponse({'error': 'This session is not active.'}, status=409)
    uploaded = request.FILES.get('capture')
    if uploaded is None:
        return JsonResponse({'error': 'A capture image is required.'}, status=400)
    if uploaded.size > MAX_SCREENSHOT_BYTES or uploaded.content_type not in {'image/jpeg', 'image/png', 'image/webp'}:
        return JsonResponse({'error': 'Capture must be a JPEG, PNG, or WebP image no larger than 5 MB.'}, status=400)
    latest = session.captures.order_by('-captured_at').first()
    if latest and (now - latest.captured_at).total_seconds() < session.capture_interval_seconds * 0.8:
        return JsonResponse({'error': 'The next scheduled capture is not due yet.'}, status=429)
    try:
        image = Image.open(uploaded)
        width, height = image.size
        detected_mime = {'JPEG': 'image/jpeg', 'PNG': 'image/png', 'WEBP': 'image/webp'}.get(image.format)
        if detected_mime is None:
            return JsonResponse({'error': 'Capture content must be a JPEG, PNG, or WebP image.'}, status=400)
        image.verify()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        return JsonResponse({'error': 'Capture is not a valid image.'}, status=400)
    if width < 1 or height < 1 or width > 10000 or height > 10000:
        return JsonResponse({'error': 'Capture dimensions are invalid.'}, status=400)
    uploaded.seek(0)
    digest = hashlib.sha256()
    for chunk in uploaded.chunks():
        digest.update(chunk)
    uploaded.seek(0)
    capture = ScreenCapture.objects.create(
        session=session, workspace_id=workspace_id, captured_by=request.user,
        image=uploaded, mime_type=detected_mime, size=uploaded.size,
        width=width, height=height, sha256=digest.hexdigest(),
        expires_at=now + timedelta(days=session.capture_retention_days),
    )
    _audit(workspace_id, request.user, 'screen_capture_created', 'screen_capture', capture.id, {'session_id': str(session.id), 'expires_at': capture.expires_at.isoformat()})
    return JsonResponse({'capture': capture.as_dict()}, status=201)


@require_http_methods(['GET', 'DELETE'])
def screen_capture_detail(request, capture_id):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Authentication is required.'}, status=401)
    capture = ScreenCapture.objects.select_related('session').filter(id=capture_id).first()
    if capture is None:
        return JsonResponse({'error': 'Screenshot was not found.'}, status=404)
    membership = Membership.objects.filter(workspace_id=capture.workspace_id, user=request.user).first()
    is_leader = membership is not None and membership.role in {'owner', 'manager'}
    is_subject = membership is not None and capture.session.employee_id == request.user.id
    if not is_leader and not is_subject:
        return JsonResponse({'error': 'Only authorised workspace leaders can access screenshots.'}, status=403)
    if request.method == 'DELETE' and not is_leader:
        return JsonResponse({'error': 'Only authorised workspace leaders can delete screenshots.'}, status=403)
    if capture.expires_at <= timezone.now():
        expire_screen_sharing_data(capture.workspace_id)
        return JsonResponse({'error': 'Screenshot has expired.'}, status=404)
    if request.method == 'DELETE':
        capture_id_value = capture.id
        _audit(capture.workspace_id, request.user, 'screen_capture_deleted', 'screen_capture', capture.id, {'session_id': str(capture.session_id), 'captured_at': capture.captured_at.isoformat()})
        capture.delete()
        return JsonResponse({'deleted': str(capture_id_value)})
    download = request.GET.get('download', '').lower() in {'1', 'true', 'yes'}
    _audit(capture.workspace_id, request.user, 'screen_capture_downloaded' if download else 'screen_capture_viewed', 'screen_capture', capture.id, {'session_id': str(capture.session_id)})
    response = FileResponse(capture.image.open('rb'), content_type=capture.mime_type)
    extension = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}.get(capture.mime_type, 'img')
    response['Content-Disposition'] = f'{"attachment" if download else "inline"}; filename="screen-capture-{capture.captured_at:%Y%m%d-%H%M%S}.{extension}"'
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    return response
