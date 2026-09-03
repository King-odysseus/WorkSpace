from pathlib import Path
from urllib.parse import urlsplit
import os
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
development_secret = 'local-development-only-key-change-before-deploy'
SECRET_KEY = os.environ.get('WORKSPACE_SECRET_KEY', development_secret)
DEBUG = os.environ.get('WORKSPACE_DEBUG', 'true').lower() == 'true'
ALLOWED_HOSTS = [host.strip() for host in os.environ.get('WORKSPACE_ALLOWED_HOSTS', '127.0.0.1,localhost').split(',') if host.strip()]
CSRF_TRUSTED_ORIGINS = [origin.strip() for origin in os.environ.get('WORKSPACE_CSRF_TRUSTED_ORIGINS', 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5175,http://localhost:5175,http://127.0.0.1:5183,http://localhost:5183,http://192.168.68.55:5175').split(',') if origin.strip()]

# Railway normally exposes RAILWAY_PUBLIC_DOMAIN, but it can be absent unless the
# system variable is explicitly referenced by the service. Recognise other URL
# variables and retain a Railway-only suffix fallback so generated domains work
# on first boot and after Railway changes the generated hostname.
railway_domains = set()
for variable_name in ('RAILWAY_PUBLIC_DOMAIN', 'RAILWAY_SERVICE_DOMAIN'):
    value = os.environ.get(variable_name, '').strip()
    if value:
        railway_domains.add(value.removeprefix('https://').removeprefix('http://').split('/')[0])
for variable_name in ('RAILWAY_STATIC_URL', 'RAILWAY_PUBLIC_URL'):
    value = os.environ.get(variable_name, '').strip()
    if value:
        railway_domains.add(urlsplit(value if '://' in value else f'https://{value}').netloc)

is_railway_runtime = bool(railway_domains) or any(name.startswith('RAILWAY_') for name in os.environ)
for railway_domain in railway_domains:
    if railway_domain and railway_domain not in ALLOWED_HOSTS:
        ALLOWED_HOSTS.append(railway_domain)
    railway_origin = f'https://{railway_domain}'
    if railway_domain and railway_origin not in CSRF_TRUSTED_ORIGINS:
        CSRF_TRUSTED_ORIGINS.append(railway_origin)
if is_railway_runtime:
    if '.up.railway.app' not in ALLOWED_HOSTS:
        ALLOWED_HOSTS.append('.up.railway.app')
    if 'https://*.up.railway.app' not in CSRF_TRUSTED_ORIGINS:
        CSRF_TRUSTED_ORIGINS.append('https://*.up.railway.app')

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
    'whitenoise.middleware.WhiteNoiseMiddleware',
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

# Railway's Postgres plugin (and most other managed Postgres providers) injects a single
# DATABASE_URL rather than discrete host/user/password vars - prefer it when present, fall
# back to the WORKSPACE_DB_* vars docker-compose sets, then to SQLite for local dev.
database_url = os.environ.get('DATABASE_URL', '').strip()
database_name = os.environ.get('WORKSPACE_DB_NAME')
if database_url:
    parsed_db_url = urlsplit(database_url)
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': parsed_db_url.path.lstrip('/'),
            'USER': parsed_db_url.username or '',
            'PASSWORD': parsed_db_url.password or '',
            'HOST': parsed_db_url.hostname or '',
            'PORT': str(parsed_db_url.port or '5432'),
        }
    }
elif database_name:
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
STATIC_ROOT = BASE_DIR / 'staticfiles'
STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage'},
}
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# The frontend build (`npm run build`) lands in dist/ - on Railway's single-service deploy
# (see Dockerfile.railway) WhiteNoise serves it straight from the Django process, so there's
# no separate nginx/static host to configure. Only wired up when the build actually exists,
# so a plain `manage.py runserver` checkout without a `dist/` folder still starts cleanly.
frontend_dist = BASE_DIR / 'dist'
if not DEBUG and frontend_dist.is_dir():
    WHITENOISE_ROOT = frontend_dist
    WHITENOISE_INDEX_FILE = True

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
