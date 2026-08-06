# Amazon Air Quality to MQTT — build plan

A Home Assistant App (formerly add-on) that connects Amazon Smart Air Quality Monitors to Home Assistant via MQTT, without Homebridge.

This plan was revised on 2026-08-04 after direct inspection of the
[`joeyhage/homebridge-alexa-smarthome`](https://github.com/joeyhage/homebridge-alexa-smarthome)
source (v2.5.2), the [`home-assistant/apps-example`](https://github.com/home-assistant/apps-example)
template, and the current Home Assistant developer docs. It prioritizes a **simple, working v0.1**
over completeness. Deferred items are listed at the end.

---

## Verified facts (do not re-research these)

These were confirmed against the actual source code and current docs:

1. **The Homebridge plugin is actively maintained.** Current version is **2.5.2 (July 2026)**.
   There is no need to investigate the old issue #170 (`InvalidResponse(State not available)` in
   v2.2.1) or diff historical versions — later releases fixed authentication and query issues.
   **Port from current `main`.**

2. **Known-working dependency versions** (pin these exactly, upgrade later only with testing):

   ```json
   {
     "alexa-remote2": "8.0.5",
     "alexa-cookie2": "5.0.4"
   }
   ```

3. **How state is queried.** One GraphQL POST per device to Alexa's endpoint:

   ```text
   POST /nexus/v1/graphql   (via alexaRemote.httpsGet(false, '/nexus/v1/graphql', cb, { method: 'POST', data: JSON.stringify({ query, variables }) }))
   ```

   with this query (copied verbatim from the plugin, `src/wrapper/graphql/air_quality_features.graphql.ts`):

   ```graphql
   query getAirQualityStates($endpointId: String!) {
     endpoint(id: $endpointId) {
       features {
         name
         properties {
           name
           ... on RangeValue { rangeValue { value } }
           ... on TemperatureSensor { value { value scale } }
           ... on ToggleState { toggleStateValue }
         }
         configuration {
           ... on RangeConfiguration {
             friendlyName { value { text } }
           }
         }
       }
     }
   }
   ```

4. **How measurements are identified.** Range features carry a `friendlyName` in their
   configuration. The plugin matches instances by friendly name — `"Indoor air quality"`,
   `"Carbon monoxide"`, `"Humidity"`, etc. — captured at discovery time
   (see `src/domain/alexa/save-device-capabilities.ts`). Temperature arrives as a
   `temperatureSensor` feature with `{ value, scale }`. PM2.5 and VOC are also range features.

5. **How authentication works.** `AlexaRemote.init(...)` with proxy-based login
   (`alexa-cookie2` runs a local proxy; the user opens it in a browser and logs into Amazon).
   On the `cookie` event, persist `alexaRemote.cookieData` as JSON; pass it back as
   `formerRegistrationData` on next init so login survives restarts and cookies auto-refresh
   (~every few days). See the plugin's `src/platform.ts` (`initAlexaRemote`) and
   `src/util/index.ts` (`getAuthentication`).

6. **Home Assistant packaging facts** (verified against developers.home-assistant.io):
   - Add-ons are now called **apps**; the docs live at `/docs/apps/`.
   - A custom repository needs a root **`repository.yaml`**; each app lives in its own folder.
   - **`build.yaml` is retired** — the Dockerfile is the build source of truth (BuildKit).
   - `boot: auto` gives the Start-on-boot toggle; a `watchdog` URL gives the Watchdog toggle;
     a versioned `image:` field on GHCR gives Auto-update.
   - `services: [mqtt:need]` + bashio provides broker credentials — never ask the user for them.
   - Use the official **`home-assistant/apps-example`** repo as the structural template.
     Do not fork govee2mqtt or ring-mqtt.

7. **License**: the plugin is MIT. Preserve copyright/license attribution in any ported file.

---

## Target entities (v0.1)

One MQTT device per monitor with these components:

| Component        | Platform      | Device class      | Unit    | Source                          |
| ---------------- | ------------- | ----------------- | ------- | ------------------------------- |
| IAQ score        | sensor        | `aqi`             | none    | range "Indoor air quality" (raw 0–100, do NOT convert to HomeKit enum) |
| Temperature      | sensor        | `temperature`     | `°C`    | temperatureSensor feature       |
| Humidity         | sensor        | `humidity`        | `%`     | range "Humidity"                |
| PM2.5            | sensor        | `pm25`            | `µg/m³` | range "PM 2.5" / "Particulate matter" |
| CO level         | sensor        | `carbon_monoxide` | `ppm`   | range "Carbon monoxide"         |
| CO detected      | binary_sensor | `carbon_monoxide` | none    | derived: ppm > 10 (same threshold the plugin uses) |
| VOC index        | sensor        | none              | none    | range "Volatile organic compounds" — it is an **index**, not µg/m³ |
| Last update      | sensor        | `timestamp`       | none    | bridge-generated                |
| Amazon connected | binary_sensor | `connectivity` (diagnostic) | none | bridge-generated       |
| Bridge connected | binary_sensor | `connectivity` (diagnostic) | none | MQTT LWT               |

Expected values for the test device (sanity check against the Alexa app):
IAQ ≈ 97, temp ≈ 22.5 °C, humidity ≈ 52 %, PM2.5 ≈ 3, CO ≈ 1 ppm, VOC index ≈ 2.

Phase 1 confirmed the exact range friendly names from a real API response:
`"Indoor humidity"`, `"Indoor air quality"`, `"Particulate matter PM10"`,
`"Carbon monoxide"`, `"Volatile organic compounds"`, and `"Particulate matter"`.
The generic `"Particulate matter"` feature supplies PM2.5; the separate PM10 feature is
intentionally ignored in v0.1.

Deferred from the original plan: separate `iaq_status` text sensor, `data_fresh` binary sensor
(the `Last update` timestamp already conveys staleness), and the `Refresh now` button.

---

## Repository structure (simplified)

```text
amazon-air-quality-mqtt/
├── .github/workflows/
│   ├── ci.yml            # lint, typecheck, test, build, docker build
│   └── publish.yml       # on tag: multi-arch image → GHCR + GitHub release
├── amazon_air_quality_mqtt/       # the app folder (slug)
│   ├── app/                       # Node.js/TypeScript bridge
│   │   ├── src/
│   │   │   ├── alexa.ts           # AlexaRemote init, auth persistence, discovery, GraphQL state query
│   │   │   ├── parser.ts          # GraphQL response → normalized reading (pure, unit-tested)
│   │   │   ├── mqtt.ts            # connect, discovery payload, state publish, LWT
│   │   │   ├── state.ts           # last-known-state load/merge/save (/data/last-state.json)
│   │   │   ├── config.ts          # env-var config (populated by run.sh)
│   │   │   ├── server.ts          # tiny HTTP server: /healthz + minimal status page
│   │   │   └── index.ts           # wire-up + poll loop
│   │   ├── test/                  # unit tests + sanitized fixtures
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── translations/en.yaml
│   ├── config.yaml
│   ├── Dockerfile
│   ├── run.sh
│   ├── DOCS.md
│   ├── CHANGELOG.md
│   └── icon.png
├── LICENSE                # MIT, with homebridge-alexa-smarthome attribution
├── plan.md
├── README.md
└── repository.yaml
```

Rule of thumb: **one file per concern, no interface layers until a second implementation
exists.** The original plan's `AlexaProvider`/`StateRepository`/`MqttBridge` interfaces are
deferred — keep `parser.ts` and `state.ts` pure (no I/O) so they're testable without mocks,
and that's enough seam for v0.1.

---

## App `config.yaml` (v0.1)

```yaml
name: Amazon Air Quality to MQTT
version: "0.1.0"
slug: amazon_air_quality_mqtt
description: Amazon Smart Air Quality Monitor → Home Assistant via MQTT
url: "https://github.com/timblazing/amazon-air-quality-mqtt"
image: "ghcr.io/timblazing/amazon-air-quality-mqtt"
arch: [amd64, aarch64]
stage: experimental
startup: application
boot: auto
init: false
services: [mqtt:need]
ports:
  8099/tcp: 8099   # status page + healthz
  8098/tcp: 8098   # Amazon login proxy (alexa-cookie2)
ports_description:
  8099/tcp: Status page
  8098/tcp: Amazon login proxy
webui: "http://[HOST]:[PORT:8099]/"
watchdog: "http://[HOST]:[PORT:8099]/healthz"
options:
  amazon_domain: amazon.com
  poll_interval: 60
  mqtt_topic_prefix: amazon_air_quality
  debug: false
schema:
  amazon_domain: str
  poll_interval: "int(15,900)"
  mqtt_topic_prefix: str
  debug: bool
```

Do not use `host_network`, `privileged`, `hassio_role: admin`, or `apparmor: false`.

Options deferred from the original plan: `device_names` (v0.1 bridges **all** discovered
air-quality monitors — no selection needed), `language`, `stale_after`,
`mqtt_discovery_prefix`, `retain_state`, `mark_measurements_unavailable_when_stale`.
Hard-code sensible defaults (`homeassistant` discovery prefix, retained state, never mark
measurements unavailable). Add options only when someone needs them.

---

## Authentication design

Never ask for the Amazon password in app options. Flow:

1. On start, try to load `/data/auth.json` (the persisted `cookieData`).
2. If valid → `AlexaRemote.init` with `formerRegistrationData` → start polling.
3. If missing/invalid → start the alexa-cookie2 proxy on port 8098 and show
   "Authentication required — open this link" on the status page (port 8099).
4. On the `cookie` event, write `/data/auth.json` (mode `0600`, write-temp-then-rename)
   and start polling without requiring a restart.
5. Cookie refresh events overwrite the same file.

Rules:

- Never log cookies, tokens, CSRF values, or account IDs (debug mode included).
- Do not delete saved auth because one API call failed — only after repeated confirmed
  401s, and even then just fall back to the "authentication required" state.
- `/healthz` returns 200 whenever the process is alive — **including** when waiting for
  login or when Amazon is unreachable. Otherwise the Supervisor watchdog would restart-loop
  an app that merely needs the user to log in.
- Direct port access for the login flow; **no ingress in v0.1** (Amazon redirects through
  the cookie proxy are unlikely to survive ingress path rewriting).

---

## MQTT design

Get broker credentials from the Supervisor in `run.sh`:

```bash
export MQTT_HOST="$(bashio::services mqtt host)"
export MQTT_PORT="$(bashio::services mqtt port)"
export MQTT_USERNAME="$(bashio::services mqtt username)"
export MQTT_PASSWORD="$(bashio::services mqtt password)"
```

Topics:

```text
amazon_air_quality/bridge/availability          # LWT: online/offline (retained)
amazon_air_quality/<device_id>/state            # retained JSON, all measurements
homeassistant/device/<device_id>/config         # retained MQTT *device* discovery payload
```

- Use **MQTT device discovery** (one discovery payload per device containing all
  components), QoS 1, retained discovery and state.
- `<device_id>` derives from the Alexa endpoint/entity ID — never the display name.
- Subscribe to `homeassistant/status`; republish discovery on `online` (HA birth message).
- **Only the two diagnostic connectivity sensors use the availability topic.** Measurement
  entities must NOT — a stopped bridge or Amazon outage should leave last-known values
  visible, not flip everything to unavailable.

State payload example (retained):

```json
{
  "iaq_score": 97,
  "temperature_c": 22.5,
  "humidity_percent": 52,
  "pm25_ug_m3": 3,
  "co_ppm": 1,
  "co_detected": false,
  "voc_index": 2,
  "last_successful_update": "2026-08-04T19:26:34Z"
}
```

## Last-known-state behavior (core requirement)

The bridge must never replace a valid measurement with `unknown`/`unavailable`/null because
one Amazon request failed.

1. On startup, load `/data/last-state.json` and publish it immediately after MQTT connects.
2. Each successful poll: merge only present, valid metrics into the cached state
   (a response missing humidity keeps the previous humidity), update
   `last_successful_update`, write the file (temp-then-rename), publish.
3. Failed polls change nothing except the `Amazon connected` diagnostic.

One timestamp for the whole device is enough for v0.1 — per-metric timestamps
(the original plan's `MetricValue<T>` wrapper) are deferred.

Document clearly: cloud-derived CO readings are **not** a substitute for a certified
local CO alarm.

## Polling and failure handling

- Poll every `poll_interval` seconds (default 60); one GraphQL query per device, serialized.
- No overlapping cycles (skip the tick if the previous poll is still running).
- On failure: exponential backoff 10 s → 5 min with jitter; reset on success.
- A `State not available`-style response is a failed poll, not a reason to clear state
  or auth.
- One concise log line per failed cycle; full response bodies only in debug mode, redacted.

---

## Docker

Multi-stage build; Dockerfile is the build source of truth (no `build.yaml`):

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /build
COPY app/package*.json ./
RUN npm ci
COPY app/ ./
RUN npm run build && npm prune --omit=dev

FROM ghcr.io/home-assistant/base:<pinned>
RUN apk add --no-cache nodejs
WORKDIR /app
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY run.sh /run.sh
RUN chmod 0755 /run.sh
CMD ["/run.sh"]
```

`run.sh`: read options with bashio, export env vars, `exec node /app/dist/index.js`.
No retry logic in Bash.

CI (`ci.yml`): npm ci, lint, typecheck, test, build, docker build. Release
(`publish.yml`, on tag `vX.Y.Z`): verify tag == `config.yaml` version, buildx for
amd64 + aarch64, push multi-arch manifest to GHCR, create GitHub release from CHANGELOG.
No image publishing from PR builds.

---

## Testing (v0.1)

Unit tests (vitest) over **sanitized fixtures captured in Phase 1**:

- GraphQL response → normalized reading (happy path, partial response, invalid numbers,
  unsupported device).
- State merge: partial response keeps prior values; failed poll changes nothing.
- Discovery payload: stable unique IDs, correct device classes/units.
- Fixture sanitation: strip cookies, customer IDs, serials, emails.

Deferred: Mosquitto-container integration tests. Instead, a manual acceptance checklist:

1. Install from the custom repo, start, log in via the web UI.
2. Entities appear under one device; values match the Alexa app (IAQ ≈ 97, etc.).
3. Kill internet → values persist, `Amazon connected` goes off; restore → fresh values.
4. Restart app → auth and last state survive. Restart HA → entities return.

---

## Implementation phases

**Phase 1 — standalone proof of concept (complete, validated 2026-08-06).**
A plain Node CLI, no Docker, no MQTT: authenticate via the proxy flow, persist cookieData,
list devices, find the air-quality monitor, run the GraphQL query, print one normalized
JSON object. Capture and sanitize real response fixtures (this pins down the exact range
friendly names). Confirm raw IAQ score and CO ppm. Let it run a few hours to observe
cookie refresh. **Validated:** proxy authentication completed, auth and sanitized captures
were persisted, one monitor was discovered, and the real response produced temperature,
humidity, raw IAQ, PM2.5, CO ppm/detected, and VOC index values.

**Phase 2 — MQTT bridge.** Point it at any broker; publish device discovery + retained
state; verify all entities appear under one device in HA; implement last-known-state merge.

**Phase 3 — Home Assistant App packaging.** config.yaml, Dockerfile, run.sh, bashio MQTT
credentials, status page + `/healthz`, install from this repo as a custom repository.

**Phase 4 — polish and release.** Auth reset action, CI, GHCR multi-arch publish,
DOCS.md/README, CHANGELOG, v0.1.0 tag.

---

## Definition of done (v0.1)

- Installs from this repo as a Home Assistant custom app repository; Supervisor shows
  Start-on-boot, Watchdog, and Auto-update controls.
- Authenticates without Homebridge; auth survives restarts.
- One MQTT device with the entity table above; IAQ is the raw Amazon 0–100 score;
  VOC is an index; CO ppm is numeric.
- Amazon failures never blank out measurements; last state survives restarts.
- No credentials/cookies in logs; amd64 + aarch64 images on GHCR.
- README covers: unofficial-API caveat, install, auth, entities, last-known-state
  behavior, CO-alarm disclaimer, attribution (homebridge-alexa-smarthome, alexa-remote2,
  alexa-cookie2, apps-example).

## Deferred (post-v0.1 backlog)

- Device-name filtering / multi-account support
- `iaq_status` enum sensor, `data_fresh` sensor, Refresh button
- Per-metric timestamps and `stale_after` / expiry options
- Ingress for the login flow
- Mosquitto integration tests, Cosign image signing, armv7
- Configurable discovery prefix and retain behavior

## References

- Plugin source: https://github.com/joeyhage/homebridge-alexa-smarthome (MIT)
- Apps example: https://github.com/home-assistant/apps-example
- App configuration: https://developers.home-assistant.io/docs/apps/configuration/
- App communication (MQTT service): https://developers.home-assistant.io/docs/apps/communication/
- MQTT discovery: https://www.home-assistant.io/integrations/mqtt/
- alexa-remote2: https://github.com/Apollon77/alexa-remote
- alexa-cookie2: https://github.com/Apollon77/alexa-cookie
