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
            'title': self.title,
            'description': self.description,
            'assignee_name': self.assignee_name,
            'project': self.project,
            'status': self.status,
            'due_date': self.due_date.isoformat() if self.due_date else None,
        }
