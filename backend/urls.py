from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from django.urls import include, path

from tasks.legal_views import privacy_policy, terms_of_service


urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('tasks.urls')),
    # Public, unauthenticated pages required by the Google OAuth consent screen's
    # Branding step (Application privacy policy link / terms of service link).
    path('privacy-policy', privacy_policy, name='privacy-policy'),
    path('terms-of-service', terms_of_service, name='terms-of-service'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
