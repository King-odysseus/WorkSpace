from django.urls import path

from .views import health, task_list

urlpatterns = [
    path('health/', health, name='health'),
    path('tasks/', task_list, name='task-list'),
]
