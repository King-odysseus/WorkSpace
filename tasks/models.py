from django.db import models
import uuid
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.core.files.storage import FileSystemStorage
from django.db.models.signals import post_delete
from django.dispatch import receiver
from django.conf import settings
from django.utils import timezone


def private_screen_capture_storage():
    """Storage with no public base URL; captures are streamed by an audited API."""
    return FileSystemStorage(location=settings.PRIVATE_MEDIA_ROOT, base_url=None)


class Workspace(models.Model):
    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=140, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    members = models.ManyToManyField(User, through='Membership', related_name='workspaces')
    next_task_number = models.PositiveBigIntegerField(default=1)
    calendar_feed_token = models.CharField(max_length=64, blank=True, default='')

    class Meta:
        ordering = ['name']


class PlanBucket(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='plan_buckets')
    name = models.CharField(max_length=80)
    is_active = models.BooleanField(default=True)
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['position', 'id']
        constraints = [models.UniqueConstraint(fields=['workspace', 'name'], name='unique_plan_bucket_name')]

    def as_dict(self):
        return {'id': self.id, 'workspace_id': self.workspace_id, 'name': self.name, 'is_active': self.is_active, 'position': self.position}


class SavedView(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='saved_views')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='workspace_saved_views')
    name = models.CharField(max_length=100)
    filter_value = models.CharField(max_length=300, default='all')
    search = models.CharField(max_length=200, blank=True)
    project_scope = models.CharField(max_length=80, default='all')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']
        constraints = [models.UniqueConstraint(fields=['workspace', 'user', 'name'], name='unique_saved_view_per_user')]

    def as_dict(self):
        return {'id': self.id, 'workspace_id': self.workspace_id, 'name': self.name, 'filter': self.filter_value, 'search': self.search, 'project_scope': self.project_scope, 'created_at': self.created_at.isoformat()}


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
        profile = getattr(self.user, 'profile', None)
        return {
            'id': self.user_id,
            'email': self.user.email,
            'first_name': self.user.first_name,
            'last_name': self.user.last_name,
            'role': self.role,
            'joined_at': self.joined_at.isoformat(),
            'avatar_url': profile.avatar_url if profile else '',
            'presence': profile.presence if profile else 'available',
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
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    timezone = models.CharField(max_length=64, default=settings.TIME_ZONE)
    week_anchor_date = models.DateField(null=True, blank=True)
    due_soon_days = models.PositiveSmallIntegerField(default=7)
    configuration = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['status', 'due_date', 'name']
        constraints = [models.UniqueConstraint(fields=['workspace', 'name'], name='unique_project_per_workspace')]
        indexes = [models.Index(fields=['workspace', 'status'], name='project_ws_status_idx')]

    def as_dict(self):
        return {
            'id': self.id,
            'workspace_id': self.workspace_id,
            'name': self.name,
            'description': self.description,
            'status': self.status,
            'due_date': self.due_date.isoformat() if self.due_date else None,
            'start_date': self.start_date.isoformat() if self.start_date else None,
            'end_date': self.end_date.isoformat() if self.end_date else None,
            'timezone': self.timezone,
            'week_anchor_date': self.week_anchor_date.isoformat() if self.week_anchor_date else None,
            'due_soon_days': self.due_soon_days,
            'configuration': self.configuration or {},
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
        }




class ProjectResource(models.Model):
    RESOURCE_TYPES = [('person', 'Person'), ('equipment', 'Equipment'), ('budget', 'Budget'), ('other', 'Other')]
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='resources')
    name = models.CharField(max_length=160)
    resource_type = models.CharField(max_length=20, choices=RESOURCE_TYPES, default='person')
    availability = models.CharField(max_length=160, blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['resource_type', 'name']

    def as_dict(self):
        return {
            'id': self.id,
            'project_id': self.project_id,
            'name': self.name,
            'resource_type': self.resource_type,
            'availability': self.availability,
            'notes': self.notes,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat(),
        }


class ProjectStakeholder(models.Model):
    INFLUENCE_CHOICES = [('low', 'Low'), ('medium', 'Medium'), ('high', 'High')]
    INTEREST_CHOICES = [('low', 'Low'), ('medium', 'Medium'), ('high', 'High')]
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='stakeholders')
    name = models.CharField(max_length=160)
    role = models.CharField(max_length=160, blank=True)
    email = models.EmailField(blank=True)
    influence = models.CharField(max_length=20, choices=INFLUENCE_CHOICES, default='medium')
    interest = models.CharField(max_length=20, choices=INTEREST_CHOICES, default='medium')
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def as_dict(self):
        return {
            'id': self.id,
            'project_id': self.project_id,
            'name': self.name,
            'role': self.role,
            'email': self.email,
            'influence': self.influence,
            'interest': self.interest,
            'notes': self.notes,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat(),
        }

class LookupValue(models.Model):
    KIND_CHOICES = [('workstream', 'Workstream'), ('phase', 'Phase / quarter')]

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='lookup_values')
    project = models.ForeignKey(Project, on_delete=models.CASCADE, null=True, blank=True, related_name='lookup_values')
    kind = models.CharField(max_length=20, choices=KIND_CHOICES)
    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=140)
    position = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['kind', 'position', 'name']
        constraints = [
            models.UniqueConstraint(fields=['workspace', 'project', 'kind', 'slug'], name='unique_scoped_lookup_value'),
        ]
        indexes = [models.Index(fields=['workspace', 'kind', 'is_active'], name='lookup_ws_kind_active_idx')]

    def clean(self):
        if self.project_id and self.project.workspace_id != self.workspace_id:
            raise ValidationError({'project': 'Project must belong to the same workspace.'})

    def as_dict(self):
        return {'id': self.id, 'workspace_id': self.workspace_id, 'project_id': self.project_id, 'kind': self.kind, 'name': self.name, 'slug': self.slug, 'position': self.position, 'is_active': self.is_active}




class TaskTemplate(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='task_templates')
    name = models.CharField(max_length=120)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    priority = models.CharField(max_length=20, choices=[('urgent', 'Urgent'), ('high', 'High'), ('normal', 'Normal'), ('low', 'Low')], default='normal')
    bucket = models.CharField(max_length=80, default='Backlog')
    recurrence = models.CharField(max_length=20, default='none')
    project = models.ForeignKey(Project, on_delete=models.SET_NULL, null=True, blank=True, related_name='task_templates')
    assignee = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='task_templates')
    workstream = models.CharField(max_length=120, blank=True)
    labels = models.JSONField(default=list, blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_task_templates')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def as_dict(self):
        return {
            'id': self.id,
            'workspace_id': self.workspace_id,
            'name': self.name,
            'title': self.title,
            'description': self.description,
            'priority': self.priority,
            'bucket': self.bucket,
            'recurrence': self.recurrence,
            'project_id': self.project_id,
            'assignee_id': self.assignee_id,
            'workstream': self.workstream,
            'labels': self.labels or [],
            'created_by': self.created_by_id,
            'created_at': self.created_at.isoformat(),
        }


class ProjectTemplate(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='project_templates')
    name = models.CharField(max_length=120)
    project_name = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    due_days = models.PositiveIntegerField(default=14)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_project_templates')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def as_dict(self):
        return {
            'id': self.id,
            'workspace_id': self.workspace_id,
            'name': self.name,
            'project_name': self.project_name,
            'description': self.description,
            'due_days': self.due_days,
            'created_by': self.created_by_id,
            'created_at': self.created_at.isoformat(),
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
            'reminder_sent_at': self.reminder_sent_at.isoformat() if self.reminder_sent_at else None,
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
    shared_documents = models.JSONField(default=list, blank=True)
    shared_files = models.JSONField(default=list, blank=True)
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
            'shared_documents': self.shared_documents or [],
            'shared_files': self.shared_files or [],
            'created_at': self.created_at.isoformat(),
        }


class ChatChannel(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='chat_channels')
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_chat_channels')
    members = models.ManyToManyField(User, blank=True, related_name='private_chat_channels')
    name = models.SlugField(max_length=80)
    description = models.CharField(max_length=240, blank=True)
    is_private = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']
        constraints = [models.UniqueConstraint(fields=['workspace', 'name'], name='unique_workspace_chat_channel')]

    def as_dict(self):
        return {
            'id': self.id,
            'workspace_id': self.workspace_id,
            'name': self.name,
            'description': self.description,
            'is_private': self.is_private,
            'created_by': self.created_by_id,
            'member_ids': list(self.members.values_list('id', flat=True)) if self.is_private else [],
            'created_at': self.created_at.isoformat(),
        }


class DirectConversation(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='direct_conversations')
    participants = models.ManyToManyField(User, related_name='direct_conversations')
    conversation_key = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [models.UniqueConstraint(fields=['workspace', 'conversation_key'], name='unique_direct_conversation')]

    def as_dict(self, viewer=None):
        participants = list(self.participants.all())
        others = [user for user in participants if viewer is None or user.id != viewer.id]
        title_users = others or participants
        last_message = self.messages.select_related('author').order_by('-created_at').first()
        return {
            'id': self.id,
            'workspace_id': self.workspace_id,
            'title': ', '.join(user.get_full_name() or user.email for user in title_users),
            'is_group': len(participants) > 2,
            'participants': [
                {'id': user.id, 'name': user.get_full_name() or user.email, 'email': user.email}
                for user in participants
            ],
            'last_message': last_message.message if last_message else '',
            'last_message_at': last_message.created_at.isoformat() if last_message else None,
            'created_at': self.created_at.isoformat(),
        }


class DirectMessage(models.Model):
    conversation = models.ForeignKey(DirectConversation, on_delete=models.CASCADE, related_name='messages')
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name='direct_messages')
    message = models.TextField(max_length=4000)
    shared_documents = models.JSONField(default=list, blank=True)
    shared_files = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def as_dict(self):
        return {
            'id': self.id,
            'conversation_id': self.conversation_id,
            'author_id': self.author_id,
            'author_name': self.author.get_full_name() or self.author.email,
            'message': self.message,
            'shared_documents': self.shared_documents or [],
            'shared_files': self.shared_files or [],
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
        ('on_hold', 'On hold'),
        ('cancelled', 'Cancelled'),
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
    STATE_CHOICES = [('draft', 'Draft'), ('active', 'Active'), ('archived', 'Archived')]

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='tasks', null=True, blank=True)
    assignee = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='assigned_tasks')
    supporter = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='supported_tasks')
    project_ref = models.ForeignKey(Project, on_delete=models.SET_NULL, null=True, blank=True, related_name='tasks')
    title = models.CharField(max_length=200)
    code = models.CharField(max_length=64, blank=True, default='')
    description = models.TextField(blank=True)
    assignee_name = models.CharField(max_length=120, blank=True)
    project = models.CharField(max_length=120, blank=True)
    workstream = models.CharField(max_length=120, blank=True, default='')
    phase = models.CharField(max_length=120, blank=True, default='')
    bucket = models.CharField(max_length=80, default='Backlog')
    position = models.PositiveIntegerField(default=0)
    labels = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='todo')
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default='normal')
    due_date = models.DateField(null=True, blank=True)
    start_date = models.DateField(null=True, blank=True)
    actual_completion_date = models.DateField(null=True, blank=True)
    progress_percent = models.PositiveSmallIntegerField(default=0)
    blocker_details = models.TextField(blank=True)
    state = models.CharField(max_length=20, choices=STATE_CHOICES, default='active')
    archived_at = models.DateTimeField(null=True, blank=True)
    archived_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='archived_tasks')
    workstream_ref = models.ForeignKey(LookupValue, on_delete=models.SET_NULL, null=True, blank=True, related_name='workstream_tasks')
    phase_ref = models.ForeignKey(LookupValue, on_delete=models.SET_NULL, null=True, blank=True, related_name='phase_tasks')
    supporters = models.ManyToManyField(User, through='TaskSupporter', through_fields=('task', 'user'), related_name='task_support_roles')
    recurrence = models.CharField(max_length=20, choices=RECURRENCE_CHOICES, default='none')
    blocked_by = models.ManyToManyField('self', symmetrical=False, blank=True, related_name='blocks')
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['status', 'due_date', '-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['workspace', 'code'],
                condition=~models.Q(code=''),
                name='unique_task_code_per_workspace',
            ),
            models.CheckConstraint(condition=models.Q(progress_percent__gte=0, progress_percent__lte=100), name='task_progress_between_0_and_100'),
        ]
        indexes = [
            models.Index(fields=['workspace', 'state', 'due_date'], name='task_ws_state_due_idx'),
            models.Index(fields=['workspace', 'project_ref', 'status'], name='task_ws_project_status_idx'),
            models.Index(fields=['workspace', 'assignee', 'status'], name='task_ws_owner_status_idx'),
        ]

    def clean(self):
        errors = {}
        if self.start_date and self.due_date and self.due_date < self.start_date:
            errors['due_date'] = 'Target date cannot precede start date.'
        if not 0 <= self.progress_percent <= 100:
            errors['progress_percent'] = 'Progress must be between 0 and 100.'
        if self.status == 'done' and self.progress_percent != 100:
            errors['progress_percent'] = 'Completed tasks must have 100% progress.'
        if self.status == 'blocked' and not self.blocker_details.strip():
            errors['blocker_details'] = 'Blocked tasks require blocker details.'
        for field_name in ('workstream_ref', 'phase_ref'):
            value = getattr(self, field_name)
            expected_kind = 'workstream' if field_name == 'workstream_ref' else 'phase'
            if value and (value.workspace_id != self.workspace_id or value.kind != expected_kind or (value.project_id and value.project_id != self.project_ref_id)):
                errors[field_name] = f'Select a valid {expected_kind} for this task scope.'
        if self.project_ref_id and self.project_ref.workspace_id != self.workspace_id:
            errors['project_ref'] = 'Project must belong to the same workspace.'
        if errors:
            raise ValidationError(errors)

    @property
    def task_code(self):
        """Canonical public name; ``code`` remains the stored legacy field."""
        return self.code

    def _visible_dependencies(self, related_manager):
        """Dependency rows that still count, filtered in Python so a
        ``prefetch_related`` cache is reused instead of issuing a query per task."""
        return [
            task for task in related_manager.all()
            if task.state != 'archived' and task.status != 'cancelled'
        ]

    def as_dict(self):
        blocked_by = self._visible_dependencies(self.blocked_by)
        blocking = self._visible_dependencies(self.blocks)
        return {
            'id': self.id,
            'workspace_id': self.workspace_id,
            'assignee_id': self.assignee_id,
            'assignee_name': (self.assignee.get_full_name() or self.assignee.email) if self.assignee else self.assignee_name,
            'supporter_id': self.supporter_id,
            'supporter_name': (self.supporter.get_full_name() or self.supporter.email) if self.supporter else None,
            'title': self.title,
            'code': self.code,
            'task_code': self.code,
            'description': self.description,
            'project': self.project_ref.name if self.project_ref else self.project,
            'workstream': self.workstream,
            'phase': self.phase,
            'workstream_id': self.workstream_ref_id,
            'phase_id': self.phase_ref_id,
            'bucket': self.bucket,
            'position': self.position,
            'labels': self.labels,
            'project_id': self.project_ref_id,
            'status': self.status,
            'priority': self.priority,
            'due_date': self.due_date.isoformat() if self.due_date else None,
            'start_date': self.start_date.isoformat() if self.start_date else None,
            'actual_completion_date': self.actual_completion_date.isoformat() if self.actual_completion_date else None,
            'progress_percent': self.progress_percent,
            'blocker_details': self.blocker_details,
            'state': self.state,
            'archived_at': self.archived_at.isoformat() if self.archived_at else None,
            'supporter_ids': [supporter.id for supporter in self.supporters.all()],
            'recurrence': self.recurrence,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'blocked_by_ids': [task.id for task in blocked_by],
            'blocking_ids': [task.id for task in blocking],
            'is_blocked_by_dependency': any(task.status != 'done' for task in blocked_by),
        }


class TaskSupporter(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='supporter_links')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='task_supporter_links')
    added_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='added_task_supporters')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['task', 'user'], name='unique_task_supporter')]

    def clean(self):
        if self.task.workspace_id and not Membership.objects.filter(workspace_id=self.task.workspace_id, user_id=self.user_id).exists():
            raise ValidationError({'user': 'Supporter must belong to the task workspace.'})


class TaskCodeRegistry(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='task_code_registry')
    code = models.CharField(max_length=64)
    task_id = models.PositiveBigIntegerField(null=True, blank=True)
    reserved_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['workspace', 'code'], name='unique_reserved_task_code')]


class TaskChangeHistory(models.Model):
    task = models.ForeignKey(Task, on_delete=models.SET_NULL, null=True, related_name='change_history')
    task_code = models.CharField(max_length=64)
    workspace = models.ForeignKey(Workspace, on_delete=models.PROTECT, related_name='task_change_history')
    actor = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='task_changes')
    field = models.CharField(max_length=64)
    previous_value = models.JSONField(null=True, blank=True)
    new_value = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValidationError('Task change history is immutable.')
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError('Task change history is immutable.')

    def as_dict(self):
        return {'id': self.id, 'task_id': self.task_id, 'task_code': self.task_code, 'actor_id': self.actor_id, 'actor_name': (self.actor.get_full_name() or self.actor.email) if self.actor else 'System', 'field': self.field, 'previous_value': self.previous_value, 'new_value': self.new_value, 'created_at': self.created_at.isoformat()}


class RiskIssue(models.Model):
    KIND_CHOICES = [('risk', 'Risk'), ('issue', 'Issue')]
    SEVERITY_CHOICES = [('low', 'Low'), ('medium', 'Medium'), ('high', 'High'), ('critical', 'Critical')]

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='risks_and_issues')
    project = models.ForeignKey(Project, on_delete=models.CASCADE, null=True, blank=True, related_name='risks_and_issues')
    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    title = models.CharField(max_length=200)
    detail = models.TextField(blank=True)
    severity = models.CharField(max_length=10, choices=SEVERITY_CHOICES, default='medium')
    status = models.CharField(max_length=30, default='open')
    owner = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='owned_risks_and_issues')
    owner_name = models.CharField(max_length=120, blank=True)
    due_date = models.DateField(null=True, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_risks_and_issues')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['kind', '-severity', 'due_date', '-created_at']
        indexes = [models.Index(fields=['workspace', 'project', 'kind', 'archived_at'], name='risk_scope_kind_archive_idx')]

    def clean(self):
        if self.project_id and self.project.workspace_id != self.workspace_id:
            raise ValidationError({'project': 'Project must belong to the same workspace.'})

    def as_dict(self):
        return {'id': self.id, 'workspace_id': self.workspace_id, 'project_id': self.project_id, 'kind': self.kind, 'title': self.title, 'detail': self.detail, 'severity': self.severity, 'status': self.status, 'owner_id': self.owner_id, 'owner': (self.owner.get_full_name() or self.owner.email) if self.owner else self.owner_name, 'due': self.due_date.isoformat() if self.due_date else None, 'due_date': self.due_date.isoformat() if self.due_date else None, 'archived_at': self.archived_at.isoformat() if self.archived_at else None, 'created_at': self.created_at.isoformat(), 'updated_at': self.updated_at.isoformat()}


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
            'file_url': f'/api/attachments/{self.id}/download/',
            'uploaded_by': self.uploaded_by.get_full_name() if self.uploaded_by else 'Unknown user',
            'created_at': self.created_at.isoformat(),
        }


class WorkspaceNotification(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='notifications')
    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name='workspace_notifications')
    kind = models.CharField(max_length=40)
    title = models.CharField(max_length=200)
    body = models.CharField(max_length=500, blank=True)
    target_type = models.CharField(max_length=40, blank=True)
    target_id = models.CharField(max_length=80, blank=True)
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
            'target_type': self.target_type,
            'target_id': self.target_id,
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


class NotificationPreference(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='notification_preferences')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='workspace_notification_preferences')
    mentions = models.BooleanField(default=True)
    direct_messages = models.BooleanField(default=True)
    task_updates = models.BooleanField(default=True)
    calendar_reminders = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['workspace', 'user'], name='unique_notification_preference_per_user')]

    def as_dict(self):
        return {
            'mentions': self.mentions,
            'direct_messages': self.direct_messages,
            'task_updates': self.task_updates,
            'calendar_reminders': self.calendar_reminders,
        }


class UserProfile(models.Model):
    PRESENCE_CHOICES = [
        ('available', 'Available'),
        ('busy', 'Busy'),
        ('away', 'Away'),
        ('offline', 'Offline'),
    ]

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    avatar = models.ImageField(upload_to='avatars/%Y/%m/', null=True, blank=True)
    presence = models.CharField(max_length=20, choices=PRESENCE_CHOICES, default='available')
    presence_updated_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def avatar_url(self):
        return f'/api/users/{self.user_id}/avatar/' if self.avatar else ''


class WorkspaceSetting(models.Model):
    workspace = models.OneToOneField(Workspace, on_delete=models.CASCADE, related_name='settings')
    due_soon_days = models.PositiveIntegerField(default=7)
    stale_days = models.PositiveIntegerField(default=14)
    kpi_targets = models.JSONField(default=dict, blank=True)
    ai_enabled = models.BooleanField(default=False)
    ai_user_ids = models.JSONField(default=list, blank=True)
    ai_model = models.CharField(max_length=120, blank=True, default='')
    ai_default_provider = models.CharField(max_length=30, default='openai')
    ai_enabled_providers = models.JSONField(default=list, blank=True)
    ai_provider_config = models.JSONField(default=dict, blank=True)
    screen_sharing_enabled = models.BooleanField(default=False)
    screen_capture_interval_seconds = models.PositiveSmallIntegerField(default=60)
    screen_capture_retention_days = models.PositiveSmallIntegerField(default=7)
    screen_sharing_policy = models.TextField(default='Screen sharing is optional and starts only after the employee accepts a request and chooses a screen or window in the browser. WorkSpace captures screenshots only while sharing is active, never captures audio or webcam data, and lets the employee stop at any time. Authorised workspace leaders can view, download, or delete captures; every such action is audited. Captures expire automatically after the configured retention period.')
    screen_sharing_policy_version = models.PositiveIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    def as_dict(self):
        return {
            'workspace_id': self.workspace_id,
            'due_soon_days': self.due_soon_days,
            'stale_days': self.stale_days,
            'kpi_targets': self.kpi_targets or {},
            'ai_enabled': self.ai_enabled,
            'ai_user_ids': self.ai_user_ids or [],
            'ai_model': self.ai_model,
            'ai_default_provider': self.ai_default_provider,
            'ai_enabled_providers': self.ai_enabled_providers or [],
            'screen_sharing_enabled': self.screen_sharing_enabled,
            'screen_capture_interval_seconds': self.screen_capture_interval_seconds,
            'screen_capture_retention_days': self.screen_capture_retention_days,
            'screen_sharing_policy': self.screen_sharing_policy,
            'screen_sharing_policy_version': self.screen_sharing_policy_version,
            'updated_at': self.updated_at.isoformat(),
        }


class ScreenShareSession(models.Model):
    STATUS_CHOICES = [
        ('pending', 'Pending consent'),
        ('active', 'Active'),
        ('declined', 'Declined'),
        ('cancelled', 'Cancelled'),
        ('stopped', 'Stopped'),
        ('expired', 'Expired'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='screen_share_sessions')
    requested_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='requested_screen_share_sessions')
    employee = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='screen_share_sessions')
    employee_name = models.CharField(max_length=200)
    employee_email = models.EmailField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    message = models.CharField(max_length=500, blank=True)
    policy_text = models.TextField()
    policy_version = models.PositiveIntegerField()
    capture_interval_seconds = models.PositiveSmallIntegerField(default=60)
    capture_retention_days = models.PositiveSmallIntegerField(default=7)
    expires_at = models.DateTimeField()
    accepted_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    last_heartbeat_at = models.DateTimeField(null=True, blank=True)
    stop_reason = models.CharField(max_length=80, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['workspace', 'status', 'created_at']), models.Index(fields=['employee', 'status'])]
        constraints = [
            models.UniqueConstraint(fields=['workspace', 'employee'], condition=models.Q(status__in=['pending', 'active']), name='one_open_screen_share_per_employee'),
        ]

    def as_dict(self, include_capture_count=False):
        data = {
            'id': str(self.id), 'workspace_id': self.workspace_id,
            'requested_by_id': self.requested_by_id,
            'requested_by_name': (self.requested_by.get_full_name() or self.requested_by.email) if self.requested_by else 'Former member',
            'employee_id': self.employee_id, 'employee_name': self.employee_name,
            'employee_email': self.employee_email, 'status': self.status,
            'message': self.message, 'policy_text': self.policy_text,
            'policy_version': self.policy_version,
            'capture_interval_seconds': self.capture_interval_seconds,
            'capture_retention_days': self.capture_retention_days,
            'expires_at': self.expires_at.isoformat(),
            'accepted_at': self.accepted_at.isoformat() if self.accepted_at else None,
            'started_at': self.started_at.isoformat() if self.started_at else None,
            'ended_at': self.ended_at.isoformat() if self.ended_at else None,
            'last_heartbeat_at': self.last_heartbeat_at.isoformat() if self.last_heartbeat_at else None,
            'stop_reason': self.stop_reason, 'created_at': self.created_at.isoformat(),
        }
        if include_capture_count:
            annotated = getattr(self, 'capture_total', None)
            data['capture_count'] = self.captures.count() if annotated is None else annotated
        return data


class ScreenCapture(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(ScreenShareSession, on_delete=models.CASCADE, related_name='captures')
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='screen_captures')
    captured_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='screen_captures')
    image = models.ImageField(upload_to='screen-captures/%Y/%m/%d/', storage=private_screen_capture_storage)
    mime_type = models.CharField(max_length=40, default='image/jpeg')
    size = models.PositiveIntegerField()
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    sha256 = models.CharField(max_length=64)
    captured_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    class Meta:
        ordering = ['-captured_at']
        indexes = [models.Index(fields=['workspace', 'expires_at']), models.Index(fields=['session', 'captured_at'])]

    def as_dict(self):
        return {
            'id': str(self.id), 'session_id': str(self.session_id),
            'captured_at': self.captured_at.isoformat(), 'expires_at': self.expires_at.isoformat(),
            'mime_type': self.mime_type, 'size': self.size, 'width': self.width, 'height': self.height,
            'view_url': f'/api/screen-captures/{self.id}/',
            'download_url': f'/api/screen-captures/{self.id}/?download=true',
        }


@receiver(post_delete, sender=ScreenCapture)
def delete_screen_capture_file(sender, instance, **kwargs):
    """Remove the image file whenever the row goes, including cascade deletes."""
    if not instance.image:
        return
    try:
        instance.image.delete(save=False)
    except (OSError, ValueError):
        pass


class WorkspaceDocument(models.Model):
    KIND_CHOICES = [('document', 'Document'), ('presentation', 'Presentation'), ('spreadsheet', 'Spreadsheet')]
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='documents')
    title = models.CharField(max_length=200)
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default='document')
    content = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='workspace_documents')
    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-updated_at']

    def as_dict(self):
        return {'id': self.id, 'workspace_id': self.workspace_id, 'title': self.title, 'kind': self.kind, 'content': self.content or {}, 'created_by': self.created_by_id, 'updated_at': self.updated_at.isoformat(), 'created_at': self.created_at.isoformat()}


class WorkspaceDocumentShare(models.Model):
    PERMISSION_CHOICES = [('view', 'View'), ('comment', 'Comment'), ('edit', 'Edit')]
    document = models.ForeignKey(WorkspaceDocument, on_delete=models.CASCADE, related_name='shares')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='shared_workspace_documents')
    permission = models.CharField(max_length=12, choices=PERMISSION_CHOICES, default='view')
    shared_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='workspace_document_shares_created')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['document', 'user'], name='unique_workspace_document_share')]

    def as_dict(self):
        return {'id': self.id, 'user_id': self.user_id, 'user_name': self.user.get_full_name() or self.user.email, 'email': self.user.email, 'permission': self.permission, 'shared_by': self.shared_by_id, 'updated_at': self.updated_at.isoformat()}


class WorkspaceDocumentComment(models.Model):
    document = models.ForeignKey(WorkspaceDocument, on_delete=models.CASCADE, related_name='comments')
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name='workspace_document_comments')
    parent = models.ForeignKey('self', on_delete=models.CASCADE, null=True, blank=True, related_name='replies')
    body = models.TextField(max_length=4000)
    anchor = models.JSONField(default=dict, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='resolved_workspace_document_comments')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def as_dict(self):
        return {'id': self.id, 'author_id': self.author_id, 'author_name': self.author.get_full_name() or self.author.email, 'parent_id': self.parent_id, 'body': self.body, 'anchor': self.anchor or {}, 'resolved': self.resolved_at is not None, 'resolved_at': self.resolved_at.isoformat() if self.resolved_at else None, 'created_at': self.created_at.isoformat()}


class WorkspaceDocumentRevision(models.Model):
    document = models.ForeignKey(WorkspaceDocument, on_delete=models.CASCADE, related_name='revisions')
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='workspace_document_revisions')
    title = models.CharField(max_length=200)
    content = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class WorkspaceFile(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='files')
    file = models.FileField(upload_to='workspace-files/%Y/%m/', blank=True)
    original_name = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=160, blank=True)
    size = models.PositiveBigIntegerField(default=0)
    cloudinary_url = models.URLField(max_length=1000, blank=True)
    cloudinary_public_id = models.CharField(max_length=500, blank=True)
    uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='workspace_files')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def as_dict(self):
        return {'id': self.id, 'workspace_id': self.workspace_id, 'original_name': self.original_name, 'mime_type': self.mime_type, 'size': self.size, 'url': self.cloudinary_url or (f'/api/workspace-files/{self.id}/download/' if self.file else ''), 'uploaded_by': self.uploaded_by.get_full_name() if self.uploaded_by else 'Unknown user', 'created_at': self.created_at.isoformat()}


class NotificationDelivery(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='notification_deliveries')
    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notification_deliveries')
    kind = models.CharField(max_length=40)
    target_type = models.CharField(max_length=40, blank=True)
    target_id = models.CharField(max_length=80, blank=True)
    dedup_key = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(fields=['workspace', 'kind', 'dedup_key'], name='unique_notification_delivery'),
        ]

    def as_dict(self):
        return {
            'id': self.id,
            'workspace_id': self.workspace_id,
            'recipient_id': self.recipient_id,
            'kind': self.kind,
            'target_type': self.target_type,
            'target_id': self.target_id,
            'dedup_key': self.dedup_key,
            'created_at': self.created_at.isoformat(),
        }


class ImportRun(models.Model):
    MODE_CHOICES = [('preview', 'Preview'), ('commit', 'Commit')]

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='import_runs')
    actor = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='import_runs')
    mode = models.CharField(max_length=20, choices=MODE_CHOICES, default='preview')
    source = models.CharField(max_length=255, blank=True)
    summary = models.JSONField(default=dict, blank=True)
    exceptions = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def as_dict(self):
        return {
            'id': self.id,
            'workspace_id': self.workspace_id,
            'actor_id': self.actor_id,
            'mode': self.mode,
            'source': self.source,
            'summary': self.summary,
            'exceptions': self.exceptions,
            'created_at': self.created_at.isoformat(),
        }


class WorkShift(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='work_shifts')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='work_shifts')
    date = models.DateField()
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    break_started_at = models.DateTimeField(null=True, blank=True)
    break_seconds = models.PositiveIntegerField(default=0)
    break_plan_minutes = models.PositiveIntegerField(default=0)
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-started_at']
        indexes = [
            models.Index(fields=['workspace', 'date']),
            models.Index(fields=['user', 'date']),
        ]
        constraints = [
            models.UniqueConstraint(fields=['workspace', 'user'], condition=models.Q(ended_at__isnull=True), name='unique_open_work_shift'),
        ]

    @property
    def is_open(self):
        return self.ended_at is None

    @property
    def is_on_break(self):
        return self.is_open and self.break_started_at is not None

    def elapsed_break_seconds(self, now=None):
        """Accrued break time, including the break currently running."""
        total = self.break_seconds
        if self.break_started_at and self.ended_at is None:
            total += int(((now or timezone.now()) - self.break_started_at).total_seconds())
        return total

    def worked_seconds(self, now=None):
        now = now or timezone.now()
        end = self.ended_at or now
        return max(0, int((end - self.started_at).total_seconds()) - self.elapsed_break_seconds(now))

    def as_dict(self):
        now = timezone.now()
        return {
            'id': self.id,
            'workspace_id': self.workspace_id,
            'user_id': self.user_id,
            'user_name': self.user.get_full_name() or self.user.email,
            'date': self.date.isoformat(),
            'started_at': self.started_at.isoformat(),
            'ended_at': self.ended_at.isoformat() if self.ended_at else '',
            'break_started_at': self.break_started_at.isoformat() if self.break_started_at else '',
            'break_seconds': self.break_seconds,
            'break_plan_minutes': self.break_plan_minutes,
            'break_seconds_total': self.elapsed_break_seconds(now),
            'worked_seconds': self.worked_seconds(now),
            'is_open': self.is_open,
            'is_on_break': self.is_on_break,
            'note': self.note,
        }


class WorkspaceWebhook(models.Model):
    KIND_CHOICES = [
        ('teams', 'Microsoft Teams'),
        ('slack', 'Slack'),
        ('generic', 'Generic JSON'),
    ]

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='webhooks')
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default='teams')
    url = models.URLField(max_length=500)
    label = models.CharField(max_length=120, blank=True)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_webhooks')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def as_dict(self):
        return {
            'id': self.id,
            'workspace_id': self.workspace_id,
            'kind': self.kind,
            'url': self.url,
            'label': self.label,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat(),
        }


class WebhookDelivery(models.Model):
    """Queued outbound webhook post.

    Notifications enqueue rows here instead of making the HTTP call inline, so a
    slow or unreachable endpoint can never stall the request that triggered it.
    The ``deliver_webhooks`` management command drains the queue.
    """

    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('sent', 'Sent'),
        ('failed', 'Failed'),
    ]
    MAX_ATTEMPTS = 3

    webhook = models.ForeignKey(WorkspaceWebhook, on_delete=models.CASCADE, related_name='deliveries')
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='webhook_deliveries')
    kind = models.CharField(max_length=40)
    title = models.CharField(max_length=200)
    body = models.CharField(max_length=500, blank=True)
    target_type = models.CharField(max_length=40, blank=True)
    target_id = models.CharField(max_length=80, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    attempts = models.PositiveSmallIntegerField(default=0)
    last_error = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at']
        indexes = [models.Index(fields=['status', 'created_at'])]

    def as_dict(self):
        return {
            'id': self.id,
            'webhook_id': self.webhook_id,
            'kind': self.kind,
            'title': self.title,
            'status': self.status,
            'attempts': self.attempts,
            'created_at': self.created_at.isoformat(),
        }
