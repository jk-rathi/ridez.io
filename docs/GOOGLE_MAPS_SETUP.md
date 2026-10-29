# Google Maps and live routes — Windows setup

Use two separate keys: a browser-restricted key for Maps JavaScript API, and a server-only key restricted to Routes API. This release uses map clicks or explicit coordinates; Places autocomplete and address geocoding are not included and do not need to be enabled.

## Update the application

Stop both servers. From the repository root:

```powershell
git pull --ff-only
cd backend
.\.venv312\Scripts\python.exe -m pip install -r requirements.lock
.\.venv312\Scripts\python.exe -m flask --app run db upgrade
```

Use your existing Python 3.12 environment. Migrations preserve existing users, trips, and allocations. Legacy quotes remain labeled simulator records.

## Configure the backend

From `backend`, create the local file only if it does not already exist:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

Set these entries in that file using your own server key:

```dotenv
ROUTE_PROVIDER=google
GOOGLE_MAPS_SERVER_KEY=your_server_key_here
```

Save and close Notepad. `backend/.env` is loaded automatically at startup; existing process environment variables take precedence. Never put the server key in frontend files, `VITE_` variables, screenshots, chat, or Git. Development signing/account-code secrets continue to use existing local files if their environment entries are empty.

Start the backend:

```powershell
.\.venv312\Scripts\python.exe run.py
```

Google requests use HTTPS `routes.googleapis.com`, the server key in a request header, a restricted response-field mask, and connection/read timeouts. Redirects are not followed. A Google failure produces an explicit error; it never falls back to a simulated fare. The server does not log provider bodies/keys or persist the raw route response/polyline. Quotes retain numeric route metrics, pricing components, rule version, and surge reasons. Verify provider terms and retention obligations for your deployment.

## Configure the frontend

In a second terminal, from `frontend`:

```powershell
npm.cmd ci
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
notepad .env.local
```

Set your browser key:

```dotenv
VITE_GOOGLE_MAPS_BROWSER_KEY=your_browser_key_here
```

This key is public in the browser by design: restrict it to Maps JavaScript API and your allowed website referrers, including `http://localhost:5173/*` and `http://127.0.0.1:5173/*`. It must be different from the server key. The map uses Advanced Markers with Google's `DEMO_MAP_ID` for development; optionally set `VITE_GOOGLE_MAP_ID` to your own map ID before production. Do not use an unrestricted browser key.

Start Vite after saving the file:

```powershell
npm.cmd run dev
```

Restart Vite after any frontend environment changes. Open `http://localhost:5173`.

## Test your Google project

1. Sign in as rider. The banner should say **Google routes**.
2. On the map choose **Pickup**, then click a road location. Choose **Destination**, then click a different reachable location. **Use my location** can fill pickup instead. Labels can be edited, but do not change the chosen coordinates.
3. Select **Get fare estimate**. Check the route line, road distance, estimated duration, and itemized fare. Google travel time is an estimate, not a guaranteed arrival time. A route across disconnected areas may correctly return no driving route.
4. Use a nearby approved available driver to confirm a ride and test the existing lifecycle. The quoted fare remains fixed even if settings change later. Fresh route geometry remains in memory for current-session display; after re-login/reload the active-trip map shows endpoint markers without fetching another paid route automatically.
5. Sign in as admin and open **Settings**. Configure base/per-km/per-minute/minimum rates, timezone, surge cap, traffic/demand rules, and circular zone schedules. Enter a reason and save. Review the version history. These settings apply only to new quotes.

Initial rates are development defaults, not approved commercial fares. Fare calculation rounds distance and prorated time components to two decimals, applies a minimum adjustment, then applies the **highest eligible** surge multiplier capped at the configured maximum. Components sum to the total. Traffic surge compares Google duration against static duration; missing traffic data never triggers traffic surge. Demand uses open searching rides and fresh available drivers within 1 km; at least the configured minimum requests must exist. A zero-driver denominator is treated as one. Overnight schedules belong to the weekday on which the window starts; equal start/end means all day. Global surge can be paused.

No taxes, tips, discounts, cancellation fees, or gateway fees are added in this milestone. Confirm those policies before launch.

## Troubleshooting

- **Map access denied:** check Maps JavaScript API, browser-key referrers, project billing and quotas. Changes can take time to propagate.
- **Route access denied:** check Routes API, the server key's API/IP restrictions, and billing. IP restrictions must match the backend's actual public outbound IP, not `127.0.0.1` or a private LAN address.
- **Quota reached:** inspect Google API quota/usage; requests may be billable. Budgets send alerts and do not impose an automatic spending cap. Set conservative API quotas where supported.
- **Timeout/unavailable:** retry later. No quote is created from an invalid provider response.
- **Simulator banner:** confirm `ROUTE_PROVIDER=google` in `backend/.env`, check for an overriding process variable, and restart Flask.
- **No map after changing key:** restart Vite and reload. The browser key is read by Vite, not Flask.
- **Location permission error:** use HTTPS or localhost; allow browser/OS location access.

Keep both local environment files private. They are ignored by Git; `.env.example` contains placeholders only. To test offline intentionally, choose `ROUTE_PROVIDER=simulator` and `SIMULATOR_ENABLED=1`, restart Flask, and generate a new quote. Existing quotes cannot silently switch route provider.

## Validation boundaries

Cloud tests use explicit HTTP/browser provider fixtures, not your Google credentials or live billing account. They verify request shape, response parsing, failure handling, pricing, role checks, immutable snapshots, and the UI workflow. Live key restrictions, billing, actual Google map tiles, and real route estimates must be verified with your local keys using the steps above. SQL Server integration and production deployment remain separate checks.
