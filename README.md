# WorkSpace

WorkSpace is a team operations app for tasks, projects, calendar events, daily check-ins, chat, and follow-up work.

## Local development

Install the frontend and backend dependencies:

```powershell
npm install
python -m pip install -r requirements.txt
```

Run migrations and create a local admin account:

```powershell
python manage.py migrate
python manage.py createsuperuser
```

Start the API and frontend in separate terminals:

```powershell
python manage.py runserver 8000
npm run dev -- --host 0.0.0.0 --port 5175
```

Open `http://localhost:5175` to use the application. The Django administration site is at `http://localhost:8000/admin/`.

## Production configuration

Copy `.env.example` to a protected environment configuration and set a unique random `WORKSPACE_SECRET_KEY` of at least 50 characters. Set `WORKSPACE_DEBUG=false`, configure `WORKSPACE_ALLOWED_HOSTS` and `WORKSPACE_CSRF_TRUSTED_ORIGINS`, and use a production database and HTTPS reverse proxy before deployment. When HTTPS is active end to end, set `WORKSPACE_SECURE_SSL_REDIRECT=true`, `WORKSPACE_HSTS_SECONDS=31536000`, and enable the HSTS subdomain and preload flags only when those policies are appropriate for the domain.

The default local database is SQLite. PostgreSQL is supported for production by setting `WORKSPACE_DB_NAME`, `WORKSPACE_DB_USER`, `WORKSPACE_DB_PASSWORD`, `WORKSPACE_DB_HOST`, and `WORKSPACE_DB_PORT` in the environment.

For a containerized deployment, set `WORKSPACE_SECRET_KEY` and `WORKSPACE_DB_PASSWORD` in a protected `.env` file, then run:

```powershell
docker compose up --build
```

The web application will be available at `http://localhost:8080`. The compose setup keeps PostgreSQL data and uploaded task attachments in named volumes, serves authorized attachment downloads through the Django API, proxies `/api/` requests through Nginx to Django, accepts task uploads up to 10 MB, runs a reminder, webhook, and screenshot-retention worker every 60 seconds, and waits for the API health check before starting the web dependency.

## Optional integrations

These are all off by default - the app works exactly as before when none of the related variables are set.

- **Transactional email (Brevo)**: set `BREVO_SMTP_LOGIN` and `BREVO_SMTP_PASSWORD` (from Brevo > SMTP & API > SMTP) to send workspace invitation emails and task/calendar reminder emails. Without them, mail is printed to the console instead of sent. Also set `WORKSPACE_DEFAULT_FROM_EMAIL` and `WORKSPACE_FRONTEND_BASE_URL` (used to build the accept-invite link in the email).
- **Google Sign-In**: create an OAuth web client at [Google Cloud Console](https://console.cloud.google.com/apis/credentials), then set `GOOGLE_OAUTH_CLIENT_ID` (backend) and `VITE_GOOGLE_CLIENT_ID` (same value, frontend build) to show the "Sign in with Google" button.
- **Push notifications**: generate a keypair with `vapid --gen` (installed by `pywebpush`), then set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (backend) plus `VITE_VAPID_PUBLIC_KEY` (same public key, frontend build) and `VAPID_CLAIM_EMAIL`. Users then opt in from Settings > Notifications > "Push notifications" to get alerts even when the app/PWA is closed.
- **Error monitoring (Sentry)**: set `WORKSPACE_SENTRY_DSN` (backend) and the same DSN as `VITE_SENTRY_DSN` (frontend build) to ship uncaught errors and trace samples to Sentry. Leave the DSN blank to disable it entirely. Background jobs (`run_automation`, `deliver_webhooks`) and the email/push sends log delivery failures rather than swallowing them silently.

See `.env.example` for the full variable list.

## Security defaults

- **Login lockout**: repeated failed sign-ins are throttled by django-axes, keyed on IP
  address *and* username together, so one attacker cannot lock every account from a single
  address and a shared office IP does not lock out the whole team. Tune with
  `WORKSPACE_LOGIN_FAILURE_LIMIT` (default 5) and `WORKSPACE_LOGIN_COOLOFF_MINUTES`
  (default 15). A successful sign-in clears the counter. Axes is disabled while the test
  suite runs, because Django's test client authenticates without a request object; the
  tests that cover lockout re-enable it explicitly.
- **Session lifetime**: `WORKSPACE_SESSION_COOKIE_AGE` (default 7 days), measured from
  sign-in. The expiry is deliberately not rolled forward per request, because that writes
  the session on every request and the pulse endpoint is polled every 15 seconds per tab.
- **Rich text**: document and presentation HTML is sanitized with DOMPurify plus an app
  URL policy (`safeUrl`) that allows http(s), mailto, tel, relative links and base64 images
  only, and marks every link `noopener noreferrer`.

## Deploying to Railway

`railway.json` and `Dockerfile.railway` build the frontend and the Django API into one container - Django serves the built React app itself (via WhiteNoise) alongside `/api/`, so there's a single Railway service and no nginx or private networking to configure. `Dockerfile.api` / `Dockerfile.web` / `docker-compose.yml` are untouched and still work for a split frontend+nginx deployment elsewhere.

1. Create a Railway project from this repository. Railway detects `railway.json` and builds `Dockerfile.railway` automatically.
2. Add a **PostgreSQL** plugin to the project. Railway injects `DATABASE_URL` into the service automatically - `backend/settings.py` reads it directly, so no `WORKSPACE_DB_*` variables are needed on Railway.
3. Set these service variables (Project → Variables):
   - `WORKSPACE_SECRET_KEY` - a unique random value of at least 50 characters (`python -c "import secrets; print(secrets.token_urlsafe(64))"`).
   - `WORKSPACE_DEBUG=false`
   - `WORKSPACE_SECURE_SSL_REDIRECT=true`, `WORKSPACE_HSTS_SECONDS=31536000` once the Railway domain is serving HTTPS (it is, by default).

   `WORKSPACE_ALLOWED_HOSTS` and `WORKSPACE_CSRF_TRUSTED_ORIGINS` don't need to be set manually for Railway-generated `*.up.railway.app` domains. `backend/settings.py` reads Railway's domain variables when present and uses a Railway-runtime suffix fallback when they are not. Add the settings explicitly when attaching a custom domain.
4. Add a **Volume** mounted at `/app/media` if task attachments and profile photos should survive redeploys. If screen sharing is enabled, also mount durable private storage at `/app/private_media` (or set `WORKSPACE_PRIVATE_MEDIA_ROOT` to a protected persistent path). Screen captures deliberately use authenticated Django endpoints and a separate non-public storage root.
5. For background delivery, automation, and retention, add a Railway **Cron Job** on this same service running `python manage.py deliver_calendar_reminders && python manage.py deliver_webhooks && python manage.py run_automation && python manage.py purge_screen_captures` on a `* * * * *` schedule. The automation command is idempotent, `deliver_webhooks` drains the outbound webhook queue, and `purge_screen_captures` expires abandoned screen-sharing sessions and deletes screenshots after their configured retention.

Migrations run automatically on each deploy (`python manage.py migrate --noinput`, in the container's start command).

## Verification

```powershell
npm test
npm run build
python manage.py test tasks
python manage.py check
python manage.py deliver_calendar_reminders
python manage.py deliver_webhooks
python manage.py run_automation
python manage.py purge_screen_captures
```

Frontend tests run on Vitest with React Testing Library (`npm test`, or `npm run test:watch`
while developing). They use happy-dom rather than jsdom, because jsdom's dependency chain
requires `require(esm)` support that Node 20.17 does not have. One consequence worth
knowing: happy-dom does not implicitly submit a form when its submit button is clicked, so
tests covering an `onSubmit` handler should dispatch `fireEvent.submit(form)` instead.

The consent, access, lifecycle, and frontend integration contract for screen sharing is in [`docs/screen-sharing-api-contract.md`](docs/screen-sharing-api-contract.md). A policy template for company review is in [`docs/screen-sharing-company-policy.md`](docs/screen-sharing-company-policy.md).

Workspace imports are documented in [`docs/import-api-contract.md`](docs/import-api-contract.md). The Import data page provides task, project, and stakeholder templates in Excel and CSV formats.
