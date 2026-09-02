import json

from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.http import JsonResponse
from django.utils.text import slugify
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import ensure_csrf_cookie

from .models import Membership, Workspace, WorkspaceInvitation


def user_payload(user):
    return {
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'first_name': user.first_name,
        'last_name': user.last_name,
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
