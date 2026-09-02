from django.db import models
from django.contrib.auth.models import User


class Workspace(models.Model):
    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=140, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    members = models.ManyToManyField(User, through='Membership', related_name='workspaces')

    class Meta:
        ordering = ['name']


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

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='tasks', null=True, blank=True)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    assignee_name = models.CharField(max_length=120, blank=True)
    project = models.CharField(max_length=120, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='todo')
    due_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['status', 'due_date', '-created_at']

    def as_dict(self):
        return {
            'id': self.id,
            'workspace_id': self.workspace_id,
            'title': self.title,
            'description': self.description,
            'assignee_name': self.assignee_name,
            'project': self.project,
            'status': self.status,
            'due_date': self.due_date.isoformat() if self.due_date else None,
        }
