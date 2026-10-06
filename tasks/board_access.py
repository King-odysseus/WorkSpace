"""Who can see and edit which board.

A board is a project or an operations workstream. Each belongs to the people an
owner or manager add to it, and only they see its tasks. Owners and managers see
every board; the one thing they do not see is a private board, which belongs to
the person who made it alone. Work that sits on no board at all is the
workspace's own and stays visible to everyone in it.

Everything that reads tasks, boards or buckets for a person goes through here,
so the rule lives in one place instead of in each queryset that has to remember
it.
"""

from django.db.models import Q

from .models import LookupValue, PlanBucket, Project, Task, TaskAssignee, TaskSupporter

LEADER_ROLES = {'owner', 'manager'}


def is_leader(membership):
    return membership is not None and membership.role in LEADER_ROLES


def visible_projects(workspace_id, user, membership):
    """The projects this person may see, as a queryset."""
    projects = Project.objects.filter(workspace_id=workspace_id)
    own = Q(created_by_id=user.id)
    if is_leader(membership):
        return projects.filter(Q(is_private=False) | own)
    member_of = Project.members.through.objects.filter(user_id=user.id).values('project_id')
    return projects.filter(Q(is_private=False, id__in=member_of) | own)


def visible_workstreams(workspace_id, user, membership):
    """The operations workstreams this person may see, as a queryset.

    A workstream that belongs to a project is part of that project's board, so it
    is visible when the project is.
    """
    streams = LookupValue.objects.filter(workspace_id=workspace_id, kind='workstream')
    own = Q(created_by_id=user.id)
    projects = visible_projects(workspace_id, user, membership).values('id')
    inherited = Q(project__isnull=False, project_id__in=projects)
    if is_leader(membership):
        top = Q(project__isnull=True, is_private=False)
    else:
        member_of = LookupValue.members.through.objects.filter(user_id=user.id).values('lookupvalue_id')
        top = Q(project__isnull=True, is_private=False, id__in=member_of)
    return streams.filter(top | inherited | own)


def task_visibility_q(workspace_id, user, membership):
    """A filter that keeps the tasks this person may see.

    Tasks on no board are everyone's. A task assigned to the person, or that they
    support, stays visible to them even if it sits on a board they were taken off,
    so work given to someone never vanishes from their own list.
    """
    projects = visible_projects(workspace_id, user, membership).values('id')
    streams = visible_workstreams(workspace_id, user, membership).values('id')
    unscoped = Q(project_ref__isnull=True, workstream_ref__isnull=True)
    on_project = Q(project_ref_id__in=projects)
    on_workstream = Q(project_ref__isnull=True, workstream_ref_id__in=streams)
    mine = (
        Q(assignee_id=user.id)
        | Q(id__in=TaskAssignee.objects.filter(user_id=user.id).values('task_id'))
        | Q(id__in=TaskSupporter.objects.filter(user_id=user.id).values('task_id'))
    )
    return unscoped | on_project | on_workstream | mine


def visible_tasks(tasks, workspace_id, user, membership):
    return tasks.filter(task_visibility_q(workspace_id, user, membership))


def task_is_visible(task, user, membership=None):
    """Whether one task may be seen, for the endpoints that fetch it by id."""
    if membership is None:
        from .models import Membership
        membership = Membership.objects.filter(workspace_id=task.workspace_id, user=user).first()
    if membership is None:
        return False
    return Task.objects.filter(id=task.id).filter(task_visibility_q(task.workspace_id, user, membership)).exists()


def visible_buckets(buckets, workspace_id, user, membership):
    """Keep the buckets of boards this person may see, and the workspace-wide ones."""
    projects = visible_projects(workspace_id, user, membership).values('id')
    streams = visible_workstreams(workspace_id, user, membership).values('id')
    return buckets.filter(
        Q(project__isnull=True, workstream__isnull=True)
        | Q(project_id__in=projects)
        | Q(workstream_id__in=streams)
    )


def is_board_member(user, project=None, workstream=None):
    """Whether the person was added to the board a task sits on.

    A workstream that belongs to a project follows the project's members.
    """
    if project is not None and project.members.filter(id=user.id).exists():
        return True
    if workstream is not None:
        if workstream.project_id:
            return Project.members.through.objects.filter(project_id=workstream.project_id, user_id=user.id).exists()
        return workstream.members.filter(id=user.id).exists()
    return False


def task_board_member(task, user):
    return is_board_member(user, task.project_ref, task.workstream_ref)
