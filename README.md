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
npm run build
python manage.py test tasks
python manage.py check
python manage.py deliver_calendar_reminders
python manage.py deliver_webhooks
python manage.py run_automation
python manage.py purge_screen_captures
```

The consent, access, lifecycle, and frontend integration contract for screen sharing is in [`docs/screen-sharing-api-contract.md`](docs/screen-sharing-api-contract.md). A policy template for company review is in [`docs/screen-sharing-company-policy.md`](docs/screen-sharing-company-policy.md).

Workspace imports are documented in [`docs/import-api-contract.md`](docs/import-api-contract.md). The Import data page provides task, project, and stakeholder templates in Excel and CSV formats.
