"""Authenticated HTTP adapters for reporting, integrity, automation, and Excel import."""

import hashlib
import csv
import io
import json
from datetime import date, timedelta
from zipfile import BadZipFile

from django.core.exceptions import ValidationError
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST
from openpyxl.utils.exceptions import InvalidFileException

from .models import AuditLog, ImportRun, Project
from .views import require_workspace_leader, require_workspace_member


REPORT_SCOPES = {'all', 'operations', 'project'}
REPORT_PERIODS = {'all', 'week', 'month', 'custom'}
REPORT_FILTER_FIELDS = {'status', 'priority', 'assignee_id', 'bucket', 'project_id', 'workstream', 'phase', 'state', 'stale', 'due', 'search'}
IMPORT_MAX_BYTES = 20 * 1024 * 1024


def _parse_date(value, label):
    if not value:
        return None, None
    try:
        return date.fromisoformat(value), None
    except (TypeError, ValueError):
        return None, JsonResponse({'error': f'{label} must use YYYY-MM-DD format.'}, status=400)


@require_GET
def workspace_report(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    from .reporting import build_report

    scope = request.GET.get('scope', 'all')
    period = request.GET.get('period', 'all')
    if scope not in REPORT_SCOPES:
        return JsonResponse({'error': 'scope must be all, operations, or project.'}, status=400)
    if period not in REPORT_PERIODS:
        return JsonResponse({'error': 'period must be all, week, month, or custom.'}, status=400)
    project_id = request.GET.get('project_id')
    if scope == 'project':
        try:
            project_id = int(project_id)
        except (TypeError, ValueError):
            return JsonResponse({'error': 'project_id is required for project scope.'}, status=400)
        if not Project.objects.filter(id=project_id, workspace_id=workspace_id).exists():
            return JsonResponse({'error': 'Project was not found in this workspace.'}, status=404)
    else:
        project_id = None
    start, error = _parse_date(request.GET.get('start'), 'start')
    if error:
        return error
    end, error = _parse_date(request.GET.get('end'), 'end')
    if error:
        return error
    if period == 'custom' and (start is None or end is None):
        return JsonResponse({'error': 'start and end are required for a custom period.'}, status=400)
    if start and end and start > end:
        return JsonResponse({'error': 'start cannot be after end.'}, status=400)
    try:
        task_filter = json.loads(request.GET.get('filter', '{}'))
    except json.JSONDecodeError:
        return JsonResponse({'error': 'filter must be a JSON object.'}, status=400)
    if not isinstance(task_filter, dict):
        return JsonResponse({'error': 'filter must be a JSON object.'}, status=400)
    unknown_filters = set(task_filter) - REPORT_FILTER_FIELDS
    if unknown_filters:
        return JsonResponse({'error': f'Unsupported report filters: {", ".join(sorted(unknown_filters))}.'}, status=400)
    for key in ('assignee_id', 'project_id'):
        if key in task_filter and task_filter[key] is not None:
            try:
                task_filter[key] = int(task_filter[key])
            except (TypeError, ValueError):
                return JsonResponse({'error': f'{key} must be an integer or null.'}, status=400)
    if 'stale' in task_filter and not isinstance(task_filter['stale'], bool):
        return JsonResponse({'error': 'stale must be a boolean.'}, status=400)
    if task_filter.get('due') and task_filter['due'] not in {'overdue', 'today', 'soon', 'none'}:
        return JsonResponse({'error': 'due must be overdue, today, soon, or none.'}, status=400)
    report = build_report(workspace_id, scope=scope, project_id=project_id, period=period, period_start=start, period_end=end, task_filter=task_filter)
    return JsonResponse({'report': report})


@require_GET
def project_health_report(request, workspace_id):
    _, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    try:
        project_id = int(request.GET.get('project_id'))
    except (TypeError, ValueError):
        return JsonResponse({'error': 'project_id is required.'}, status=400)
    project = Project.objects.filter(id=project_id, workspace_id=workspace_id).first()
    if project is None:
        return JsonResponse({'error': 'Project was not found in this workspace.'}, status=404)
    from .reporting import project_health
    return JsonResponse({'health': project_health(workspace_id, project)})


@require_GET
def workspace_integrity(request, workspace_id):
    _, error = require_workspace_leader(request, workspace_id)
    if error:
        return error
    from .integrity import run_integrity_checks
    return JsonResponse({'checks': run_integrity_checks(workspace_id)})


@require_POST
def workspace_automation_run(request, workspace_id):
    _, error = require_workspace_leader(request, workspace_id)
    if error:
        return error
    from .automation import run_workspace_automation
    counts = run_workspace_automation(workspace_id)
    AuditLog.objects.create(workspace_id=workspace_id, actor=request.user, action='workspace_automation_run', target_type='workspace', target_id=str(workspace_id), details={'deliveries': counts})
    return JsonResponse({'deliveries': counts})


def _workbook_request(request, import_type='tasks'):
    uploaded = request.FILES.get('workbook') or request.FILES.get('file')
    if uploaded is None:
        return None, None, None, JsonResponse({'error': 'A workbook file is required.'}, status=400)
    if uploaded.size > IMPORT_MAX_BYTES:
        return None, None, None, JsonResponse({'error': 'Workbook must be no larger than 20 MB.'}, status=400)
    if not (uploaded.name.lower().endswith('.xlsx') or uploaded.name.lower().endswith('.csv')):
        return None, None, None, JsonResponse({'error': 'Import files must use .xlsx or .csv format.'}, status=400)
    content = uploaded.read()
    uploaded.seek(0)
    if uploaded.name.lower().endswith('.csv') and import_type == 'tasks':
        from openpyxl import Workbook
        try:
            reader = csv.DictReader(io.StringIO(content.decode('utf-8-sig')))
            rows = list(reader)
        except (UnicodeDecodeError, csv.Error) as exc:
            return None, None, None, JsonResponse({'error': f'CSV could not be read: {exc}'}, status=400)
        workbook = Workbook()
        workbook.active.title = 'General'
        headers = reader.fieldnames or []
        workbook.active.append(headers)
        for row in rows:
            workbook.active.append([row.get(header, '') for header in headers])
        output = io.BytesIO()
        workbook.save(output)
        output.seek(0)
        output.name = uploaded.name
        uploaded = output
    uploaded._raw_content = content
    checksum = hashlib.sha256(content).hexdigest()
    column_map = None
    if request.POST.get('column_map'):
        try:
            column_map = json.loads(request.POST['column_map'])
        except json.JSONDecodeError:
            return None, None, None, JsonResponse({'error': 'column_map must be valid JSON.'}, status=400)
        if not isinstance(column_map, dict) or not all(isinstance(key, str) and isinstance(value, str) for key, value in column_map.items()):
            return None, None, None, JsonResponse({'error': 'column_map must be an object of column names.'}, status=400)
    return uploaded, checksum, column_map, None


def _public_import_plan(plan, checksum):
    rows = []
    for item in plan.get('normalized', []):
        rows.append({
            'row': item['row'], 'action': item['action'], 'existing_task_id': item['existing_task_id'],
            'code': item['code'], 'title': item['title'], 'status': item['status'], 'priority': item['priority'],
            'assignee_id': item['assignee'].id if item['assignee'] else None,
            'assignee_name': (item['assignee'].get_full_name() or item['assignee'].email) if item['assignee'] else None,
            'supporter_ids': [user.id for user in item['supporters']],
            'project_id': item['project_ref'].id if item['project_ref'] else None,
            'project_name': item['project_ref'].name if item['project_ref'] else None,
            'start_date': item['start_date'].isoformat() if item['start_date'] else None,
            'due_date': item['due_date'].isoformat() if item['due_date'] else None,
        })
    return {
        'checksum': checksum, 'source': plan.get('source', ''), 'summary': plan.get('summary', {}),
        'exceptions': plan.get('exceptions', []), 'invitations': plan.get('invitations', []),
        'lists': plan.get('lists', {}), 'rows': rows,
    }


def _public_workspace_plan(plan, checksum):
    return {'checksum': checksum, 'source': plan.get('source', ''), 'kind': plan.get('kind'), 'summary': plan.get('summary', {}), 'exceptions': plan.get('exceptions', []), 'rows': [{key: (value.isoformat() if hasattr(value, 'isoformat') else value) for key, value in item.items() if key not in {'existing_id'}} | {'existing_id': item.get('existing_id')} for item in plan.get('normalized', [])]}


@require_POST
def import_preview(request, workspace_id):
    membership, error = require_workspace_member(request, workspace_id)
    if error:
        return error
    import_type = request.POST.get('import_type', 'tasks').strip().lower()
    if import_type not in {'tasks', 'projects', 'stakeholders'}:
        return JsonResponse({'error': 'import_type must be tasks, projects, or stakeholders.'}, status=400)
    workbook, checksum, column_map, error = _workbook_request(request, import_type)
    if error:
        return error
    from .importer import build_import_plan
    try:
        if import_type == 'tasks':
            plan = build_import_plan(membership.workspace, workbook, column_map=column_map)
        elif import_type == 'projects':
            from .workspace_imports import build_project_plan
            plan = build_project_plan(membership.workspace, workbook._raw_content, workbook.name, column_map=column_map)
        else:
            from .workspace_imports import build_stakeholder_plan
            plan = build_stakeholder_plan(membership.workspace, workbook._raw_content, workbook.name, column_map=column_map)
    except (OSError, ValueError, KeyError, BadZipFile, InvalidFileException) as exc:
        return JsonResponse({'error': f'Workbook could not be read: {exc}'}, status=400)
    if plan.get('error'):
        return JsonResponse({'error': plan['error']}, status=400)
    preview = _public_import_plan(plan, checksum) if import_type == 'tasks' else _public_workspace_plan(plan, checksum)
    run = ImportRun.objects.create(
        workspace=membership.workspace, actor=request.user, mode='preview', source=workbook.name,
        summary={'plan': plan.get('summary', {}), 'preview_checksum': checksum, 'column_map': column_map, 'kind': import_type},
        exceptions=plan.get('exceptions', []),
    )
    preview['preview_id'] = run.id
    return JsonResponse({'preview': preview})


@require_POST
def import_commit(request, workspace_id):
    membership, error = require_workspace_leader(request, workspace_id)
    if error:
        return error
    import_type = request.POST.get('import_type', 'tasks').strip().lower()
    if import_type not in {'tasks', 'projects', 'stakeholders'}:
        return JsonResponse({'error': 'import_type must be tasks, projects, or stakeholders.'}, status=400)
    workbook, checksum, column_map, error = _workbook_request(request, import_type)
    if error:
        return error
    expected_checksum = request.POST.get('preview_checksum', '').strip().lower()
    if not expected_checksum or expected_checksum != checksum:
        return JsonResponse({'error': 'This exact workbook must be previewed before commit; provide its preview_checksum.'}, status=409)
    try:
        preview_id = int(request.POST.get('preview_id'))
    except (TypeError, ValueError):
        return JsonResponse({'error': 'A recent preview_id is required before commit.'}, status=409)
    from .importer import build_import_plan, commit_import_plan
    try:
        with transaction.atomic():
            preview_run = ImportRun.objects.select_for_update().filter(
                id=preview_id, workspace_id=workspace_id, mode='preview',
                created_at__gte=timezone.now() - timedelta(hours=1),
            ).first()
            preview_summary = preview_run.summary if preview_run else {}
            if (
                preview_run is None or preview_summary.get('preview_checksum') != checksum
                or preview_summary.get('column_map') != column_map or preview_summary.get('kind') != import_type or preview_summary.get('committed_at')
            ):
                return JsonResponse({'error': 'The preview is missing, expired, already committed, or does not match this import.'}, status=409)
            if import_type == 'tasks':
                plan = build_import_plan(membership.workspace, workbook, column_map=column_map)
            elif import_type == 'projects':
                from .workspace_imports import build_project_plan
                plan = build_project_plan(membership.workspace, workbook._raw_content, workbook.name, column_map=column_map)
            else:
                from .workspace_imports import build_stakeholder_plan
                plan = build_stakeholder_plan(membership.workspace, workbook._raw_content, workbook.name, column_map=column_map)
            if plan.get('error'):
                return JsonResponse({'error': plan['error']}, status=400)
            if plan.get('summary', {}) != preview_summary.get('plan', {}):
                return JsonResponse({'error': 'Workspace data changed after preview. Preview the workbook again before committing.'}, status=409)
            if import_type == 'tasks':
                result = commit_import_plan(membership.workspace, request.user, plan)
            elif import_type == 'projects':
                from .workspace_imports import commit_project_plan
                result = commit_project_plan(membership.workspace, request.user, plan)
            else:
                from .workspace_imports import commit_stakeholder_plan
                result = commit_stakeholder_plan(membership.workspace, request.user, plan)
            preview_run.summary = {**preview_summary, 'committed_at': timezone.now().isoformat()}
            preview_run.save(update_fields=['summary'])
            AuditLog.objects.create(workspace_id=workspace_id, actor=request.user, action='excel_import_committed', target_type='workspace', target_id=str(workspace_id), details={'checksum': checksum, 'result': result})
    except ValidationError as exc:
        return JsonResponse({'error': exc.message_dict if hasattr(exc, 'message_dict') else exc.messages}, status=400)
    except (OSError, ValueError, KeyError, BadZipFile, InvalidFileException) as exc:
        return JsonResponse({'error': f'Workbook could not be committed: {exc}'}, status=400)
    return JsonResponse({'result': result})
