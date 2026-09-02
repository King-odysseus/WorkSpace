from django.contrib import admin

from .models import CalendarEvent, CheckIn, ChatMessage, FollowUp, Membership, Project, Task, Workspace, WorkspaceInvitation


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
    list_display = ('title', 'workspace', 'assignee', 'status', 'due_date', 'updated_at')
    list_filter = ('status', 'workspace')
    search_fields = ('title', 'description', 'assignee_name', 'project')


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
