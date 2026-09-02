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

Copy `.env.example` to a protected environment configuration and set a unique random `WORKSPACE_SECRET_KEY`. Set `WORKSPACE_DEBUG=false`, configure `WORKSPACE_ALLOWED_HOSTS`, and use a production database and HTTPS reverse proxy before deployment.

The default local database is SQLite. PostgreSQL is recommended for production by adding a PostgreSQL database configuration in `backend/settings.py` and supplying its connection values through environment variables.

## Verification

```powershell
npm run build
python manage.py test tasks
python manage.py check
```
