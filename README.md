# ridez.io

Taxi booking application built with **React and JavaScript**, Vite, and Flask. This first implementation is the authentication and workspace foundation. It does not yet dispatch rides, calculate fares, collect payments, or show live maps.

## Run locally

Prerequisites: Node.js 20.19+ (22.12+ recommended), Python 3.12, and two terminals.

Backend, from the repository root:

```sh
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.lock
cd backend
.venv/bin/flask --app run db upgrade
.venv/bin/python run.py
```

Frontend, in a second terminal:

```sh
cd frontend
npm ci
npm run dev
```

Vite proxies `/api` to Flask on port 5000. The UI supports creating a rider or driver account, signing in, role-specific navigation, and viewing the stored profile/code. Drivers start pending approval. Admins cannot self-register; create one interactively with `.venv/bin/flask --app run create-admin` from `backend` after migrations. No demo passwords or seeded accounts are included.

Development defaults to SQLite and persists random local signing/code secrets under ignored `backend/instance/`. Never use these defaults as a production configuration. Access tokens remain in browser memory and expire after 15 minutes; reload/sign-out clears the client session. Refresh sessions and server-side logout revocation are still pending. The auth rate limiter is single-process development protection; replace it with shared Redis-backed limits before deployment.

## SQL Server and deployment

The SQLAlchemy model and Alembic migration support the SQL Server target. Set `DATABASE_URL` with the `mssql+pyodbc` dialect and install Microsoft ODBC Driver 18 before using SQL Server. Supply `JWT_SECRET` and `USER_CODE_SECRET` as distinct strong secrets through environment settings; see `backend/.env.example`. Files named `.env` are not automatically loaded. Outside development, set `APP_ENV=production`; database and secrets become mandatory. SQL Server connectivity/concurrency has not been validated in this instance. Do not treat the Flask development server as production hosting.

Run migrations with `.venv/bin/flask --app run db upgrade`. Never change existing account-code secrets without a migration plan. No database credentials belong in frontend variables. All business APIs must enforce permissions server-side.

## Validation

```sh
cd backend
.venv/bin/python -m pytest -q
cd ../frontend
npm run build
```

API specification: `/api/v1/openapi.json`; Swagger UI: `/api/v1/docs` (requires access to jsDelivr). Health: `/api/v1/health`. Backend tests currently exercise SQLite; they do not establish SQL Server transaction behavior.

## Product plan

- [Product blueprint](docs/PRODUCT_BLUEPRINT.md)
- [Screen flows](docs/SCREEN_FLOWS.md)

Next milestone: route-provider simulator, itemized quote, ride request, driver invitation/acceptance, trip progression, and one-time earnings allocation. Google integration and SQL Server validation require their configured services. Browser geolocation cannot guarantee background driver tracking.
