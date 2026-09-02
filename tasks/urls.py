from django.urls import path

from .auth_views import auth_login, auth_logout, auth_me
from .views import health, task_detail, task_list

urlpatterns = [
    path('health/', health, name='health'),
    path('auth/me/', auth_me, name='auth-me'),
    path('auth/login/', auth_login, name='auth-login'),
    path('auth/logout/', auth_logout, name='auth-logout'),
    path('tasks/', task_list, name='task-list'),
    path('tasks/<int:task_id>/', task_detail, name='task-detail'),
]
