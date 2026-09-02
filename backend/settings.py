from pathlib import Path
import os
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
development_secret = 'local-development-only-key-change-before-deploy'
SECRET_KEY = os.environ.get('WORKSPACE_SECRET_KEY', development_secret)
DEBUG = os.environ.get('WORKSPACE_DEBUG', 'true').lower() == 'true'
ALLOWED_HOSTS = [host.strip() for host in os.environ.get('WORKSPACE_ALLOWED_HOSTS', '127.0.0.1,localhost').split(',') if host.strip()]
CSRF_TRUSTED_ORIGINS = [origin.strip() for origin in os.environ.get('WORKSPACE_CSRF_TRUSTED_ORIGINS', 'http://127.0.0.1:5175,http://localhost:5175,http://192.168.68.55:5175').split(',') if origin.strip()]
if not DEBUG and (not SECRET_KEY or SECRET_KEY == development_secret or len(SECRET_KEY) < 50):
    raise ImproperlyConfigured('WORKSPACE_SECRET_KEY must be a unique value of at least 50 characters when WORKSPACE_DEBUG is false.')

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'tasks',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'backend.urls'
TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {'context_processors': [
            'django.template.context_processors.request',
            'django.contrib.auth.context_processors.auth',
            'django.contrib.messages.context_processors.messages',
        ]},
    },
]
WSGI_APPLICATION = 'backend.wsgi.application'

database_name = os.environ.get('WORKSPACE_DB_NAME')
if database_name:
    DATABASES = {
        'default': {
            'ENGINE': os.environ.get('WORKSPACE_DB_ENGINE', 'django.db.backends.postgresql'),
            'NAME': database_name,
            'USER': os.environ.get('WORKSPACE_DB_USER', ''),
            'PASSWORD': os.environ.get('WORKSPACE_DB_PASSWORD', ''),
            'HOST': os.environ.get('WORKSPACE_DB_HOST', '127.0.0.1'),
            'PORT': os.environ.get('WORKSPACE_DB_PORT', '5432'),
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Europe/London'
USE_I18N = True
USE_TZ = True
STATIC_URL = 'static/'
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
if not DEBUG:
    SECURE_SSL_REDIRECT = os.environ.get('WORKSPACE_SECURE_SSL_REDIRECT', 'false').lower() == 'true'
    SECURE_HSTS_SECONDS = int(os.environ.get('WORKSPACE_HSTS_SECONDS', '0'))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = os.environ.get('WORKSPACE_HSTS_INCLUDE_SUBDOMAINS', 'false').lower() == 'true'
    SECURE_HSTS_PRELOAD = os.environ.get('WORKSPACE_HSTS_PRELOAD', 'false').lower() == 'true'
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_REFERRER_POLICY = 'same-origin'
