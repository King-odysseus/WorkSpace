from django.db import models


class Task(models.Model):
    STATUS_CHOICES = [
        ('todo', 'To do'),
        ('in_progress', 'In progress'),
        ('blocked', 'Blocked'),
        ('review', 'Review'),
        ('done', 'Done'),
    ]

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
