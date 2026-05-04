# PiAQ

PiAQ is an indoor air-quality monitoring system built around a Raspberry Pi sensor node, a Node/PostgreSQL backend, and a React dashboard. The Pi samples environmental sensors, summarizes readings into time windows, uploads them to the backend, and the web app turns that data into live cards, historical charts, alerts, and optional email notifications.

The project is meant to answer a practical question: what is happening in a room's air right now, how has it changed over time, and when should someone take action?

## What It Measures

The Raspberry Pi code supports these sensors:

- SCD40 for CO2, temperature, and humidity.
- SGP40 for VOC index readings, using temperature/humidity compensation when available.
- PMS5003 for particulate matter: PM1.0, PM2.5, and PM10.

The Pi collects raw samples every few seconds, rolls them into upload windows, and sends summarized values such as averages, maximums, sample count, and timestamps to the backend.

## System Overview

```text
Raspberry Pi sensors
        |
        | I2C / UART
        v
Python collector and uploader
        |
        | HTTP JSON
        v
Node / Express backend
        |
        | PostgreSQL
        v
React dashboard
```

The backend stores registered devices, sensor readings, alert rules, alert history, email alert settings, and device sync state. The frontend reads that API to show the dashboard, history views, active alert banners, and alert-email configuration.

## Features

- Live dashboard for AQI, PM2.5, PM10, CO2, VOC, temperature, and humidity.
- Historical charts over configurable time windows.
- Device registration, heartbeats, and batched reading ingest.
- Alert rules with active/resolved alert tracking.
- Combined alert emails with the triggered sensor list and a snapshot of all current readings.
- Email confirmation before alerts can be sent to a recipient.
- User-configurable repeat interval for alert emails while a sensor remains above threshold.
- Test alert email flow for demos and validation.
- Optional AI insights panel in the frontend when an OpenAI-compatible proxy is configured.

## Deployed App

The deployed dashboard is available at:

```text
https://piaq.pages.dev
```

To use it:

1. Open the deployed site.
2. Select a device from the device dropdown.
3. Use the dashboard tab for current readings.
4. Use the history tab to compare readings over time.
5. Use the alerts tab to configure an alert email, confirm the inbox, choose a repeat interval, and send a test alert.

For the final proof of concept, email delivery can use Resend's development sender:

```env
ALERT_EMAIL_FROM=PiAQ Alerts <onboarding@resend.dev>
```

That keeps the alert workflow demoable without requiring a verified production email domain.

## Running Locally

### Prerequisites

- Node.js and npm.
- PostgreSQL.
- Python 3 on the Raspberry Pi.
- Raspberry Pi hardware with the supported sensors connected.
- A Resend API key if testing email alerts.
- An OpenAI API key if using AI insights.

### Backend

Create `backend/.env` from `backend/.env.example` and fill in database settings:

```env
PORT=5000
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=piaq
DB_USER=postgres
DB_PASSWORD=your_password_here
DB_SSL=false

ALERT_EMAIL_ENABLED=true
ALERT_EMAIL_FROM=PiAQ Alerts <onboarding@resend.dev>
RESEND_API_KEY=your_resend_api_key
API_BASE_URL=http://localhost:5000
```

Install, migrate, optionally seed demo data, and start the API:

```powershell
cd backend
npm install
npm run migrate
npm run seed:demo
npm run dev
```

Useful checks:

```powershell
Invoke-RestMethod http://localhost:5000/health
Invoke-RestMethod http://localhost:5000/system/health
Invoke-RestMethod http://localhost:5000/devices
```

### Frontend

Set `frontend/.env` to point at the backend and AI proxy:

```env
VITE_API_URL=http://localhost:5000
VITE_OPENAI_API_URL=https://piaq-openai-proxy.<account>.workers.dev/v1/chat/completions
```

Then run:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL, usually:

```text
http://localhost:3001
```

### Cloudflare Worker (OpenAI proxy)

The frontend cannot call OpenAI directly because of browser CORS, so a Worker proxy is required.

```powershell
cd cloudflare-worker
npm install -g wrangler
wrangler login
wrangler secret put OPENAI_API_KEY
wrangler deploy
```

Update `cloudflare-worker/wrangler.toml` if you need to change `ALLOWED_ORIGIN`, then deploy.
After deploy, set `VITE_OPENAI_API_URL` to the Worker URL (shown in the deploy output).

### Raspberry Pi Collector

Install Python dependencies on the Pi:

```bash
cd raspberryPi
pip install -r requirements.txt
```

Update `raspberryPi/config.py`:

```python
SERVER_URL = "http://your-backend-host:5000"
DEVICE_ID = "pi-001"
LOCATION_LABEL = "Engineering Lab"
```

Run the collector:

```bash
python main.py
```

The Pi will register itself, send heartbeat requests, buffer samples, and upload summarized sensor windows to `POST /ingest/batch`.

## API Surface

Core routes:

- `GET /health`
- `GET /system/health`
- `GET /devices`
- `POST /devices/register`
- `POST /devices/:deviceId/heartbeat`
- `GET /devices/:deviceId/latest`
- `GET /devices/:deviceId/history`
- `GET /devices/:deviceId/alerts`
- `GET /devices/:deviceId/rules`
- `PUT /devices/:deviceId/rules`
- `POST /ingest/batch`

Alert email routes:

- `GET /devices/:deviceId/alert-email`
- `PUT /devices/:deviceId/alert-email`
- `POST /devices/:deviceId/alert-email/request-confirmation`
- `GET /devices/:deviceId/alert-email/confirm?token=...`
- `POST /devices/:deviceId/alert-email/test`

## Security Notes

PiAQ is built as a project/demo system, but it includes several practical safeguards:

- Secrets live in `.env` files and are not committed.
- Email recipients must confirm ownership before alerts are enabled.
- Confirmation tokens are randomly generated, hashed before storage, and expire.
- Alert emails are only sent to verified recipients.
- Backend request validation uses `express-validator`.
- PostgreSQL constraints protect reading windows, alert statuses, and repeat interval bounds.
- Optional database SSL can be enabled with `DB_SSL=true`.
- Alert email repeat intervals reduce accidental email flooding.

Current limitations:

- There is no user login system yet.
- Raspberry Pi ingest does not currently use per-device API keys.
- Resend's `onboarding@resend.dev` sender is appropriate for proof-of-concept testing, not production mail delivery.

## Dependencies

Backend:

- Express for the API server.
- PostgreSQL and `pg` for persistence.
- `dotenv` for environment configuration.
- `express-validator` for request validation.
- `cors` for local and deployed frontend access.

Frontend:

- React and Vite.
- Tailwind CSS.
- Recharts for charting.
- lucide-react for icons.
- date-fns for date handling.
- OpenAI (via Worker proxy) for optional AI insights.
- Vitest and Testing Library for tests.

Raspberry Pi:

- `requests` for HTTP upload.
- `pyserial` for UART sensor communication.
- Adafruit Blinka and CircuitPython sensor libraries for hardware access.

External services:

- PostgreSQL for cloud/server-backed storage.
- Resend for email alert delivery.
- OpenAI (via Cloudflare Worker proxy) for optional insight generation.

## Testing

Backend:

```powershell
cd backend
npm test
```

Frontend:

```powershell
cd frontend
npm run lint
npm run test:run
npm run build
```

## Project Status

The main sensor-to-dashboard path is implemented:

```text
sensor readings -> Pi uploader -> backend ingest -> PostgreSQL -> dashboard and alerts
```

The email alert pipeline is also implemented as a proof of concept:

```text
user enters email -> confirmation email -> verified recipient -> test/real alert email
```

Production hardening would focus on authentication, per-device ingest keys, a verified sender domain, and more deployment automation.
