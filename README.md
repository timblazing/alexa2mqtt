# Amazon Air Quality to MQTT

A Home Assistant App (add-on) that connects **Amazon Smart Air Quality Monitors** to Home
Assistant via **MQTT** — no Homebridge required.

> **Status: Phase 3 / pre-alpha.** Authentication, raw state queries, MQTT discovery,
> all 10 entities, retained measurements, connectivity diagnostics, and restart recovery were
> validated against a real monitor and Home Assistant instance on August 6, 2026. The app is
> now packaged as a locally built Home Assistant app; images are not published yet. See
> [`plan.md`](plan.md).

## Install as a Home Assistant app

1. Put this repository somewhere Home Assistant can reach it (a Git remote, or clone it into
   `/addons` on the Home Assistant host).
2. **Settings → Add-ons/Apps → Apps page → ⋮ → Repositories**, add the repository URL, and
   reload. Skip this step for a clone in `/addons`.
3. Install **Amazon Air Quality to MQTT** and start it. Supervisor builds the image locally
   from [`app/Dockerfile`](app/Dockerfile); the first build takes a few minutes.
4. Open the Web UI and follow the Amazon login link on port 8098 of the Home Assistant host.

Full app documentation lives in [`app/DOCS.md`](app/DOCS.md).

## What it will do

- Authenticate with your Amazon account using the same proxy-login flow as
  [homebridge-alexa-smarthome](https://github.com/joeyhage/homebridge-alexa-smarthome)
  (no password stored in the app config).
- Discover your Amazon Smart Air Quality Monitor(s) and poll Alexa's API for raw values:
  IAQ score (0–100), temperature, humidity, PM2.5, PM10, CO (ppm), and VOC index.
- Publish one Home Assistant MQTT device per monitor using MQTT device discovery, with
  retained last-known values that survive Amazon outages and restarts.
- Run as a proper Home Assistant App: start on boot, watchdog, and auto-update via
  versioned GHCR images.

## Caveats

- Uses Amazon's **unofficial** Alexa API — Amazon can break it at any time.
- Cloud-derived CO readings are **not** a substitute for a certified local CO alarm.

## Development

Requires Node.js 22 or newer. From `app`:

```sh
npm install
cp .env.example .env
npm run dev
```

`npm run dev` loads `.env` when it exists and serves the status page on
`http://localhost:8099/` (`STATUS_PORT` overrides the port, `/healthz` reports MQTT
connectivity). Set `ALEXA_PROXY_HOST` to an IP address reachable
by the browser you will use to sign in, and point `MQTT_HOST` (plus optional credentials) at
an MQTT broker used by Home Assistant. The bridge prints the Amazon login URL when needed,
persists authentication to `data/auth.json`, and publishes one retained MQTT device-discovery
payload per monitor.

Valid readings are merged into `data/last-state.json` before being published. `ALEXA_AUTH_PATH`
and `ALEXA_STATE_PATH` override those two file locations (the app points them at `/data`). Partial or
failed Amazon responses never clear an earlier measurement; a failure only turns off the
`Amazon connected` diagnostic. On restart, cached readings are republished as soon as MQTT
connects. Set `ALEXA_ONCE=true` for a one-shot development run; the normal mode polls at
`POLL_INTERVAL` seconds and retries failures with bounded exponential backoff.

Phase 2 uses these topics by default:

```text
amazon_air_quality/bridge/availability
amazon_air_quality/<device_id>/state
homeassistant/device/<device_id>/config
```

Discovery and state messages use QoS 1 and are retained. The bridge also republishes them
when Home Assistant sends its `homeassistant/status` birth message.

Development checks:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

## Attribution

Alexa authentication and query logic is adapted from
[joeyhage/homebridge-alexa-smarthome](https://github.com/joeyhage/homebridge-alexa-smarthome) (MIT),
built on [alexa-remote2](https://github.com/Apollon77/alexa-remote) and
[alexa-cookie2](https://github.com/Apollon77/alexa-cookie).
Packaging follows [home-assistant/apps-example](https://github.com/home-assistant/apps-example).

## License

[MIT](LICENSE)
