# ridez.io

Taxi booking application built with **React and JavaScript**, Vite, and Flask. Includes mobile/password authentication, role workspaces, and a complete **development ride simulator**: quote → booking → driver invitation → acceptance → pickup → trip → earnings allocation. No live dispatch, GPS, Google Maps, or payment processing yet.

## Run locally

Prerequisites: Node.js 20.19+ (22.12+ recommended), **Python 3.12**, and two terminals. Python 3.14 is not supported by the pinned pyodbc wheel; use 3.12 to avoid compiling it.

### Windows PowerShell

From the repository root (the folder containing `backend` and `frontend`):

```powershell
py -3.12 -m venv backend\.venv312
.\backend\.venv312\Scripts\python.exe -m pip install -r backend\requirements.lock
cd backend
.\.venv312\Scripts\python.exe -m flask --app run db upgrade
.\.venv312\Scripts\python.exe run.py
```

In a second PowerShell terminal, from the repository root:

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

Open **http://localhost:5173** for the website. Port 5000 is the backend API; its root URL intentionally returns a JSON 404. `npm.cmd` avoids PowerShell script execution-policy issues. Virtual-environment activation is not required.

To update an existing installation, stop both servers, run `git pull --ff-only` from the repository root, run the dependency install and `flask ... db upgrade` commands again, and restart both servers. Keep your existing virtual environment; creation is only necessary on the first run. Local accounts are preserved by migrations.

### Linux / macOS

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

Vite proxies `/api` to Flask on port 5000. An optional `API_PROXY_TARGET` process variable changes the local proxy destination. Drivers start pending approval. Admins cannot self-register; create one interactively from `backend` after migrations:

```powershell
# Windows
.\.venv312\Scripts\python.exe -m flask --app run create-admin
```

```sh
# Linux / macOS
.venv/bin/flask --app run create-admin
```

Choose your own admin mobile/password in the prompts. No demo passwords or seeded accounts are included.

## Try one complete simulated ride

1. Register a rider and a driver. Create an admin with the command above.
2. Use separate browsers or private browser windows for the three roles. Sign in as admin and approve the driver with a review reason.
3. Sign in as driver and click **Go available** before the rider books. Keep the driver page open.
4. Sign in as rider, enter two different places, and review an estimate. Rates are sample data: ₹40 base + ₹12/km + ₹2/min, with no surge, taxes or fees. Distances/durations are deterministic simulated values, not geocoded routes.
5. Confirm the simulated ride. The driver has **30 seconds** to accept, then selects **Head to pickup → I’ve arrived → Start trip → Complete trip**. The rider sees updates through two-second polling.
6. Review ride history and driver earnings. Completion records one 85/15 allocation using decimal arithmetic. No payment or transfer occurs. Driver ends offline and chooses when to go available again.

The quote expires after five minutes. Retrying a booking with the same quote returns the same ride. One active ride per participant is enforced through unique database claims. Pending invitations are limited to drivers already approved and available when booking occurs. Searching requests can be cancelled; assigned and in-progress cancellations/incident handling are deferred.

This slice uses one 30-second round with all eligible simulator drivers, without location/radius filtering. Expiry is reconciled on workspace reads and ride actions; polling drives timely display, not a durable background scheduler. GPS freshness, radius expansion, worker recovery and Socket.IO are the next milestone. Set `SIMULATOR_ENABLED=0` to block new simulator quotes/bookings/availability/acceptances; existing assigned rides can still be progressed to completion. The simulator defaults off outside development.

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

Verified on SQLite: authentication and role checks, quote ownership/expiry, repeat booking/completion, invalid transitions, cancellation and invitation expiry, simultaneous drivers accepting one ride, and simultaneous rides competing for one driver. These checks do not establish SQL Server concurrency behavior. Browser checks cover admin approval through rider completion/driver earnings, persisted history after re-login, and mobile layout.

Next milestone: location permissions, 30-second GPS updates, stale-location exclusion, 500 m / 30 s expanding matching rounds, background processing, and realtime recovery. Google integration and SQL Server validation require configured services. Browser geolocation cannot guarantee background driver tracking.
