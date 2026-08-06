# Amazon Air Quality to MQTT

A Home Assistant App (add-on) that connects **Amazon Smart Air Quality Monitors** to Home
Assistant via **MQTT** — no Homebridge required.

> **Status: Phase 1 complete / pre-alpha.** Authentication, discovery, and raw state queries
> were validated against a real monitor on August 6, 2026. Phase 2 (MQTT) is next; nothing is
> installable as a Home Assistant app yet. See [`plan.md`](plan.md).

## What it will do

- Authenticate with your Amazon account using the same proxy-login flow as
  [homebridge-alexa-smarthome](https://github.com/joeyhage/homebridge-alexa-smarthome)
  (no password stored in the app config).
- Discover your Amazon Smart Air Quality Monitor(s) and poll Alexa's API for raw values:
  IAQ score (0–100), temperature, humidity, PM2.5, CO (ppm), and VOC index.
- Publish one Home Assistant MQTT device per monitor using MQTT device discovery, with
  retained last-known values that survive Amazon outages and restarts.
- Run as a proper Home Assistant App: start on boot, watchdog, and auto-update via
  versioned GHCR images.

## Caveats

- Uses Amazon's **unofficial** Alexa API — Amazon can break it at any time.
- Cloud-derived CO readings are **not** a substitute for a certified local CO alarm.

## Phase 1 development

Requires Node.js 22 or newer. From `amazon_air_quality_mqtt/app`:

```sh
npm install
cp .env.example .env
npm run dev
```

`npm run dev` loads `.env` when it exists. Set `ALEXA_PROXY_HOST` to an IP address reachable
by the browser you will use to sign in. The CLI prints the login URL, persists authentication
to `data/auth.json` with owner-only permissions, discovers air-quality monitors, and writes
only sanitized API captures under `data/captures/`. Set `ALEXA_ONCE=true` for a one-shot run;
otherwise it stays alive so cookie refresh can be observed.

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
