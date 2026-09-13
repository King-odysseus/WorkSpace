import json
import re
from datetime import date, timedelta

from django.contrib.auth.models import User
from django.test import RequestFactory
from django.utils import timezone

from .models import AiAction, Membership, Project, Task
from .views import task_detail, task_list, project_detail, project_list


ACTION_TTL = timedelta(minutes=20)
MAX_SNAPSHOT_TASKS = 80
MAX_SNAPSHOT_PROJECTS = 50

ACTION_FIELDS = {
    'task.create': {
        'title', 'description', 'status', 'priority', 'due_date', 'start_date',
        'project_id', 'assignee_ref', 'bucket', 'labels', 'progress_percent',
    },
    'task.update': {
        'task_id', 'title', 'description', 'status', 'priority', 'due_date',
        'start_date', 'project_id', 'assignee_ref', 'bucket', 'labels',
        'progress_percent', 'blocker_details',
    },
    'project.create': {'name', 'description', 'status', 'due_date', 'start_date', 'end_date'},
    'project.update': {'project_id', 'name', 'description', 'status', 'due_date', 'start_date', 'end_date'},
}

TASK_STATUSES = {'todo', 'in_progress', 'blocked', 'review', 'on_hold', 'cancelled', 'done'}
TASK_PRIORITIES = {'urgent', 'high', 'normal', 'low'}
PROJECT_STATUSES = {'planning', 'active', 'paused', 'completed'}

EMAIL_PATTERN = re.compile(r'(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+(?![\w-])')
INTERNATIONAL_PHONE_PATTERN = re.compile(r'(?<!\w)\+\d[\d\s().-]{7,}\d(?!\w)')
NORTH_AMERICAN_PHONE_PATTERN = re.compile(r'(?<!\w)\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\w)')
UK_PHONE_PATTERN = re.compile(r'(?<!\w)0\d{3,4}\s?\d{3,4}\s?\d{3,4}(?!\w)')
BARE_NUMBER_PATTERN = re.compile(r'(?<!\d)\d{10,15}(?!\d)')
SSN_PATTERN = re.compile(r'(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)')
NI_PATTERN = re.compile(r'\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{6}\s?[A-D]\b', re.IGNORECASE)
CARD_PATTERN = re.compile(r'(?<![\d-])(?:\d[ -]*?){13,19}(?![\d-])')
ADDRESS_PATTERN = re.compile(
    r'\b\d{1,5}\s+[A-Za-z0-9][A-Za-z0-9 .\'-]{2,60}\s+'
    r'(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|court|ct|way)\b',
    re.IGNORECASE,
)
PERSONAL_TOPIC_PATTERN = re.compile(
    r'\b(?:date of birth|d\.?o\.?b\.?|passport number|national insurance|social security|ssn)\b',
    re.IGNORECASE,
)


class PrivacyBoundaryError(ValueError):
    pass


class ActionValidationError(ValueError):
    pass


class ActionExecutionError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _looks_like_personal_data(value):
    text = str(value or '')
    if PERSONAL_TOPIC_PATTERN.search(text):
        return True
    if EMAIL_PATTERN.search(text) or SSN_PATTERN.search(text) or NI_PATTERN.search(text):
        return True
    if ADDRESS_PATTERN.search(text) or CARD_PATTERN.search(text):
        return True
    for pattern in (INTERNATIONAL_PHONE_PATTERN, NORTH_AMERICAN_PHONE_PATTERN, UK_PHONE_PATTERN, BARE_NUMBER_PATTERN):
        for match in pattern.finditer(text):
            candidate = match.group(0).strip()
            try:
                date.fromisoformat(candidate)
            except ValueError:
                return True
    return False


class PrivacyRegistry:
    """Maps workspace identities to provider-safe placeholders and back."""

    def __init__(self, workspace_id, actor):
        self.actor = actor
        self.placeholder_to_user_id = {}
        self.user_id_to_placeholder = {}
        # The assignable roster, exposed to the provider as placeholders only.
        # Built here rather than re-queried so it can never drift from the
        # placeholder mapping used to translate a name in and out.
        self.members = []
        replacements = []
        memberships = (
            Membership.objects
            .filter(workspace_id=workspace_id)
            .select_related('user')
            .order_by('id')
        )
        for index, membership in enumerate(memberships, start=1):
            user = membership.user
            placeholder = f'[MEMBER_{index}]'
            self.placeholder_to_user_id[placeholder] = user.id
            self.user_id_to_placeholder[user.id] = placeholder
            self.members.append({
                'ref': placeholder,
                'role': membership.role,
                'is_current_user': user.id == actor.id,
            })
            values = {
                user.get_full_name(),
                user.first_name,
                user.last_name,
                user.email,
                user.username,
            }
            if user.email and '@' in user.email:
                values.add(user.email.split('@', 1)[0])
            for value in values:
                value = str(value or '').strip()
                if len(value) >= 2:
                    replacements.append((value, placeholder))
        self.replacements = sorted(replacements, key=lambda item: len(item[0]), reverse=True)
        self.actor_ref = self.user_id_to_placeholder.get(actor.id, '[CURRENT_USER]')

    def protect(self, value):
        text = str(value or '')
        for identity, placeholder in self.replacements:
            text = re.sub(
                rf'(?<!\w){re.escape(identity)}(?!\w)',
                placeholder,
                text,
                flags=re.IGNORECASE,
            )
        if _looks_like_personal_data(text):
            raise PrivacyBoundaryError(
                'Zuri blocked this request because it contains personal information that cannot leave the workspace.'
            )
        return text

    def user_id_for_ref(self, value):
        ref = str(value or '').strip()
        if ref in {'', 'none', 'unassigned', 'no one'}:
            return None
        if ref in {'me', 'current_user', self.actor_ref}:
            return self.actor.id
        if ref in self.placeholder_to_user_id:
            return self.placeholder_to_user_id[ref]
        raise ActionValidationError('Choose a workspace member by name, "me", or "unassigned".')

    def expand(self, value):
        text = str(value or '')
        for placeholder, user_id in self.placeholder_to_user_id.items():
            user = User.objects.filter(id=user_id).only('first_name', 'last_name', 'email').first()
            if user is not None:
                text = text.replace(placeholder, user.get_full_name() or user.email)
        return text


def build_workspace_snapshot(workspace_id, actor, registry):
    """Build the small, non-identifying workspace view sent to the provider."""

    tasks = (
        Task.objects
        .filter(workspace_id=workspace_id)
        .exclude(state='archived')
        .select_related('assignee', 'project_ref')
        .order_by('-updated_at')[:MAX_SNAPSHOT_TASKS]
    )
    task_rows = []
    for task in tasks:
        task_rows.append({
            'id': task.id,
            'code': task.code,
            'title': registry.protect(task.title),
            'status': task.status,
            'priority': task.priority,
            'due_date': task.due_date.isoformat() if task.due_date else None,
            'project_id': task.project_ref_id,
            'project': registry.protect(task.project_ref.name if task.project_ref else task.project),
            'assignee_ref': registry.user_id_to_placeholder.get(task.assignee_id) if task.assignee_id else None,
            'progress_percent': task.progress_percent,
            'bucket': registry.protect(task.bucket),
            'labels': [registry.protect(label) for label in (task.labels or [])],
        })

    projects = Project.objects.filter(workspace_id=workspace_id).order_by('name')[:MAX_SNAPSHOT_PROJECTS]
    project_rows = []
    for project in projects:
        project_rows.append({
            'id': project.id,
            'name': registry.protect(project.name),
            'status': project.status,
            'due_date': project.due_date.isoformat() if project.due_date else None,
            'start_date': project.start_date.isoformat() if project.start_date else None,
            'end_date': project.end_date.isoformat() if project.end_date else None,
        })

    return {
        'actor_ref': registry.actor_ref,
        'task_count': Task.objects.filter(workspace_id=workspace_id).exclude(state='archived').count(),
        'project_count': Project.objects.filter(workspace_id=workspace_id).count(),
        'members': registry.members,
        'tasks': task_rows,
        'projects': project_rows,
        'limits': {'tasks': MAX_SNAPSHOT_TASKS, 'projects': MAX_SNAPSHOT_PROJECTS},
    }


def action_instructions(snapshot):
    return (
        'You can help with workspace tasks and projects. Reads are answered directly from the snapshot. '
        'For a create or update request, return strict JSON with an "answer" string and an "action" object. '
        'For normal conversation, return strict JSON with "answer" and "action": null. '
        'Allowed action kinds are task.create, task.update, project.create, and project.update. '
        'Never claim an action has happened: it only becomes a proposal that the user must confirm. '
        'Never use external personal data. Real names never leave the workspace: people appear as placeholders such as [MEMBER_2], '
        'listed in the snapshot "members" roster with their workspace role and whether they are the current user. '
        'To assign work, set assignee_ref to a ref from that roster, or "me" for the current user, or "unassigned". '
        'Never invent a ref that is not in the roster. '
        'The action fields are: task.create uses title, description, status, priority, due_date, start_date, project_id, assignee_ref, bucket, labels, progress_percent; '
        'task.update uses task_id plus any of those fields; project.create uses name, description, status, due_date, start_date, end_date; '
        'project.update uses project_id plus any project field. Do not propose deletes, comments, documents, invitations, budgets, expenses, or personal data. '
        f'Workspace snapshot: {json.dumps(snapshot, separators=(",", ":"))}'
    )


def parse_provider_response(content, registry):
    """Accept plain text for compatibility, but validate any structured action."""

    text = str(content or '').strip()
    if not text:
        return {'answer': 'Zuri returned an empty response.', 'action': None}
    candidate = text
    if candidate.startswith('```'):
        candidate = re.sub(r'^```(?:json)?\s*|\s*```$', '', candidate, flags=re.IGNORECASE)
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        start = candidate.find('{')
        end = candidate.rfind('}')
        if start < 0 or end <= start:
            return {'answer': text, 'action': None}
        try:
            parsed = json.loads(candidate[start:end + 1])
        except json.JSONDecodeError:
            return {'answer': text, 'action': None}
    if not isinstance(parsed, dict):
        return {'answer': text, 'action': None}
    answer = str(parsed.get('answer') or '').strip() or 'I prepared a workspace action for your confirmation.'
    action = parsed.get('action')
    if action is None:
        return {'answer': registry.expand(answer), 'action': None}
    return {'answer': registry.expand(answer), 'action': action}


def _clean_string(value, registry, field, max_length):
    text = registry.protect(str(value or '').strip())
    if len(text) > max_length:
        raise ActionValidationError(f'{field.replace("_", " ").title()} is too long.')
    return text


def _validate_action(action, registry, workspace_id, actor):
    if not isinstance(action, dict):
        raise ActionValidationError('The proposed action is malformed.')
    kind = str(action.get('kind') or '').strip()
    if kind not in ACTION_FIELDS:
        raise ActionValidationError('That workspace action is not supported.')
    arguments = action.get('arguments') or {}
    if not isinstance(arguments, dict):
        raise ActionValidationError('The proposed action arguments are malformed.')
    unknown = set(arguments) - ACTION_FIELDS[kind]
    if unknown:
        raise ActionValidationError(f'Unsupported action fields: {", ".join(sorted(unknown))}.')

    cleaned = {}
    for field, value in arguments.items():
        if field == 'task_id' or field == 'project_id':
            if value in ('', None):
                cleaned[field] = None
            elif isinstance(value, bool) or not isinstance(value, int):
                raise ActionValidationError(f'{field.replace("_", " ").title()} must be an integer.')
            else:
                cleaned[field] = value
        elif field == 'progress_percent':
            try:
                progress = int(value)
            except (TypeError, ValueError):
                raise ActionValidationError('Progress must be a whole number between 0 and 100.')
            if not 0 <= progress <= 100:
                raise ActionValidationError('Progress must be a whole number between 0 and 100.')
            cleaned[field] = progress
        elif field == 'labels':
            if not isinstance(value, list) or len(value) > 20:
                raise ActionValidationError('Labels must be a list of up to 20 values.')
            cleaned[field] = [_clean_string(label, registry, 'label', 40) for label in value]
        elif field == 'assignee_ref':
            cleaned[field] = str(value or '').strip()
            registry.user_id_for_ref(cleaned[field])
        elif field in {'title', 'name'}:
            cleaned[field] = _clean_string(value, registry, field, 200 if field == 'title' else 160)
            if not cleaned[field]:
                raise ActionValidationError(f'{field.title()} is required.')
        elif field in {'description', 'blocker_details'}:
            cleaned[field] = _clean_string(value, registry, field, 4000)
        elif field == 'due_date' or field == 'start_date' or field == 'end_date':
            date_value = str(value or '').strip()
            if date_value:
                try:
                    date.fromisoformat(date_value)
                except ValueError:
                    raise ActionValidationError(f'{field.replace("_", " ").title()} must use YYYY-MM-DD format.')
            cleaned[field] = date_value or None
        elif field == 'status':
            status = str(value or '').strip()
            allowed = TASK_STATUSES if kind.startswith('task.') else PROJECT_STATUSES
            if status not in allowed:
                raise ActionValidationError('The proposed status is invalid.')
            cleaned[field] = status
        elif field == 'priority':
            priority = str(value or '').strip()
            if priority not in TASK_PRIORITIES:
                raise ActionValidationError('The proposed priority is invalid.')
            cleaned[field] = priority
        elif field == 'bucket':
            cleaned[field] = _clean_string(value, registry, field, 80)
            if not cleaned[field]:
                raise ActionValidationError('Bucket is required.')
        else:
            raise ActionValidationError(f'Unsupported action field: {field}.')

    if kind == 'task.create' and not cleaned.get('title'):
        raise ActionValidationError('Task title is required.')
    if kind == 'task.update':
        if not cleaned.get('task_id'):
            raise ActionValidationError('Task is required.')
        if not (set(cleaned) - {'task_id'}):
            raise ActionValidationError('Choose at least one task field to update.')
    if kind == 'project.create' and not cleaned.get('name'):
        raise ActionValidationError('Project name is required.')
    if kind == 'project.update':
        if not cleaned.get('project_id'):
            raise ActionValidationError('Project is required.')
        if not (set(cleaned) - {'project_id'}):
            raise ActionValidationError('Choose at least one project field to update.')

    membership = Membership.objects.filter(workspace_id=workspace_id, user=actor).first()
    if membership is None:
        raise ActionValidationError('You do not belong to this workspace.')
    if kind == 'task.create':
        if not membership.has_permission('create_tasks'):
            raise ActionValidationError('You do not have permission to create tasks.')
        if 'project_id' in cleaned and not membership.has_permission('edit_team_tasks'):
            raise ActionValidationError('You do not have permission to set a task project.')
        if 'assignee_ref' in cleaned and not membership.has_permission('assign_tasks'):
            raise ActionValidationError('You do not have permission to assign tasks.')
    elif kind == 'task.update':
        task_id = cleaned.get('task_id')
        task = Task.objects.filter(id=task_id, workspace_id=workspace_id).first() if task_id else None
        if task is None:
            raise ActionValidationError('Task was not found in this workspace.')
        if not membership.has_permission('edit_team_tasks'):
            if task.assignee_id != actor.id or not membership.has_permission('edit_own_tasks'):
                raise ActionValidationError('You can only update tasks assigned to you.')
            if {'project_id', 'assignee_ref'} & set(cleaned):
                raise ActionValidationError('You do not have permission to change task ownership or project.')
        if 'assignee_ref' in cleaned and not membership.has_permission('assign_tasks'):
            raise ActionValidationError('You do not have permission to assign tasks.')
    elif kind == 'project.create' and not membership.has_permission('create_projects'):
        raise ActionValidationError('You do not have permission to create projects.')
    elif kind == 'project.update':
        if not membership.has_permission('manage_projects'):
            raise ActionValidationError('You do not have permission to update projects.')
        project_id = cleaned.get('project_id')
        if not project_id or not Project.objects.filter(id=project_id, workspace_id=workspace_id).exists():
            raise ActionValidationError('Project was not found in this workspace.')
    return kind, cleaned


def _action_payload(kind, arguments, registry):
    payload = dict(arguments)
    if kind in {'task.create', 'task.update'} and 'assignee_ref' in payload:
        payload['assignee_id'] = registry.user_id_for_ref(payload.pop('assignee_ref'))
    for field, value in list(payload.items()):
        if isinstance(value, str):
            payload[field] = registry.expand(value)
        elif isinstance(value, list):
            payload[field] = [registry.expand(item) if isinstance(item, str) else item for item in value]
    return payload


def _action_summary(kind, payload, registry):
    if kind == 'task.create':
        detail = registry.expand(payload.get('title') or 'Untitled task')
        return f'Create task "{detail}"'
    if kind == 'task.update':
        task = Task.objects.filter(id=payload.get('task_id')).only('title').first()
        fields = sorted(field for field in payload if field != 'task_id')
        labels = ', '.join(field.replace('_', ' ') for field in fields)
        return f'Update task "{registry.expand(task.title if task else "Unknown task")}" ({labels})'
    if kind == 'project.create':
        return f'Create project "{registry.expand(payload.get("name") or "Untitled project")}"'
    project = Project.objects.filter(id=payload.get('project_id')).only('name').first()
    fields = sorted(field for field in payload if field != 'project_id')
    labels = ', '.join(field.replace('_', ' ') for field in fields)
    return f'Update project "{registry.expand(project.name if project else "Unknown project")}" ({labels})'


def create_action_proposal(action, registry, workspace_id, actor):
    kind, arguments = _validate_action(action, registry, workspace_id, actor)
    payload = _action_payload(kind, arguments, registry)
    proposal = AiAction.objects.create(
        workspace_id=workspace_id,
        requested_by=actor,
        kind=kind,
        payload=payload,
        summary=_action_summary(kind, payload, registry),
        expires_at=timezone.now() + ACTION_TTL,
    )
    return proposal


def _call_view(view, request, **kwargs):
    try:
        response = view(request, **kwargs)
    except Exception as exc:
        raise ActionExecutionError(str(exc), getattr(exc, 'status_code', 500)) from exc
    body = json.loads(response.content.decode() or '{}')
    if response.status_code >= 400:
        raise ActionExecutionError(body.get('error') or 'The workspace action could not be completed.', response.status_code)
    return body


def execute_action(action, actor):
    factory = RequestFactory()
    if action.kind == 'task.create':
        request = factory.post('/api/tasks/', data=json.dumps(action.payload), content_type='application/json')
        request.user = actor
        return _call_view(task_list, request, workspace_id=action.workspace_id)
    if action.kind == 'task.update':
        task_id = action.payload.get('task_id')
        payload = {key: value for key, value in action.payload.items() if key != 'task_id'}
        request = factory.patch(f'/api/tasks/{task_id}/', data=json.dumps(payload), content_type='application/json')
        request.user = actor
        return _call_view(task_detail, request, task_id=task_id)
    if action.kind == 'project.create':
        request = factory.post('/api/projects/', data=json.dumps(action.payload), content_type='application/json')
        request.user = actor
        return _call_view(project_list, request, workspace_id=action.workspace_id)
    project_id = action.payload.get('project_id')
    payload = {key: value for key, value in action.payload.items() if key != 'project_id'}
    request = factory.patch(f'/api/projects/{project_id}/', data=json.dumps(payload), content_type='application/json')
    request.user = actor
    return _call_view(project_detail, request, workspace_id=action.workspace_id, project_id=project_id)
