<img src="app/logo.png" alt="" width="250" height="150">

# Alexa2MQTT

A Home Assistant App (add-on) that connects **Amazon Smart Air Quality Monitors** to Home
Assistant via **MQTT** — no Homebridge required.

> **Status: Phase 4 complete / alpha.** Running as a Home Assistant app on a real instance
> since August 12, 2026: broker credentials resolve automatically, Amazon sign-in persists
> across restarts and updates, and all 11 entities update unattended on the poll interval.
> Multi-arch images are published to GHCR, so **Auto update** works. See [`plan.md`](plan.md).

## Install as a Home Assistant app

1. **Settings → Add-ons/Apps → Apps page → ⋮ → Repositories**, add
   `https://github.com/timblazing/alexa2mqtt`, and reload.
2. Install **Alexa2MQTT** and start it. Supervisor pulls a prebuilt image for your
   architecture — amd64 and aarch64 are published.
3. Open the Web UI and follow the Amazon login link on port 8098 of the Home Assistant host.

To hack on it instead, clone the repository into `/addons` on the Home Assistant host and
delete the `image:` key from [`app/config.yaml`](app/config.yaml); Supervisor then builds
locally from [`app/Dockerfile`](app/Dockerfile).

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

These topics are used by default:

```text
alexa2mqtt/bridge/availability
alexa2mqtt/<device_id>/state
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

## Releasing

1. Bump `version` in [`app/config.yaml`](app/config.yaml) and add a matching section to
   [`app/CHANGELOG.md`](app/CHANGELOG.md).
2. Commit, then tag with the same version prefixed by `v` and push the tag:

   ```sh
   git tag v0.3.0 && git push origin v0.3.0
   ```

`.github/workflows/publish.yml` refuses to run if the tag and `config.yaml` disagree. It
then pushes `ghcr.io/timblazing/alexa2mqtt-amd64` and `…-aarch64` (tagged with the version
and `latest`) and opens a GitHub release using that changelog section as the notes. Home
Assistant offers the update once Supervisor refreshes the repository.

## Attribution

Alexa authentication and query logic is adapted from
[joeyhage/homebridge-alexa-smarthome](https://github.com/joeyhage/homebridge-alexa-smarthome) (MIT),
built on [alexa-remote2](https://github.com/Apollon77/alexa-remote) and
[alexa-cookie2](https://github.com/Apollon77/alexa-cookie).
Packaging follows [home-assistant/apps-example](https://github.com/home-assistant/apps-example).

## License

[MIT](LICENSE)
