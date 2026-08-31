# Alexa2MQTT — expanding device support

Written 2026-08-12, after reading the current `app/src` (v0.3.0) and
[`joeyhage/homebridge-alexa-smarthome`](https://github.com/joeyhage/homebridge-alexa-smarthome)
`main` (accessories, `alexa-api-wrapper.ts`, `mapper/index.ts`, `domain/alexa/*`, `config.schema.json`).
Revised the same day against the HA MQTT discovery docs: fact 12
(`command_topic` is mandatory) reshaped Phase 3, and continuous-discovery /
availability semantics were pinned down.

The goal is the roadmap item: bridge **every supported device type on the Alexa
account** — lights, switches, fans, outlets/smart plugs, thermostats, locks — not
just air-quality monitors, and make the bridge **write** as well as read. Two
configuration-UI changes ride along in Phase 1 because they are small, visible
and independent of the rest.

Follow-on to [`initial.md`](initial.md); everything verified there (auth flow,
packaging, GHCR release) still holds and is not repeated.

---

## Verified facts (do not re-research these)

Read from the plugin source on 2026-08-12. These are the load-bearing details.

1. **One mutation writes every device type.** `setEndpointFeatures`, posted to the
   same `/nexus/v1/graphql` endpoint the bridge already uses
   (`src/wrapper/graphql/set_endpoint_features.graphql.ts`):

   ```graphql
   mutation updatePowerFeatureForEndpoints($featureControlRequests: [FeatureControlRequest!]!) {
     setEndpointFeatures(
       setEndpointFeaturesInput: { featureControlRequests: $featureControlRequests }
     ) {
       featureControlResponses { endpointId featureOperationName __typename }
       errors { endpointId code __typename }
       __typename
     }
   }
   ```

   Each request is `{ endpointId, featureName, featureOperationName, payload? }`,
   with `payload` omitted entirely when empty (`alexa-api-wrapper.ts:225`). The
   array shape means several commands can be batched in one POST.

2. **Feature / operation / payload matrix** (from the accessory classes):

   | Capability | `featureName` | `featureOperationName` | `payload` |
   | --- | --- | --- | --- |
   | Power on/off | `power` | `turnOn` / `turnOff` | — |
   | Brightness | `brightness` | `setBrightness` | `{ brightness: "0".."100" }` (string) |
   | Color | `color` | `setColor` | `{ colorName }` — **named colors only** |
   | Color temp | `colorTemperature` | `setColorTemperature` | `{ colorTemperatureInKelvin }` (number) |
   | Lock | `lock` | `lock` / `unlock` | — |
   | Thermostat setpoint | `thermostat` | `setTargetSetpoint` | `{ targetSetpoint: { value: "21", scale: "CELSIUS" } }`, or `{ lowerSetpoint, upperSetpoint }` in auto mode |
   | Thermostat mode | `thermostat` | `setThermostatMode` | `{ thermostatMode: "HEAT"\|"COOL"\|"AUTO"\|"ECO"\|"OFF" }` |
   | Thermostat power | `thermostat` | `turnOn` / `turnOff` | — |

   Note the plugin sets brightness as a **string** and color temperature as a
   **number**; mirror it exactly rather than "fixing" it.

3. **`setColor` takes a color *name*, not hue/sat.** The plugin maps a HomeKit hue
   to the nearest named color and sends `setColor` through the older REST path
   (`executeSmarthomeDeviceAction`), not the GraphQL mutation — see
   `light-accessory.ts:271`. Full RGB is therefore **out of scope** for v0.4;
   ship brightness + color temperature, and revisit color later.

4. **Device type comes from `displayCategories.primary.value`**, already selected
   by our `ENDPOINTS_QUERY`. Values the plugin handles: `LIGHT`, `SWITCH`,
   `SMARTLOCK`, `FAN`, `SMARTPLUG`, `THERMOSTAT`, `AIR_QUALITY_MONITOR`,
   `ALEXA_VOICE_ENABLED`, plus `VACUUM_CLEANER`, `GAME_CONSOLE`, `AIR_FRESHENER`
   listed but not mapped (`domain/alexa/index.ts`).

5. **Capability is decided by operations, not by category alone**
   (`mapper/index.ts`). A device is only exposed if `features[].operations[].name`
   contains what the type needs — `turnOn`+`turnOff` for light/switch/fan/plug,
   `lock`+`unlock` for locks. Two informative special cases:
   - A `SWITCH` that also reports `setBrightness` is exposed as a **light**.
   - Anything unrecognised that still has `turnOn`/`turnOff` falls back to a
     **switch**. Adopt both rules; they are what make "everything else" work.

6. **`enablement`** is `ENABLED` / `DISABLED`; the plugin surfaces it as
   `StatusActive`. We already fetch it and currently ignore it — map it to MQTT
   availability per device.

7. **State reads have per-type queries** (`light_features`, `power_features`,
   `lock_features`, `thermostat_features`, `range_features`, …) selected by
   accessory type, with a 2-permit semaphore and a cache TTL to avoid hammering
   Amazon. **We do not have to copy that shape** — see the bulk-poll decision
   below — but we do need its concurrency discipline.

8. **The include-list is a plain name match.** `config.devices` is an array of
   display names compared with `d.displayName.trim()`; empty means "all supported
   devices" (`platform.ts:227`). Exact, case-sensitive, whitespace-trimmed. There
   is also an `excludeDevices` list, mutually exclusive with it in the schema.

9. **The plugin filters out its own ghost devices**: endpoints whose
   `endpointReports[].reporter.id` is the plugin's own Alexa skill
   (`alexa-api-wrapper.ts:72`). We need the same defence in reverse — an Alexa
   endpoint that *is* a Home Assistant entity exported back to Alexa would create
   a loop. See "Loop protection".

---

## Two configuration-UI facts (checked before promising anything)

10. **The "Network" card cannot hold `login_host`.** Home Assistant renders that
    card from `ports` / `ports_description` in `config.yaml` alone; app options
    always render in the Options card. So the request to move the field *into*
    the Network card is not achievable as stated.

    What *is* achievable, and gets the same result: make `login_host` a
    normal always-visible option placed **last in the Options card**, directly
    above the Network card, with a description tying it to the login-proxy port.
    Visually it lands exactly where the screenshot wants it, minus the card
    boundary.

11. **The "Show unused optional configuration options" toggle disappears on its
    own.** Home Assistant only renders it when the schema has an optional entry
    (`str?`, `int?`, …) that is absent from the saved options. Give `login_host`
    an empty-string default in the `options:` block and it counts as present, the
    toggle stops rendering, and the field shows inline. No other option is
    optional today, so the toggle goes away entirely. Keep the schema as `"str?"`
    so an empty value stays legal.

    `run.sh` needs no change for this: `bashio::config.has_value 'login_host'`
    is already false for an empty string, so the auto-detect fallback still runs.

---

## One Home Assistant MQTT fact (checked against the HA docs 2026-08-12)

12. **`command_topic` is required** in MQTT discovery for `lock`, `light`
    (every schema, including `json`) and `fan`. A "read-only" discovery payload
    without one is invalid and HA will reject the component. So the safety
    staging in Phase 3 cannot work by omitting `command_topic`; instead the
    payloads include it from the start and the bridge's command handler is a
    **log-and-drop stub** until Phase 4 replaces it with the real write path.
    Same safety property — no MQTT message can move hardware before Phase 4 —
    without invalid discovery.

---

## Design decisions

### One bulk poll instead of N per-device queries

The plugin queries one endpoint at a time because HomeKit asks per
characteristic. We poll on a timer, so the better shape is the opposite: extend
the **existing `ENDPOINTS_QUERY`** with the property fragments from the per-type
queries (`Power`, `Brightness`, `Color`, `ColorTemperature`, `Lock`, `Setpoint`,
`ThermostatMode` alongside today's `RangeValue`, `TemperatureSensor`,
`ToggleState`) and get discovery *and* full state for every device in **one POST
per poll cycle**.

This keeps request volume flat as the device count grows — the difference between
1 request/minute and 30 — which matters because Amazon throttles. Per-endpoint
queries are then only used for the post-command confirmation read (see below).

Risk: the combined query may be rejected or truncated on large accounts. Mitigate
by keeping the current `AIR_QUALITY_QUERY` per-endpoint path in place as a
fallback, and falling back automatically after two consecutive bulk failures.

### Continuous discovery, and what happens when devices come and go

Today `index.ts` discovers once at startup, then polls per monitor forever, and
**exits fatally when zero air-quality monitors exist** (`index.ts:187`). Both
change with the bulk poll:

- Discovery *is* the poll: every cycle re-runs `ENDPOINTS_QUERY`, so a device
  added to the Alexa account appears within one poll cycle, no restart. The
  include-list filter is re-applied each cycle.
- A device seen once stays registered. If it is missing from a later poll (or
  its `enablement` flips to `DISABLED`), mark it **unavailable** on its
  availability topic — never unpublish its discovery or drop its retained
  state. Transient Alexa flakiness must not delete entities or history.
- Startup is fatal only when the account has **zero supported devices of any
  kind** and the state cache is also empty. "No air-quality monitors but three
  lights" is a normal account, not an error.

### Capability model

Introduce `src/capability.ts` between the raw Alexa endpoint and MQTT. One
`describeEndpoint(endpoint) -> DeviceProfile`:

```ts
type DeviceKind =
  | 'air_quality' | 'light' | 'switch' | 'outlet'
  | 'fan' | 'lock' | 'thermostat';

interface DeviceProfile {
  id: string;              // stable MQTT/device id
  endpointId: string;      // amzn1.alexa.endpoint...
  kind: DeviceKind;
  name: string;
  manufacturer?: string;
  model?: string;
  enabled: boolean;        // from `enablement`
  capabilities: Capability[];  // 'power' | 'brightness' | 'color_temp' | 'lock' | 'setpoint' | 'mode' | air-quality metrics
}
```

Kind selection follows fact 5 exactly, including the brightness-switch-is-a-light
and the turnOn/turnOff fallback rules. Everything downstream — discovery payload,
state parsing, command routing — switches on `kind` + `capabilities`, never on
raw Alexa shapes.

### Device identity and the migration it forces

`deviceIdFromEndpointId` produces `aaqm_<sha256[0:16]>`, and that string is baked
into every existing entity's unique ID. Changing it renames every entity in
existing installs.

Decision: **keep `aaqm_` for air-quality monitors**, and use `alexa_<hash>` for
every newly supported kind. Ugly, but no existing user loses their history. Note
it in `device.ts` so it doesn't get "cleaned up" later.

### State cache v2

`StateCache` is v1 with a flat air-quality reading per device. Bump to **v2**:
`{ version: 2, devices: { [id]: { device: DeviceProfile, state: DeviceState } } }`
where `DeviceState` is a discriminated union per kind. `parseStateCache` gains a
v1→v2 migration (v1 entries become `kind: 'air_quality'` with the same numbers) so
no one loses retained state on upgrade. Unknown/invalid entries are dropped with a
warning instead of throwing, because a partial cache is better than none.

### MQTT topics and discovery

Keep today's device-level discovery bundle (`homeassistant/device/<id>/config`)
and the single retained state topic per device. Add command topics:

```text
<prefix>/<device-id>/state          (retained, JSON, already exists)
<prefix>/<device-id>/set            (subscribed, JSON — one topic per device)
<prefix>/bridge/availability        (retained, already exists)
```

One JSON command topic per device rather than one per attribute: it maps cleanly
onto HA's `schema: json` light, and `switch`/`fan`/`lock`/`climate` components can
each point their `command_topic` at it with a `command_template` that names the
attribute. Payload contract:

```json
{ "state": "ON", "brightness": 180, "color_temp_kelvin": 2700 }
{ "lock": "LOCK" }
{ "temperature": 21.5, "mode": "heat" }
```

Discovery components per kind:

| Kind | HA platform | Notes |
| --- | --- | --- |
| `light` | `light` (`schema: json`) | `brightness: true` when capable; `supported_color_modes: ["color_temp"]` when capable |
| `switch` / `outlet` | `switch` | `device_class: outlet` for `SMARTPLUG` |
| `fan` | `fan` | on/off only in v0.4; no percentage until a device proves the range feature |
| `lock` | `lock` | `optimistic: false`, `state_locked`/`state_unlocked`/`state_jammed` |
| `thermostat` | `climate` | `modes` from reported `thermostatModeValue`s, `temperature_command_topic` on the shared set topic |
| `air_quality` | unchanged | existing sensor bundle, untouched |

Per-device availability: publish `<prefix>/<device-id>/availability` (retained)
driven by `enablement` + last poll success. Because that topic is retained, a
crashed bridge would leave devices looking available forever — so each new-kind
component declares **both** topics with the `availability` list form and
`availability_mode: all`:

```json
"availability": [
  { "topic": "<prefix>/bridge/availability" },
  { "topic": "<prefix>/<device-id>/availability" }
],
"availability_mode": "all"
```

The bridge topic already has an MQTT last-will, so a crash marks everything
unavailable immediately while the per-device topic still reflects Amazon-side
health. This replaces the current "amazon_connected" binary sensor semantics
for new kinds (the air-quality bundle keeps its existing diagnostic entities so
nothing breaks).

One implementation trap carried over from v0.3: `MqttBridge` only republishes
discovery when `sameMetadata` says the device changed (`mqtt.ts:202`). The v2
comparison must cover `kind` and `capabilities` too, or a device that gains a
capability (for example a light whose color-temperature feature appears later)
keeps a stale discovery payload until restart.

### Write path

`src/command.ts`, called from an MQTT `message` handler:

1. Parse the JSON payload against the device's `DeviceProfile`. Reject
   (log + ignore) anything the device can't do — never send a speculative
   mutation.
2. Translate to one or more `featureControlRequests` using the fact-2 matrix, and
   send them **batched in a single mutation**.
3. Check the response: treat it as failed unless `featureControlResponses` is
   non-empty and `errors` is empty (the plugin's `validateSetStateSuccessful`
   applies the same predicate to the REST path).
4. **Optimistically** publish the new state immediately, then schedule a
   confirmation read of just that endpoint ~2 s later (Alexa's own state lags the
   command). If confirmation disagrees, publish what Alexa reports — the device
   is the source of truth.
5. Serialise all Alexa traffic (polls and commands) through one queue with at
   most 2 in flight, mirroring the plugin's semaphore, and back off on HTTP 429.

Commands must never be dropped silently: every rejected or failed command logs a
one-line reason including the device name.

### Loop protection

If a user has the HA↔Alexa integration in the other direction, HA entities appear
as Alexa endpoints, and bridging them back creates a feedback loop. Skip any
endpoint whose `manufacturer` text or `endpointReports[].reporter` identifies
Home Assistant, log the skip, and document the include-list as the manual escape
hatch. This needs a real capture to confirm the exact reporter id — until then,
match on manufacturer text and treat the reporter check as a TODO.

---

## Configuration changes

`config.yaml` — option order is what the UI renders, so `include_devices` goes
first and `login_host` last:

```yaml
options:
  include_devices: ""
  mqtt_url: "mqtt://auto_username:auto_password@auto_hostname"
  amazon_domain: amazon.com
  poll_interval: 60
  mqtt_topic_prefix: alexa2mqtt
  debug: false
  login_host: ""
schema:
  include_devices: "str?"
  mqtt_url: url
  amazon_domain: str
  poll_interval: "int(15,900)"
  mqtt_topic_prefix: str
  debug: bool
  login_host: "str?"
```

`include_devices` is a **comma-separated string** rather than the plugin's array,
because a `list(str)` renders as a repeating add-row widget that is far clumsier
than one text field. Parsing: split on `,`, trim, drop empties, compare
case-insensitively against the Alexa friendly name (the plugin is
case-sensitive; being lenient here costs nothing and avoids a support burden).
Empty means every supported device.

At startup, log which names matched and warn per name that matched nothing —
a silent typo is the most likely support ticket this option generates.

`translations/en.yaml` gains:

```yaml
include_devices:
  name: Devices to include
  description: >-
    Comma-separated list of device names to bridge, exactly as they appear in
    the Alexa app. Leave empty to add every supported device.
```

and `login_host`'s description gains a pointer to the login proxy port below it.

---

## Implementation phases

Each phase ends green (`npm run lint`, `npm run typecheck`, `npm test`) and is
independently shippable.

### Phase 1 — configuration and UI (no behavior change yet)

- `config.yaml`: reorder options, add `include_devices`, give `login_host` an
  empty default so the "unused optional options" toggle stops rendering.
- `translations/en.yaml`: new strings.
- `run.sh`: export `INCLUDE_DEVICES`.
- `config.ts`: parse `INCLUDE_DEVICES` into `includeDevices: string[]`; validate
  it is not just commas.
- `index.ts`: apply the filter to discovered air-quality endpoints, with match /
  no-match logging.
- Tests: `config.test.ts` for parsing (empty, spaces, duplicates, all-commas).

Ships as **0.3.1** — a working device filter plus the UI fix, before any of the
larger work lands.

### Phase 2 — capability model and bulk query

- Extend `ENDPOINTS_QUERY` with the property fragments from fact 1/7.
- New `src/capability.ts`: `DeviceProfile`, `DeviceKind`, kind selection.
- New `src/parsers/` with one parser per kind; move `parser.ts` under it as
  `air-quality.ts` unchanged.
- Bulk-query fallback to the existing per-endpoint path after two failures.
- Relax the fatal "no air-quality monitor found" startup check (`index.ts:187`)
  per the continuous-discovery rules above.
- Tests from fixtures: at least one light, one plug and one lock. Build these
  as **synthetic fixtures** derived from the plugin's response shapes and our
  existing sanitized captures, clearly named `synthetic-*` — real captures need
  a live account (`ALEXA_CAPTURE_FIXTURES=true`, pull from `data/captures`) and
  are a user step, swapped in later without changing the tests.

No MQTT change yet; new kinds are discovered and logged only.

### Phase 3 — publishing new kinds, commands stubbed

- State cache v2 + v1 migration.
- Discovery payload builder switches on `kind`; per-device availability topic
  with the dual-`availability` list (fact above); `sameMetadata` comparison
  extended to kind + capabilities.
- Publish `switch`, `light`, `lock`, `fan`, `climate` components **with**
  `command_topic` (required by HA — fact 12), subscribe to `<prefix>/+/set`,
  and handle every command with a log-and-drop stub: no MQTT message can reach
  Alexa or move hardware in this phase.
- Status page (`server.ts`) reports devices by kind, not "monitors".

Checkpoint (manual, needs the real add-on): entities appear in HA, show the
right state, and change when the Alexa app changes them. This is a user
verification step — implementation may proceed to Phase 4 with tests green,
but nothing ships until this checkpoint passes on real hardware.

### Phase 4 — the write path

- `src/command.ts` replaces the Phase 3 stub behind the existing subscription.
- Serialised request queue (max 2 concurrent) shared with polling; 429 backoff.
- Optimistic publish + delayed confirmation read.
- Tests: payload→mutation mapping per kind, rejection of impossible commands,
  response-validation failure handling, and confirmation reconciliation.

Order within the phase: **switch/outlet first** (simplest, easiest to verify),
then light, lock, fan, thermostat.

### Phase 5 — release

- `DOCS.md`: supported types, the include list, command topics with copy-pasteable
  payloads, and an explicit list of what is *not* supported (RGB color, fan
  speed, vacuum/media devices).
- `CHANGELOG.md` + `config.yaml` version → **0.4.0**.
- Version cleanup: `mqtt.ts` hardcodes `APP_VERSION = '0.1.0'` in the discovery
  origin block and `package.json` still says `0.1.0` while `config.yaml` says
  `0.3.0`. Make `config.yaml` the single source of truth (read the version from
  the environment or a generated constant) so this can't drift again.
- `README.md`: move the device-support bullet out of Roadmap into "What it does";
  leave the auth-reset bullet in Roadmap.

---

## Definition of done

- A light, a smart plug and a lock on the account appear in HA and can be
  controlled from the HA dashboard, with state converging within one poll cycle.
- Air-quality monitors behave exactly as before, same entity IDs, same history.
- `include_devices` limits discovery, and a typo produces a warning naming the
  unmatched entry.
- The Configuration tab shows "Devices to include" first, "Login host" last, and
  no "Show unused optional configuration options" toggle.
- One Alexa request per poll cycle regardless of device count.
- A command that a device cannot perform is refused locally and logged, never
  sent.
- The bridge starts and runs normally on an account with no air-quality
  monitors, and a device that vanishes from a poll goes unavailable without
  losing its discovery or retained state.

## Explicitly out of scope

- RGB/hue color (needs the named-color REST path — fact 3).
- Fan speed / percentage, vacuum, media and Echo devices.
- Push updates. Alexa's push connection is disabled (`usePushConnection: false`)
  and polling stays the model; revisit only if command confirmation proves too
  slow in practice.
- The auth-reset control — separate roadmap item, unrelated code path.

## Open questions

- Which `displayCategories` values actually appear on this account? Everything
  above assumes the plugin's list; a discovery capture settles it in five minutes
  and may shorten Phase 2.
- Does the extended bulk query survive a large account, or does Alexa truncate
  it? Determines whether the fallback path is a corner case or the main one.
- What identifies a Home-Assistant-originated endpoint in `endpointReports`?
  Needed to finish loop protection.

## References

- `joeyhage/homebridge-alexa-smarthome` `main`: `src/wrapper/alexa-api-wrapper.ts`,
  `src/wrapper/graphql/*`, `src/accessory/*`, `src/mapper/index.ts`,
  `src/domain/alexa/index.ts`, `src/domain/alexa/get-devices.ts`, `config.schema.json`
- Home Assistant MQTT discovery: light (`schema: json`), switch, fan, lock, climate
- [`initial.md`](initial.md) — the v0.1–v0.3 plan this builds on
