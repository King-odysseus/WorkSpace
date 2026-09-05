import json
import mimetypes
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from axes.handlers.proxy import AxesProxyHandler
from django.conf import settings
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

from .models import Membership, PlanBucket, PushSubscription, UserProfile, Workspace, WorkspaceInvitation

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
    login(request, user, backend='django.contrib.auth.backends.ModelBackend')
    return JsonResponse({'authenticated': True, 'user': user_payload(user)}, status=201)


@require_http_methods(['POST'])
def auth_login(request):
    payload, error = parse_json(request)
    if error:
        return error
    email = str(payload.get('email', '')).strip().lower()
    password = str(payload.get('password', ''))
    # django-axes would refuse a locked-out attempt inside authenticate() anyway,
    # but that surfaces as a plain "invalid credentials" 401. Checking first lets a
    # locked-out user be told to wait rather than left guessing at their password.
    if not AxesProxyHandler.is_allowed(request, {'username': email}):
        return JsonResponse({'error': 'Too many failed sign-in attempts. Try again later.'}, status=429)
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


@require_http_methods(['PATCH'])
def user_profile(request):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Authentication is required.'}, status=401)
    payload, error = parse_json(request)
    if error:
        return error
    first_name = str(payload.get('first_name', request.user.first_name)).strip()
    last_name = str(payload.get('last_name', request.user.last_name)).strip()
    email = str(payload.get('email', request.user.email)).strip().lower()
    if len(first_name) > 150 or len(last_name) > 150:
        return JsonResponse({'error': 'Names must be 150 characters or fewer.'}, status=400)
    try:
        validate_email(email)
    except ValidationError:
        return JsonResponse({'error': 'Enter a valid email address.'}, status=400)
    if User.objects.filter(email__iexact=email).exclude(pk=request.user.pk).exists():
        return JsonResponse({'error': 'That email address is already in use.'}, status=409)
    request.user.first_name = first_name
    request.user.last_name = last_name
    request.user.email = email
    request.user.username = email
    request.user.save(update_fields=['first_name', 'last_name', 'email', 'username'])
    return JsonResponse({'user': user_payload(request.user)})


@require_http_methods(['POST'])
def auth_google(request):
    if not settings.GOOGLE_OAUTH_CLIENT_ID:
        return JsonResponse({'error': 'Google sign-in is not configured.'}, status=503)
    payload, error = parse_json(request)
    if error:
        return error
    credential = str(payload.get('credential', '')).strip()
    if not credential:
        return JsonResponse({'error': 'A Google credential is required.'}, status=400)
    try:
        query = urllib.parse.urlencode({'id_token': credential})
        with urllib.request.urlopen(f'https://oauth2.googleapis.com/tokeninfo?{query}', timeout=5) as response:
            token_info = json.loads(response.read())
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError):
        return JsonResponse({'error': 'Google sign-in could not be verified.'}, status=401)
    if token_info.get('aud') != settings.GOOGLE_OAUTH_CLIENT_ID:
        return JsonResponse({'error': 'Google sign-in could not be verified.'}, status=401)
    email = str(token_info.get('email', '')).strip().lower()
    if not email or token_info.get('email_verified') not in ('true', True):
        return JsonResponse({'error': 'Your Google account has no verified email address.'}, status=401)
    user = User.objects.filter(email__iexact=email).first()
    if user is None:
        first_name = str(token_info.get('given_name', '')).strip()[:150]
        last_name = str(token_info.get('family_name', '')).strip()[:150]
        workspace_name = str(payload.get('workspace_name', '')).strip() or 'My Workspace'
        with transaction.atomic():
            user = User.objects.create_user(username=email, email=email, first_name=first_name, last_name=last_name)
            user.set_unusable_password()
            user.save(update_fields=['password'])
            workspace = Workspace.objects.create(name=workspace_name, slug=f'{slugify(workspace_name)}-{user.id}')
            Membership.objects.create(workspace=workspace, user=user, role='owner')
            PlanBucket.objects.create(workspace=workspace, name='Backlog', position=0)
    login(request, user, backend='django.contrib.auth.backends.ModelBackend')
    return JsonResponse({'authenticated': True, 'user': user_payload(user)})


@require_http_methods(['GET'])
def push_public_key(request):
    return JsonResponse({'public_key': settings.VAPID_PUBLIC_KEY, 'configured': settings.WEB_PUSH_CONFIGURED})


@require_http_methods(['POST', 'DELETE'])
def push_subscription_list(request):
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Authentication is required.'}, status=401)
    payload, error = parse_json(request)
    if error:
        return error
    endpoint = str(payload.get('endpoint', '')).strip()
    if not endpoint:
        return JsonResponse({'error': 'A push endpoint is required.'}, status=400)
    if request.method == 'DELETE':
        PushSubscription.objects.filter(user=request.user, endpoint=endpoint).delete()
        return JsonResponse({'removed': True})
    keys = payload.get('keys') or {}
    p256dh = str(keys.get('p256dh', '')).strip()
    auth = str(keys.get('auth', '')).strip()
    if not p256dh or not auth:
        return JsonResponse({'error': 'Push subscription keys are required.'}, status=400)
    subscription, _ = PushSubscription.objects.update_or_create(
        endpoint=endpoint,
        defaults={'user': request.user, 'p256dh': p256dh, 'auth': auth},
    )
    return JsonResponse({'subscription': subscription.as_dict()}, status=201)
