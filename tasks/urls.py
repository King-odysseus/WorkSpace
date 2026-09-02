from django.urls import path

from .auth_views import auth_csrf, auth_login, auth_logout, auth_me
from .views import calendar_event_list, check_in_list, health, member_list, project_list, task_detail, task_list

urlpatterns = [
    path('health/', health, name='health'),
    path('auth/me/', auth_me, name='auth-me'),
    path('auth/csrf/', auth_csrf, name='auth-csrf'),
    path('auth/login/', auth_login, name='auth-login'),
    path('auth/logout/', auth_logout, name='auth-logout'),
    path('workspaces/<int:workspace_id>/members/', member_list, name='member-list'),
    path('workspaces/<int:workspace_id>/projects/', project_list, name='project-list'),
    path('workspaces/<int:workspace_id>/calendar-events/', calendar_event_list, name='calendar-event-list'),
    path('workspaces/<int:workspace_id>/check-ins/', check_in_list, name='check-in-list'),
    path('tasks/', task_list, name='task-list'),
    path('tasks/<int:task_id>/', task_detail, name='task-detail'),
]
