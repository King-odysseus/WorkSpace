from django.contrib import admin

from .models import ActivityEvent, AuditLog, CalendarEvent, CheckIn, ChatMessage, FollowUp, ImportRun, LookupValue, Membership, NotificationDelivery, PlanBucket, Project, RiskIssue, SavedView, ScreenCapture, ScreenShareSession, Task, TaskAttachment, TaskChangeHistory, TaskCodeRegistry, TaskComment, TaskSubtask, TaskSupporter, Workspace, WorkspaceDocument, WorkspaceFile, WorkspaceInvitation, WorkspaceNotification, WorkspaceSetting, WebhookDelivery, WorkspaceWebhook, WorkShift


@admin.register(Workspace)
class WorkspaceAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'created_at')
    search_fields = ('name', 'slug')


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ('workspace', 'user', 'role', 'joined_at')
    list_filter = ('role', 'workspace')
    search_fields = ('workspace__name', 'user__email')


@admin.register(WorkspaceInvitation)
class WorkspaceInvitationAdmin(admin.ModelAdmin):
    list_display = ('email', 'workspace', 'role', 'status', 'created_at')
    list_filter = ('status', 'role', 'workspace')
    search_fields = ('email', 'workspace__name')


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ('name', 'workspace', 'status', 'due_date', 'updated_at')
    list_filter = ('status', 'workspace')
    search_fields = ('name', 'description', 'workspace__name')


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ('title', 'code', 'workspace', 'assignee', 'status', 'state', 'progress_percent', 'due_date', 'updated_at')
    list_filter = ('status', 'state', 'workspace')
    search_fields = ('title', 'code', 'description', 'assignee_name', 'project', 'workstream', 'phase')


admin.site.register(LookupValue)
admin.site.register(TaskSupporter)
admin.site.register(RiskIssue)
admin.site.register(WorkspaceWebhook)
admin.site.register(WebhookDelivery)
admin.site.register(WorkspaceDocument)
admin.site.register(WorkspaceFile)


@admin.register(TaskCodeRegistry)
class TaskCodeRegistryAdmin(admin.ModelAdmin):
    list_display = ('workspace', 'code', 'task_id', 'reserved_at')
    readonly_fields = ('workspace', 'code', 'task_id', 'reserved_at')

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(TaskChangeHistory)
class TaskChangeHistoryAdmin(admin.ModelAdmin):
    list_display = ('task_code', 'field', 'actor', 'created_at')
    readonly_fields = ('task', 'task_code', 'workspace', 'actor', 'field', 'previous_value', 'new_value', 'created_at')

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(TaskComment)
class TaskCommentAdmin(admin.ModelAdmin):
    list_display = ('task', 'author', 'created_at')
    search_fields = ('body', 'task__title', 'author__email')


@admin.register(TaskSubtask)
class TaskSubtaskAdmin(admin.ModelAdmin):
    list_display = ('title', 'task', 'completed', 'assignee')
    list_filter = ('completed',)
    search_fields = ('title', 'task__title')


@admin.register(WorkspaceNotification)
class WorkspaceNotificationAdmin(admin.ModelAdmin):
    list_display = ('recipient', 'kind', 'title', 'read_at', 'created_at')
    list_filter = ('kind', 'read_at')
    search_fields = ('title', 'body', 'recipient__email')


@admin.register(ActivityEvent)
class ActivityEventAdmin(admin.ModelAdmin):
    list_display = ('workspace', 'actor', 'kind', 'message', 'created_at')
    list_filter = ('kind',)
    search_fields = ('message', 'actor__email')


@admin.register(PlanBucket)
class PlanBucketAdmin(admin.ModelAdmin):
    list_display = ('name', 'workspace', 'position')
    search_fields = ('name', 'workspace__name')


@admin.register(SavedView)
class SavedViewAdmin(admin.ModelAdmin):
    list_display = ('name', 'workspace', 'user', 'filter_value', 'created_at')
    list_filter = ('workspace',)
    search_fields = ('name', 'user__email', 'workspace__name')


@admin.register(TaskAttachment)
class TaskAttachmentAdmin(admin.ModelAdmin):
    list_display = ('original_name', 'task', 'uploaded_by', 'created_at')
    search_fields = ('original_name', 'task__title', 'uploaded_by__email')


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ('workspace', 'actor', 'action', 'target_type', 'target_id', 'created_at')
    list_filter = ('action', 'target_type')
    search_fields = ('actor__email', 'target_type', 'target_id')
    readonly_fields = ('workspace', 'actor', 'action', 'target_type', 'target_id', 'details', 'created_at')


@admin.register(CalendarEvent)
class CalendarEventAdmin(admin.ModelAdmin):
    list_display = ('title', 'workspace', 'event_type', 'start_at', 'end_at')
    list_filter = ('event_type', 'workspace')
    search_fields = ('title', 'description')


@admin.register(CheckIn)
class CheckInAdmin(admin.ModelAdmin):
    list_display = ('workspace', 'user', 'date', 'updated_at')
    list_filter = ('workspace', 'date')
    search_fields = ('user__email', 'completed', 'next_steps', 'blockers')


@admin.register(ChatMessage)
class ChatMessageAdmin(admin.ModelAdmin):
    list_display = ('workspace', 'author', 'channel', 'created_at')
    list_filter = ('workspace', 'channel')
    search_fields = ('message', 'author__email')


@admin.register(FollowUp)
class FollowUpAdmin(admin.ModelAdmin):
    list_display = ('note', 'workspace', 'status', 'due_date', 'assigned_to')
    list_filter = ('status', 'workspace')
    search_fields = ('note',)


@admin.register(WorkspaceSetting)
class WorkspaceSettingAdmin(admin.ModelAdmin):
    list_display = ('workspace', 'due_soon_days', 'stale_days', 'screen_sharing_enabled', 'screen_capture_retention_days', 'updated_at')
    search_fields = ('workspace__name',)


@admin.register(NotificationDelivery)
class NotificationDeliveryAdmin(admin.ModelAdmin):
    list_display = ('workspace', 'recipient', 'kind', 'target_type', 'target_id', 'created_at')
    list_filter = ('kind',)
    search_fields = ('recipient__email', 'dedup_key')


@admin.register(ImportRun)
class ImportRunAdmin(admin.ModelAdmin):
    list_display = ('workspace', 'actor', 'mode', 'source', 'created_at')
    list_filter = ('mode',)
    search_fields = ('workspace__name', 'actor__email', 'source')
    readonly_fields = ('workspace', 'actor', 'mode', 'source', 'summary', 'exceptions', 'created_at')


@admin.register(WorkShift)
class WorkShiftAdmin(admin.ModelAdmin):
    list_display = ('workspace', 'user', 'date', 'started_at', 'ended_at', 'break_seconds')
    list_filter = ('date',)
    search_fields = ('workspace__name', 'user__email')


@admin.register(ScreenShareSession)
class ScreenShareSessionAdmin(admin.ModelAdmin):
    list_display = ('workspace', 'employee_email', 'requested_by', 'status', 'started_at', 'ended_at', 'created_at')
    list_filter = ('status', 'workspace')
    search_fields = ('employee_email', 'employee_name', 'requested_by__email')
    readonly_fields = tuple(field.name for field in ScreenShareSession._meta.fields)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(ScreenCapture)
class ScreenCaptureAdmin(admin.ModelAdmin):
    list_display = ('session', 'workspace', 'captured_by', 'captured_at', 'expires_at', 'size')
    list_filter = ('workspace', 'captured_at')
    readonly_fields = tuple(field.name for field in ScreenCapture._meta.fields)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
