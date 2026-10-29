# ridez.io

Taxi booking application built with **React and JavaScript**, Vite, and Flask. Includes mobile/password authentication, role workspaces, GPS driver presence, expanding-radius matching, authenticated Socket.IO updates, and a complete development ride flow: quote → booking → driver invitation → acceptance → pickup → trip → earnings allocation. Routes and fares still use clearly labeled sample data; Google Maps and payment processing are not connected.

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

Vite proxies `/api` and `/socket.io` (including WebSockets) to Flask on port 5000. An optional `API_PROXY_TARGET` process variable changes the local proxy destination. Start the backend with **`python run.py`** as shown above: it starts Socket.IO and the background matching loop. `flask run` does not start the matching worker. Drivers start pending approval. Admins cannot self-register; create one interactively from `backend` after migrations:

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
3. Sign in as driver, click **Go available**, and allow location access. Keep the tab open. A fresh location with accuracy within 200 m is required; stale locations older than 90 seconds cannot match or accept. Location is sent immediately and approximately every 30 seconds while available or on a trip. Offline/sign-out stops collection; permission revocation attempts to go offline without cancelling an active trip.
4. Sign in as rider, enter two different place labels, then use **Use my location** or enter the actual pickup latitude/longitude. These coordinates determine driver distance; the labels are not geocoded. For a quick test, use the driver's area as pickup so they are within 500 m. Review an estimate. Rates remain sample data: ₹40 base + ₹12/km + ₹2/min, without surge, taxes or fees; distances/durations are simulated.
5. Confirm the ride. Search starts at **500 m**, expands **500 m every 30 seconds**, and defaults to a **5 km maximum** (ten rounds / five minutes). Each newly eligible driver gets one invitation per ride. Accept within the invitation deadline, then select **Head to pickup → I’ve arrived → Start trip → Complete trip**. Socket.IO pushes state invalidations; the client fetches authoritative state on events/reconnect and periodically reconciles via API. If the socket is unavailable, two-second polling continues.
6. Review ride history and driver earnings. Completion records one 85/15 allocation using decimal arithmetic. No payment or transfer occurs. Driver ends offline and chooses when to go available again.

The quote expires after five minutes. Retrying a booking with the same quote returns the same ride. One active ride per participant is enforced through unique database claims. Newly available drivers can be invited in subsequent rounds if fresh and in range, but a driver is never repeatedly invited for the same ride. Searching requests can be cancelled; assigned and in-progress cancellations/incident handling are deferred.

Matching deadlines, round history, invitations, and outgoing events are persisted in the database. A one-second background loop advances overdue rounds and marks stale locations even without API traffic. After a restart it catches up to persisted deadlines, skips invitations for already-expired rounds, and resumes pending event delivery. Events can be retried; clients deduplicate IDs and fetch current state. Matching/acceptance use conditional writes and unique participant claims. Final timeout releases the rider's active claim. Set `MATCH_MAX_RADIUS_M` to a 500 m increment between 500 and 10000 to change the search limit. `SIMULATOR_ENABLED=0` blocks new sample quotes/bookings/online availability/acceptances; going offline and completing assigned rides remain possible. The simulator defaults off outside development.

### Location troubleshooting

Browser geolocation requires **HTTPS or localhost**. Allow site location access and enable OS location services. A coarse fix worse than 200 m, stale timestamp, implausible jump, or permission denial is rejected with a visible error. If your desktop cannot obtain a precise fix, use Chrome/Edge DevTools → More tools → Sensors to set a custom test location, and enter matching pickup coordinates in the rider form. This overrides only that browser's reported test position; it does not provide a real GPS service. Production background tracking will require a native/mobile implementation because browsers throttle hidden tabs.

The backend keeps only the latest driver location, not a tracking history. Ordinary users cannot write another driver's location or subscribe to arbitrary rooms. Admin views show freshness/accuracy without exposing precise location coordinates. Invitation/ride details are scoped to their participants and admins.

Development defaults to SQLite and persists random local signing/code secrets under ignored `backend/instance/`. Never use these defaults as a production configuration. Access tokens remain in browser memory and expire after 15 minutes; reload/sign-out clears the client session. Refresh sessions and server-side logout revocation are still pending. The auth rate limiter is single-process development protection; replace it with shared Redis-backed limits before deployment.

## SQL Server and deployment

The SQLAlchemy models and Alembic migrations target SQL Server. Set `DATABASE_URL` with the `mssql+pyodbc` dialect and install Microsoft ODBC Driver 18 before using SQL Server. Supply `JWT_SECRET` and `USER_CODE_SECRET` as distinct strong secrets through environment settings; see `backend/.env.example`. Files named `.env` are not automatically loaded. Outside development, set `APP_ENV=production`; database and secrets become mandatory. SQL Server connectivity/concurrency has not been validated in this instance. Do not treat the Flask development server as production hosting.

Current realtime/worker runtime is **one server process**, intentionally avoiding a separate Redis install for local Windows development. Do not run multiple API workers/instances with this in-process socket dispatcher: production scaling needs a shared message broker, worker ownership, proper process supervision, SQL Server integration tests, and a production Socket.IO server. `/api/v1/health` reports `matching_worker: true` after successful background ticks; false means the loop has not started or is failing/stalled. Delivered outbox records are pruned after seven days. Undelivered events remain for retry.

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

Verified on SQLite: authentication and role checks, quote ownership/expiry, repeat booking/completion, invalid transitions, cancellation and invitation expiry, simultaneous drivers accepting one ride, and simultaneous rides competing for one driver. New checks cover coordinate/time validation, replay and implausible movement, 90-second freshness, radius expansion, no repeat invitations, idempotent deadline recovery without HTTP traffic and from a new app instance, socket access/expiry, and outbox retries. These checks do not establish SQL Server concurrency behavior. Browser checks cover GPS permission, immediate and 30-second reports, revocation going offline, denial blocking availability, fresh availability, actual WebSocket notifications, admin approval through rider completion/earnings, persisted history after re-login, and mobile layout.

Next milestone: Google maps/routes, real road distance and traffic-aware estimates, configurable fare rules and surge caps. Google integration and SQL Server validation require configured services. Account recovery, refresh/revocation, cancellation/incident policies, and production operations remain pending.
