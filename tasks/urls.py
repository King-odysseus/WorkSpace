from django.urls import path

from .auth_views import auth_csrf, auth_login, auth_logout, auth_me
from .views import activity_list, calendar_event_detail, calendar_event_list, chat_message_list, check_in_list, follow_up_detail, follow_up_list, health, invitation_accept, invitation_list, member_detail, member_list, notification_list, plan_bucket_list, project_detail, project_list, task_comment_list, task_detail, task_list, task_subtask_detail, task_subtask_list

urlpatterns = [
    path('health/', health, name='health'),
    path('auth/me/', auth_me, name='auth-me'),
    path('auth/csrf/', auth_csrf, name='auth-csrf'),
    path('auth/login/', auth_login, name='auth-login'),
    path('auth/logout/', auth_logout, name='auth-logout'),
    path('workspaces/<int:workspace_id>/members/', member_list, name='member-list'),
    path('workspaces/<int:workspace_id>/members/<int:user_id>/', member_detail, name='member-detail'),
    path('workspaces/<int:workspace_id>/invitations/', invitation_list, name='invitation-list'),
    path('invitations/<int:invitation_id>/accept/', invitation_accept, name='invitation-accept'),
    path('workspaces/<int:workspace_id>/projects/', project_list, name='project-list'),
    path('workspaces/<int:workspace_id>/projects/<int:project_id>/', project_detail, name='project-detail'),
    path('workspaces/<int:workspace_id>/calendar-events/', calendar_event_list, name='calendar-event-list'),
    path('workspaces/<int:workspace_id>/calendar-events/<int:event_id>/', calendar_event_detail, name='calendar-event-detail'),
    path('workspaces/<int:workspace_id>/check-ins/', check_in_list, name='check-in-list'),
    path('workspaces/<int:workspace_id>/chat-messages/', chat_message_list, name='chat-message-list'),
    path('workspaces/<int:workspace_id>/follow-ups/', follow_up_list, name='follow-up-list'),
    path('workspaces/<int:workspace_id>/notifications/', notification_list, name='notification-list'),
    path('workspaces/<int:workspace_id>/activity/', activity_list, name='activity-list'),
    path('workspaces/<int:workspace_id>/plan-buckets/', plan_bucket_list, name='plan-bucket-list'),
    path('follow-ups/<int:follow_up_id>/', follow_up_detail, name='follow-up-detail'),
    path('tasks/', task_list, name='task-list'),
    path('tasks/<int:task_id>/', task_detail, name='task-detail'),
    path('tasks/<int:task_id>/comments/', task_comment_list, name='task-comment-list'),
    path('tasks/<int:task_id>/subtasks/', task_subtask_list, name='task-subtask-list'),
    path('subtasks/<int:subtask_id>/', task_subtask_detail, name='task-subtask-detail'),
]
