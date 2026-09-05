from datetime import timedelta
from pathlib import Path
from urllib.parse import urlsplit
import os
import sys
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
    'axes',
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
    # Must come last: it turns the PermissionDenied that AxesStandaloneBackend
    # raises for a locked-out login into the configured lockout response.
    'axes.middleware.AxesMiddleware',
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
PRIVATE_MEDIA_ROOT = Path(os.environ.get('WORKSPACE_PRIVATE_MEDIA_ROOT', BASE_DIR / 'private_media'))
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Upload ceilings. WORKSPACE_UPLOAD_MAX_BYTES is what the workspace file endpoint
# enforces per file; the Django limits below stop an oversized request from being
# buffered into memory before that check ever runs.
WORKSPACE_UPLOAD_MAX_BYTES = int(os.environ.get('WORKSPACE_UPLOAD_MAX_BYTES', 25 * 1024 * 1024))
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = WORKSPACE_UPLOAD_MAX_BYTES + (1024 * 1024)

# The frontend build (`npm run build`) lands in dist/ - on Railway's single-service deploy
# (see Dockerfile.railway) WhiteNoise serves it straight from the Django process, so there's
# no separate nginx/static host to configure. Only wired up when the build actually exists,
# so a plain `manage.py runserver` checkout without a `dist/` folder still starts cleanly.
frontend_dist = BASE_DIR / 'dist'
if not DEBUG and frontend_dist.is_dir():
    WHITENOISE_ROOT = frontend_dist
    WHITENOISE_INDEX_FILE = True

# Brute-force protection for the login endpoint. AxesStandaloneBackend must sit
# first so a locked-out attempt is refused before any password is checked; the
# ModelBackend behind it stays the only thing that actually authenticates.
AUTHENTICATION_BACKENDS = [
    'axes.backends.AxesStandaloneBackend',
    'django.contrib.auth.backends.ModelBackend',
]
# Lock on the IP and username together, so one attacker cannot lock every account
# from a single address, and a shared office IP does not lock out the whole team.
AXES_LOCKOUT_PARAMETERS = [['ip_address', 'username']]
AXES_FAILURE_LIMIT = int(os.environ.get('WORKSPACE_LOGIN_FAILURE_LIMIT', 5))
AXES_COOLOFF_TIME = timedelta(minutes=int(os.environ.get('WORKSPACE_LOGIN_COOLOFF_MINUTES', 15)))
AXES_RESET_ON_SUCCESS = True
AXES_LOCKOUT_TEMPLATE = None
AXES_VERBOSE = False
# Django's test client calls authenticate() without a request, which the axes
# backend rejects outright, so the suite runs with axes off and the tests that
# cover lockout turn it back on with override_settings(AXES_ENABLED=True).
AXES_ENABLED = os.environ.get('WORKSPACE_AXES_ENABLED', 'true').lower() == 'true' and 'test' not in sys.argv

# Session lifetime. Django's default is two weeks, which is longer than a team
# operations tool needs, so this halves it. Deliberately NOT paired with
# SESSION_SAVE_EVERY_REQUEST: rolling the expiry forward would write the session
# on every request, and the pulse endpoint is polled every 15 seconds by every
# open tab, so that turns a read-only probe into a write. The trade is that the
# week runs from sign-in rather than from last activity.
SESSION_COOKIE_AGE = int(os.environ.get('WORKSPACE_SESSION_COOKIE_AGE', 7 * 24 * 60 * 60))

# Transactional email (invitations, task/calendar reminders) via Brevo's SMTP relay.
# Falls back to the console backend (prints instead of sending) whenever credentials
# are not configured, so local dev and CI never attempt a real network send.
BREVO_SMTP_LOGIN = os.environ.get('BREVO_SMTP_LOGIN', '').strip()
BREVO_SMTP_PASSWORD = os.environ.get('BREVO_SMTP_PASSWORD', '').strip()
if BREVO_SMTP_LOGIN and BREVO_SMTP_PASSWORD:
    EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
    EMAIL_HOST = os.environ.get('BREVO_SMTP_HOST', 'smtp-relay.brevo.com')
    EMAIL_PORT = int(os.environ.get('BREVO_SMTP_PORT', '587'))
    EMAIL_HOST_USER = BREVO_SMTP_LOGIN
    EMAIL_HOST_PASSWORD = BREVO_SMTP_PASSWORD
    EMAIL_USE_TLS = True
else:
    EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'
EMAIL_SENDING_CONFIGURED = bool(BREVO_SMTP_LOGIN and BREVO_SMTP_PASSWORD)
DEFAULT_FROM_EMAIL = os.environ.get('WORKSPACE_DEFAULT_FROM_EMAIL', 'WorkSpace <no-reply@workspace.app>')

# Base URL of the deployed frontend, used to build links inside emails (invitations, etc).
FRONTEND_BASE_URL = os.environ.get('WORKSPACE_FRONTEND_BASE_URL', 'http://localhost:5173').rstrip('/')

# Google Sign-In: the OAuth web client ID from Google Cloud Console. The frontend needs
# the same value (as VITE_GOOGLE_CLIENT_ID) to render the button; this copy is what the
# backend checks the ID token's audience against.
GOOGLE_OAUTH_CLIENT_ID = os.environ.get('GOOGLE_OAUTH_CLIENT_ID', '').strip()

# Web push (browser notification bubbles even when the app/PWA is closed). Generate a
# keypair once with `vapid --gen` (installed by pywebpush) and keep the private key secret.
VAPID_PUBLIC_KEY = os.environ.get('VAPID_PUBLIC_KEY', '').strip()
VAPID_PRIVATE_KEY = os.environ.get('VAPID_PRIVATE_KEY', '').strip()
VAPID_CLAIM_EMAIL = os.environ.get('VAPID_CLAIM_EMAIL', 'admin@workspace.app').strip()
WEB_PUSH_CONFIGURED = bool(VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)

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
