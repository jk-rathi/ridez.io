# Deploy ridez.io on Render

This repository includes a Render Blueprint (`render.yaml`) for **one Docker web service**. It serves the compiled React website, Flask APIs and Socket.IO from the same HTTPS origin. Gunicorn runs one threaded worker and starts the persisted matching loop. Render supplies TLS and process supervision.

The initial deployment uses SQLite on a persistent disk at `/var/data/ridez.db`. This is suitable for a single-instance pilot. The disk requires a paid Render instance; the Blueprint selects Starter and a 1 GB disk. Review Render's current price before creating it. Do not use an ephemeral/free instance for this database. Do not scale horizontally or add Gunicorn workers: the current in-process matching, socket delivery and rate limiters require one process. Production traffic capacity and SQL Server concurrency are separate validation gates.

## First deployment

1. Open Render and select **New → Blueprint**, connect GitHub, and select `jk-rathi/ridez.io` on `main`. Render reads the root `render.yaml`. Review the plan and disk before creating resources. Alternatively create a Docker Web Service manually using the settings below.
2. Supply these two values securely in Render's environment settings:
   - `GOOGLE_MAPS_SERVER_KEY`: server-only Google key with **Routes API** enabled.
   - `VITE_GOOGLE_MAPS_BROWSER_KEY`: browser-public key with **Maps JavaScript API** and **Places API (New)** enabled.
   The Docker build reads `VITE_...` values as build arguments. Render makes service environment variables available as Docker build arguments when the Dockerfile declares them. Only the browser key belongs in a `VITE_` variable; never put server/database credentials there. Browser key changes require rebuilding the service.
3. Keep the generated `JWT_SECRET` and `USER_CODE_SECRET` values. Render generates them independently. Keep both stable across deploys; changing the code secret changes fixed rider OTP derivation. Do not put secrets in Git or share them in chat.
4. Deploy. The image builds the frontend and installs locked Python dependencies. At runtime, after Render attaches the disk, `start.sh` initializes its directory ownership, drops to the application user, applies migrations and starts Gunicorn on Render's `PORT` (default 10000). Do not move SQLite migrations into a build/pre-deploy command: the persistent disk is needed at runtime. Failed migrations stop startup.
5. Once healthy, open the assigned `https://…onrender.com` address. Add **that exact origin** to the browser key's allowed website referrers, including `https://your-service.onrender.com/*`. Keep local referrers if still needed. For a custom domain, add its exact HTTPS referrer too. Configure the server key's IP restrictions for Render's published outbound IP addresses/ranges, rather than your local computer's IP. Keep Google billing and quotas configured.
6. In the Render service's **Shell**, create the first admin interactively:
   ```sh
   gosu ridez python -m flask --app wsgi create-admin
   ```
   The image initializes disk ownership as root, then runs the web process as `ridez`. Use `gosu ridez` for commands in Render Shell too. No accounts or default passwords are seeded. Local development accounts are not automatically uploaded.

The Blueprint sets:

| Setting | Value |
| --- | --- |
| Runtime | Docker; root `Dockerfile`; repository root build context |
| Instance count | 1 |
| Health check | `/api/v1/ready` |
| Persistent disk | `/var/data`, 1 GB |
| Database | `sqlite:////var/data/ridez.db` |
| `APP_ENV` | `production` |
| `TRUST_PROXY_HEADERS` | `1` (Render's trusted TLS proxy only) |
| `ROUTE_PROVIDER` | `google` |
| `SIMULATOR_ENABLED` | `0` |
| Automatic deploys | Disabled; deploy reviewed updates manually |

For a manual Web Service, create the disk and set every environment variable shown in `render.yaml`, including distinct random secrets of at least 32 characters. Leave Build/Start commands at the Dockerfile defaults. Render terminates HTTPS; do not configure a separate frontend Static Site or CORS. The app preserves the incoming Host and trusts one proxy for forwarded protocol/client IP. Enable `TRUST_PROXY_HEADERS` only behind the trusted proxy.

## Check the deployment

- `/` and a direct reload of `/rider/history` load the website. `/api/v1/health` responds; `/api/v1/ready` must return HTTP 200 with `database: true` and `matching_worker: true`. Readiness returns 503 when the schema is outdated, the database is inaccessible or the loop stalls. It does not make billable Google calls and does not establish Google key readiness.
- Register a rider and driver in separate browser sessions. Sign in as admin and approve the driver. Check fresh GPS availability, Google address search, quote, acceptance, pickup, fixed rider OTP, completion, earnings and rider receipt privacy.
- Refresh the page and confirm sign-in is restored. Check logout, all-device logout, suspension and reinstatement. The Socket.IO connection should reach WebSocket transport, with API polling retained as fallback.
- Restart the service and confirm accounts, fixed rider OTPs, trips and sessions persist. Test Google routing with your real keys; local container checks use explicit simulator mode and do not validate live billing, quotas or routes.

If you only want a labelled demonstration without Google, explicitly change `ROUTE_PROVIDER=simulator` and `SIMULATOR_ENABLED=1` in Render. This enables sample route/fare data, not live Google routing. The default Blueprint keeps Google mode and disables the simulator.

## Updates, backups and recovery

1. Create a backup before deploying a schema change. In Render Shell:
   ```sh
   gosu ridez python backup.py /var/data/backups/ridez-before-update.db
   ```
   Choose a new filename for every backup. The command uses SQLite's consistent backup API and checks integrity; it refuses to overwrite files. Keep sufficient disk space, remove old retained backups deliberately and download copies off the same disk using Render's supported SSH/file-transfer access. A backup stored only on the same disk is not disaster recovery.
2. Review Render's managed disk snapshot/restore options and rehearse recovery on a separate staging service. Never replace a live SQLite database while Gunicorn is writing it. Restore the database and its matching secrets together; retain `JWT_SECRET` and `USER_CODE_SECRET` securely outside the service as part of recovery planning.
3. Select **Manual Deploy → Deploy latest commit** after tests pass. The disk persists; migrations rerun safely before the server accepts traffic. A disk-backed, single-instance deploy can interrupt active connections. Clients resync using persisted rides/deadlines after restart. Schedule a quiet period for schema changes.
4. Rolling back an image does not automatically roll back its database. Use a schema-compatible commit or a rehearsed database restore; do not blindly downgrade migrations. The suspension migration intentionally refuses downgrade while drivers are suspended.

To import an existing local installation, first make a consistent backup of its database and securely preserve its signing/code secrets. Transfer the backup to the disk through supported Render access while the app is stopped, set the corresponding secrets securely and run migrations. Simply uploading code creates a new installation; it does not transfer local accounts or Google configuration.

## Runtime limits

This deployment packages the current app for Render; it does not add payment processing, recovery/incident policies, multi-instance operation or a production load guarantee. The in-process rate limits remain bounded to one process and reset on restart. Add shared rate limiting and a broker/worker ownership model before scaling. Protect database exports, maintain backups, configure Google quotas and monitor readiness/errors.

The default image includes the unixODBC runtime for the pinned pyodbc dependency, but **does not install Microsoft ODBC Driver 18**. Do not change `DATABASE_URL` to SQL Server without adding that driver to a reviewed image and completing SQL Server migration/concurrency tests. No SQL Server validation or managed database provisioning is implied by this Blueprint.

## Local verification of the deployment image

```sh
docker build -t ridez:local .
python deploy/smoke.py --image ridez:local
```

The smoke test creates its own temporary database volume and random test secrets, checks the actual production image, restarts it, verifies login/OTP persistence and logout revocation, then removes only its own test container and volume. In the managed cloud environment, builds use its required proxy/CA settings; normal Render builds use their platform trust store. CI runs the backend tests, frontend build, Docker build and image smoke test without Google credentials.
