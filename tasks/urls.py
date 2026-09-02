from django.urls import path

from .views import health, task_detail, task_list

urlpatterns = [
    path('health/', health, name='health'),
    path('tasks/', task_list, name='task-list'),
    path('tasks/<int:task_id>/', task_detail, name='task-detail'),
]
