import json
import mimetypes
from pathlib import Path

from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.utils.text import slugify
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import ensure_csrf_cookie

from .models import Membership, PlanBucket, UserProfile, Workspace, WorkspaceInvitation

AVATAR_MAX_BYTES = 5 * 1024 * 1024
AVATAR_ALLOWED_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.webp'}


def user_payload(user):
    profile = getattr(user, 'profile', None)
    return {
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'first_name': user.first_name,
        'last_name': user.last_name,
        'avatar_url': profile.avatar_url if profile else '',
        'presence': profile.presence if profile else 'available',
        'workspaces': [
            {'id': membership.workspace.id, 'name': membership.workspace.name, 'slug': membership.workspace.slug, 'role': membership.role}
            for membership in user.workspace_memberships.select_related('workspace').all()
        ],
        'pending_invitations': [
            {'id': invitation.id, 'workspace_id': invitation.workspace_id, 'workspace_name': invitation.workspace.name, 'role': invitation.role, 'created_at': invitation.created_at.isoformat()}
            for invitation in WorkspaceInvitation.objects.filter(email__iexact=user.email, status='pending').select_related('workspace')
        ],
    }


def parse_json(request):
    try:
        return json.loads(request.body or '{}'), None
    except json.JSONDecodeError:
        return None, JsonResponse({'error': 'Request body must be valid JSON.'}, status=400)


@ensure_csrf_cookie
@require_http_methods(['GET'])
def auth_csrf(request):
    return JsonResponse({'status': 'ok'})


@require_http_methods(['GET', 'POST'])
def auth_me(request):
    if request.method == 'GET':
        if not request.user.is_authenticated:
            return JsonResponse({'authenticated': False})
        return JsonResponse({'authenticated': True, 'user': user_payload(request.user)})

    payload, error = parse_json(request)
    if error:
        return error
    email = str(payload.get('email', '')).strip().lower()
    password = str(payload.get('password', ''))
    if not email or not password:
        return JsonResponse({'error': 'Email and password are required.'}, status=400)
    try:
        validate_email(email)
    except ValidationError:
        return JsonResponse({'error': 'Enter a valid email address.'}, status=400)
    try:
        validate_password(password, user=User(username=email, email=email))
    except ValidationError as validation_error:
        return JsonResponse({'error': validation_error.messages[0]}, status=400)
    if User.objects.filter(email__iexact=email).exists():
        return JsonResponse({'error': 'An account with this email already exists.'}, status=409)
    username = email
    workspace_name = str(payload.get('workspace_name', '')).strip() or 'My Workspace'
    if len(workspace_name) > 120:
        return JsonResponse({'error': 'Workspace name must be 120 characters or fewer.'}, status=400)
    first_name = str(payload.get('first_name', '')).strip()
    if len(first_name) > 150:
        return JsonResponse({'error': 'First name must be 150 characters or fewer.'}, status=400)
    with transaction.atomic():
        user = User.objects.create_user(username=username, email=email, password=password, first_name=first_name)
        workspace = Workspace.objects.create(name=workspace_name, slug=f'{slugify(workspace_name)}-{user.id}')
        Membership.objects.create(workspace=workspace, user=user, role='owner')
        PlanBucket.objects.create(workspace=workspace, name='Backlog', position=0)
    login(request, user)
    return JsonResponse({'authenticated': True, 'user': user_payload(user)}, status=201)


@require_http_methods(['POST'])
def auth_login(request):
    payload, error = parse_json(request)
    if error:
        return error
    email = str(payload.get('email', '')).strip().lower()
    password = str(payload.get('password', ''))
    user = authenticate(request, username=email, password=password)
    if user is None:
        return JsonResponse({'error': 'Invalid email or password.'}, status=401)
    login(request, user)
    return JsonResponse({'authenticated': True, 'user': user_payload(user)})


@require_http_methods(['POST'])
def auth_logout(request):
    logout(request)
    return JsonResponse({'authenticated': False})


@require_http_methods(['POST', 'DELETE'])
def user_avatar(request):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Authentication is required.'}, status=401)
    profile, _ = UserProfile.objects.get_or_create(user=request.user)
    if request.method == 'DELETE':
        profile.avatar.delete(save=False)
        profile.avatar = None
        profile.save(update_fields=['avatar', 'updated_at'])
        return JsonResponse({'avatar_url': ''})
    uploaded_file = request.FILES.get('avatar')
    if uploaded_file is None:
        return JsonResponse({'error': 'An image file is required.'}, status=400)
    if uploaded_file.size > AVATAR_MAX_BYTES:
        return JsonResponse({'error': 'Images must be 5 MB or smaller.'}, status=400)
    if Path(uploaded_file.name).suffix.lower() not in AVATAR_ALLOWED_EXTENSIONS:
        return JsonResponse({'error': 'Use a PNG, JPG, GIF, or WebP image.'}, status=400)
    profile.avatar.delete(save=False)
    profile.avatar = uploaded_file
    profile.save(update_fields=['avatar', 'updated_at'])
    return JsonResponse({'avatar_url': profile.avatar_url})


@require_http_methods(['GET'])
def user_avatar_download(request, user_id):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Authentication is required.'}, status=401)
    profile = UserProfile.objects.filter(user_id=user_id).first()
    if profile is None or not profile.avatar:
        return JsonResponse({'error': 'This user has no profile photo.'}, status=404)
    # Read the (small, size-capped) image into memory rather than streaming a FileResponse -
    # avoids the file handle outliving the response and blocking a same-request replace/delete.
    try:
        with profile.avatar.open('rb') as avatar_file:
            content = avatar_file.read()
    except FileNotFoundError:
        return JsonResponse({'error': 'Profile photo is unavailable.'}, status=404)
    content_type = mimetypes.guess_type(profile.avatar.name)[0] or 'application/octet-stream'
    response = HttpResponse(content, content_type=content_type)
    response['Cache-Control'] = 'private, max-age=300'
    return response


@require_http_methods(['PATCH'])
def user_presence(request):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Authentication is required.'}, status=401)
    payload, error = parse_json(request)
    if error:
        return error
    presence = payload.get('presence')
    if presence not in {choice[0] for choice in UserProfile.PRESENCE_CHOICES}:
        return JsonResponse({'error': 'Presence must be available, busy, away, or offline.'}, status=400)
    profile, _ = UserProfile.objects.get_or_create(user=request.user)
    profile.presence = presence
    profile.presence_updated_at = timezone.now()
    profile.save(update_fields=['presence', 'presence_updated_at', 'updated_at'])
    return JsonResponse({'presence': profile.presence})
