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

The web application will be available at `http://localhost:8080`. The compose setup keeps PostgreSQL data and uploaded task attachments in named volumes, serves `/media/` through Nginx, and proxies `/api/` requests through Nginx to Django.

## Verification

```powershell
npm run build
python manage.py test tasks
python manage.py check
```
