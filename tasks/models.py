from django.db import models
from django.contrib.auth.models import User


class Workspace(models.Model):
    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=140, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    members = models.ManyToManyField(User, through='Membership', related_name='workspaces')

    class Meta:
        ordering = ['name']


class PlanBucket(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='plan_buckets')
    name = models.CharField(max_length=80)
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['position', 'id']
        constraints = [models.UniqueConstraint(fields=['workspace', 'name'], name='unique_plan_bucket_name')]

    def as_dict(self):
        return {'id': self.id, 'workspace_id': self.workspace_id, 'name': self.name, 'position': self.position}


class SavedView(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='saved_views')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='workspace_saved_views')
    name = models.CharField(max_length=100)
    filter_value = models.CharField(max_length=80, default='all')
    search = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']
        constraints = [models.UniqueConstraint(fields=['workspace', 'user', 'name'], name='unique_saved_view_per_user')]

    def as_dict(self):
        return {'id': self.id, 'workspace_id': self.workspace_id, 'name': self.name, 'filter': self.filter_value, 'search': self.search, 'created_at': self.created_at.isoformat()}


class Membership(models.Model):
    ROLE_CHOICES = [
        ('owner', 'Owner'),
        ('manager', 'Manager'),
        ('member', 'Member'),
    ]

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='memberships')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='workspace_memberships')
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='member')
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['workspace', 'user'], name='unique_workspace_member')]

    def as_dict(self):
        return {
            'id': self.user_id,
            'email': self.user.email,
            'first_name': self.user.first_name,
            'last_name': self.user.last_name,
            'role': self.role,
            'joined_at': self.joined_at.isoformat(),
        }


class WorkspaceInvitation(models.Model):
    STATUS_CHOICES = [('pending', 'Pending'), ('accepted', 'Accepted'), ('cancelled', 'Cancelled')]

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='invitations')
    email = models.EmailField()
    role = models.CharField(max_length=20, choices=Membership.ROLE_CHOICES, default='member')
    invited_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='workspace_invitations')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['status', '-created_at']
        constraints = [models.UniqueConstraint(fields=['workspace', 'email', 'status'], name='unique_workspace_invitation_status')]

    def as_dict(self):
        return {
            'id': self.id,
            'workspace_id': self.workspace_id,
            'email': self.email,
            'role': self.role,
            'status': self.status,
            'invited_by': self.invited_by_id,
            'created_at': self.created_at.isoformat(),
        }


class Project(models.Model):
    STATUS_CHOICES = [
        ('planning', 'Planning'),
        ('active', 'Active'),
        ('paused', 'Paused'),
        ('completed', 'Completed'),
    ]

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='projects')
    name = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='planning')
    due_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['status', 'due_date', 'name']
        constraints = [models.UniqueConstraint(fields=['workspace', 'name'], name='unique_project_per_workspace')]

    def as_dict(self):
        return {
            'id': self.id,
            'workspace_id': self.workspace_id,
            'name': self.name,
            'description': self.description,
            'status': self.status,
            'due_date': self.due_date.isoformat() if self.due_date else None,
        }


class CalendarEvent(models.Model):
    EVENT_TYPES = [
        ('meeting', 'Meeting'),
        ('focus', 'Focus time'),
        ('deadline', 'Deadline'),
        ('reminder', 'Reminder'),
    ]

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='calendar_events')
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    start_at = models.DateTimeField()
    end_at = models.DateTimeField()
    event_type = models.CharField(max_length=20, choices=EVENT_TYPES, default='meeting')
    reminder_minutes = models.PositiveIntegerField(default=15)
    reminder_sent_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_calendar_events')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['start_at', 'title']

    def as_dict(self):
        return {
            'id': self.id,
            'workspace_id': self.workspace_id,
            'title': self.title,
            'description': self.description,
            'start_at': self.start_at.isoformat(),
            'end_at': self.end_at.isoformat(),
            'event_type': self.event_type,
            'reminder_minutes': self.reminder_minutes,
            'created_by': self.created_by_id,
        }


class CheckIn(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='check_ins')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='check_ins')
    date = models.DateField()
    completed = models.TextField(blank=True)
    next_steps = models.TextField(blank=True)
    blockers = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-date', 'user__first_name', 'user__email']
        constraints = [models.UniqueConstraint(fields=['workspace', 'user', 'date'], name='unique_daily_check_in')]

    def as_dict(self):
        return {
            'id': self.id,
            'workspace_id': self.workspace_id,
            'user_id': self.user_id,
            'user_name': self.user.get_full_name() or self.user.email,
            'user_initials': ''.join(part[0] for part in [self.user.first_name, self.user.last_name] if part).upper()[:2] or self.user.email[:2].upper(),
            'date': self.date.isoformat(),
            'completed': self.completed,
            'next_steps': self.next_steps,
            'blockers': self.blockers,
            'updated_at': self.updated_at.isoformat(),
        }


class ChatMessage(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='chat_messages')
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name='chat_messages')
    parent = models.ForeignKey('self', on_delete=models.CASCADE, null=True, blank=True, related_name='replies')
    channel = models.CharField(max_length=80, default='general')
    message = models.TextField(max_length=4000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def as_dict(self):
        return {
            'id': self.id,
            'workspace_id': self.workspace_id,
            'author_id': self.author_id,
            'author_name': self.author.get_full_name() or self.author.email,
            'parent_id': self.parent_id,
            'reply_count': self.replies.count(),
            'channel': self.channel,
            'message': self.message,
            'created_at': self.created_at.isoformat(),
        }


class FollowUp(models.Model):
    STATUS_CHOICES = [('open', 'Open'), ('completed', 'Completed')]

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='follow_ups')
    task = models.ForeignKey('Task', on_delete=models.SET_NULL, null=True, blank=True, related_name='follow_ups')
    created_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='created_follow_ups')
    assigned_to = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='assigned_follow_ups')
    note = models.CharField(max_length=500)
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='open')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['status', 'due_date', '-created_at']

    def as_dict(self):
        return {
            'id': self.id,
            'workspace_id': self.workspace_id,
            'task_id': self.task_id,
            'created_by': self.created_by_id,
            'assigned_to': self.assigned_to_id,
            'assigned_to_name': (self.assigned_to.get_full_name() or self.assigned_to.email) if self.assigned_to else None,
            'note': self.note,
            'due_date': self.due_date.isoformat() if self.due_date else None,
            'status': self.status,
        }


class Task(models.Model):
    STATUS_CHOICES = [
        ('todo', 'To do'),
        ('in_progress', 'In progress'),
        ('blocked', 'Blocked'),
        ('review', 'Review'),
        ('done', 'Done'),
    ]
    RECURRENCE_CHOICES = [
        ('none', 'Does not repeat'),
        ('daily', 'Daily'),
        ('weekly', 'Weekly'),
        ('monthly', 'Monthly'),
    ]
    PRIORITY_CHOICES = [
        ('urgent', 'Urgent'),
        ('high', 'High'),
        ('normal', 'Normal'),
        ('low', 'Low'),
    ]

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='tasks', null=True, blank=True)
    assignee = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='assigned_tasks')
    project_ref = models.ForeignKey(Project, on_delete=models.SET_NULL, null=True, blank=True, related_name='tasks')
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    assignee_name = models.CharField(max_length=120, blank=True)
    project = models.CharField(max_length=120, blank=True)
    bucket = models.CharField(max_length=80, default='Backlog')
    labels = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='todo')
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default='normal')
    due_date = models.DateField(null=True, blank=True)
    recurrence = models.CharField(max_length=20, choices=RECURRENCE_CHOICES, default='none')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['status', 'due_date', '-created_at']

    def as_dict(self):
        return {
            'id': self.id,
            'workspace_id': self.workspace_id,
            'assignee_id': self.assignee_id,
            'assignee_name': (self.assignee.get_full_name() or self.assignee.email) if self.assignee else self.assignee_name,
            'title': self.title,
            'description': self.description,
            'project': self.project_ref.name if self.project_ref else self.project,
            'bucket': self.bucket,
            'labels': self.labels,
            'project_id': self.project_ref_id,
            'status': self.status,
            'priority': self.priority,
            'due_date': self.due_date.isoformat() if self.due_date else None,
            'recurrence': self.recurrence,
        }


class TaskComment(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='comments')
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name='task_comments')
    body = models.TextField(max_length=4000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def as_dict(self):
        return {
            'id': self.id,
            'task_id': self.task_id,
            'author_id': self.author_id,
            'author_name': self.author.get_full_name() or self.author.email,
            'body': self.body,
            'created_at': self.created_at.isoformat(),
        }


class TaskSubtask(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='subtasks')
    title = models.CharField(max_length=200)
    completed = models.BooleanField(default=False)
    assignee = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='assigned_subtasks')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['completed', 'created_at']

    def as_dict(self):
        return {
            'id': self.id,
            'task_id': self.task_id,
            'title': self.title,
            'completed': self.completed,
            'assignee_id': self.assignee_id,
            'assignee_name': self.assignee.get_full_name() if self.assignee else None,
        }


class TaskAttachment(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='attachments')
    uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='task_attachments')
    file = models.FileField(upload_to='task-attachments/%Y/%m/')
    original_name = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def as_dict(self):
        return {
            'id': self.id,
            'task_id': self.task_id,
            'original_name': self.original_name,
            'file_url': self.file.url,
            'uploaded_by': self.uploaded_by.get_full_name() if self.uploaded_by else 'Unknown user',
            'created_at': self.created_at.isoformat(),
        }


class WorkspaceNotification(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='notifications')
    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name='workspace_notifications')
    kind = models.CharField(max_length=40)
    title = models.CharField(max_length=200)
    body = models.CharField(max_length=500, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['read_at', '-created_at']

    def as_dict(self):
        return {
            'id': self.id,
            'workspace_id': self.workspace_id,
            'kind': self.kind,
            'title': self.title,
            'body': self.body,
            'read': self.read_at is not None,
            'created_at': self.created_at.isoformat(),
        }


class ActivityEvent(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='activity_events')
    actor = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='workspace_activity_events')
    kind = models.CharField(max_length=40)
    message = models.CharField(max_length=500)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def as_dict(self):
        return {
            'id': self.id,
            'workspace_id': self.workspace_id,
            'actor_name': self.actor.get_full_name() if self.actor else 'System',
            'kind': self.kind,
            'message': self.message,
            'created_at': self.created_at.isoformat(),
        }


class AuditLog(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='audit_logs')
    actor = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='workspace_audit_logs')
    action = models.CharField(max_length=60)
    target_type = models.CharField(max_length=60)
    target_id = models.CharField(max_length=80, blank=True)
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def as_dict(self):
        return {
            'id': self.id,
            'workspace_id': self.workspace_id,
            'actor_name': self.actor.get_full_name() if self.actor else 'System',
            'action': self.action,
            'target_type': self.target_type,
            'target_id': self.target_id,
            'details': self.details,
            'created_at': self.created_at.isoformat(),
        }
