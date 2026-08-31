# Plan 001: Add behavioral coverage for MQTT and polling orchestration

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the STOP conditions section occurs, stop and report
> instead of improvising. When done, update this plan's status row in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat d5db71c..HEAD -- app/src/index.ts app/src/mqtt.ts app/test/mqtt.test.ts app/test/poll-cycle.test.ts app/src/poll-cycle.ts`
> If any in-scope file changed since this plan was written, compare the Current
> state excerpts with the live code before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `d5db71c`, 2026-08-31

## Why this matters

The repository's 35 tests cover pure parsing, configuration, persistence, and
MQTT discovery payload construction, but not the runtime MQTT state machine or
the polling coordinator that keeps Home Assistant state current. Reconnect,
Home Assistant birth-message replay, retained last-will behavior, serialized
publishes, partial poll failures, and cache persistence can therefore regress
while the current suite remains green. Add deterministic characterization tests
first so the later fixes have a reliable safety net.

## Current state

- `app/src/mqtt.ts` — owns `MqttBridge`, MQTT reconnect handling, discovery/state
  publication, retained availability, and the outbound serialization queue.
- `app/src/index.ts` — owns `pollMonitors` and the process lifecycle. Importing
  this file also invokes `main()` at line 257, which makes direct orchestration
  tests awkward.
- `app/test/mqtt.test.ts` — tests only `deviceTopics` and
  `buildDeviceDiscoveryPayload`; it does not instantiate `MqttBridge`.

The runtime MQTT behavior currently includes:

```ts
// app/src/mqtt.ts:223-245
client.on('connect', () => {
  this.#connected = true;
  if (!this.#stopping) {
    void this.#enqueue(() => this.#publishEverything());
  }
});
client.on('message', (topic, payload) => {
  if (topic === `${DISCOVERY_PREFIX}/status` && payload.toString().trim() === 'online') {
    void this.#enqueue(() => this.#publishEverything());
  }
});
```

```ts
// app/src/index.ts:55-118
for (const monitor of monitors) {
  try {
    response = await queryAirQuality(remote, monitor.endpoint);
    reading = parseAirQualityResponse(response);
  } catch (error) {
    await mqtt.setAmazonConnected(monitor.device.id, false);
    failures.push(/* redacted monitor error */);
    continue;
  }
  nextCache = mergeDeviceState(nextCache, monitor.device, reading, new Date().toISOString());
  await saveStateCache(statePath, nextCache);
  await mqtt.updateDevice(monitor.device, nextCache.devices[monitor.device.id]!.state, true);
}
```

Use the existing Vitest style from `app/test/mqtt.test.ts` and
`app/test/state.test.ts`: direct imports, small fakes, and meaningful property
assertions rather than snapshots. Do not add a testing framework or a network
broker dependency.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused MQTT tests | `npm test -- mqtt.test.ts` (from `app/`) | MQTT runtime tests pass |
| Focused polling tests | `npm test -- poll-cycle.test.ts` (from `app/`) | Poll-cycle tests pass |
| Full tests | `npm test` (from `app/`) | All existing and new tests pass |
| Typecheck | `npm run typecheck` (from `app/`) | Exit 0, no errors |
| Lint | `npm run lint` (from `app/`) | Exit 0 |

## Scope

**In scope**:

- `app/src/mqtt.ts` only if a narrowly scoped test seam is required.
- `app/src/index.ts` only to move the poll coordinator out of the side-effecting
  entrypoint.
- `app/src/poll-cycle.ts` (create if needed) for the extracted coordinator.
- `app/test/mqtt.test.ts`.
- `app/test/poll-cycle.test.ts` (create).

**Out of scope**:

- Changing MQTT topics, discovery payload shape, retained-state semantics, or
  polling/backoff policy.
- Adding a real MQTT broker, Alexa credentials, network calls, or end-to-end
  Home Assistant infrastructure.
- Fixing findings from Plans 002–006.
- Refactoring unrelated parser, state, server, or authentication code.

## Steps

### Step 1: Create a deterministic MQTT client fake in the existing MQTT test

In `app/test/mqtt.test.ts`, add a local EventEmitter-style fake implementing
only the `MqttClient` surface used by `MqttBridge`: `connected`, `on`,
`subscribeAsync`, `publishAsync`, and `endAsync`. Record each call in order and
allow a test to reject one selected publish. Cast the narrowly scoped fake to
the library type at the test boundary; do not weaken production types with
`any`.

**Verify**: `npm test -- mqtt.test.ts` → the original discovery/topic tests pass.

### Step 2: Characterize all externally visible MQTT lifecycle behavior

Instantiate `MqttBridge` with the fake and add tests for all of these cases:

1. `initialize()` subscribes to `homeassistant/status`, publishes retained
   bridge `online`, and publishes registered discovery/state.
2. `restore()` loads cached devices and republishes discovery plus retained
   cached state with `amazon_connected: false`.
3. `registerDevice()` publishes discovery and an initial state; registering the
   same metadata again does not republish discovery.
4. `updateDevice()` publishes the supplied state and connection flag; a failed
   poll through `setAmazonConnected()` publishes the last state with Amazon
   disconnected.
5. A `connect` event and an `online` `homeassistant/status` message replay all
   discovery/state and bridge availability.
6. `close()` waits for queued work, publishes retained bridge `offline` when the
   client is connected, and calls `endAsync()`.
7. A rejected publish is logged/contained according to the current queue
   contract, and a later queued operation still runs. Assert the behavior that
   exists today; do not change queue semantics in this plan.

**Verify**: `npm test -- mqtt.test.ts` → all new lifecycle tests and the
existing tests pass.

### Step 3: Extract the poll coordinator behind an injectable test seam

Move the `Monitor` type, `PollCycleResult` type, and `pollMonitors` function from
`app/src/index.ts:31-119` into `app/src/poll-cycle.ts`. Preserve the function's
observable behavior and imports. Add a small dependency object for the three
side effects that currently prevent isolated testing:

- `queryAirQuality`.
- `saveStateCache`.
- `writeSanitizedCapture`.

Provide production defaults that point to the existing functions, then make
`app/src/index.ts` call the extracted function with defaults. Keep `main()` in
`index.ts`; do not make importing the entrypoint itself the test seam.

**Verify**: `npm run typecheck` → exit 0; `npm test -- mqtt.test.ts` → MQTT
tests still pass.

### Step 4: Test successful, partial, failed, and capture poll cycles

Create `app/test/poll-cycle.test.ts` with deterministic timestamps and fakes for
the injected dependencies. Cover:

- one successful monitor: query, merge, save, MQTT update, status `true`;
- partial reading: previous metrics remain in the cache and the new timestamp
  is written;
- one monitor failure among several: failed monitor is marked disconnected,
  its cached state is not erased, other monitors continue, and the result is
  unsuccessful;
- all monitors failing: no successful update is reported;
- capture mode: the sanitized-capture dependency is called only when
  `captureFixtures` is true, and a capture-write failure does not turn a good
  Alexa reading into a failed poll because that is the current behavior at
  `app/src/index.ts:92-107`.

Use fake `MqttBridge` methods that record calls; do not connect to MQTT.

**Verify**: `npm test -- poll-cycle.test.ts` → all new poll-cycle tests pass.

### Step 5: Run the complete verification gate

Run the commands in the Commands table, then inspect `git diff --stat` and
`git status --short`. Only the in-scope files and the new plan-index status
update may be changed.

**Verify**: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`
from `app/` all exit 0; no untracked source or generated files appear outside
ignored `app/dist/`.

## Test plan

The new tests are `app/test/mqtt.test.ts` runtime tests and
`app/test/poll-cycle.test.ts`. Model their structure after the existing direct
Vitest tests in `app/test/mqtt.test.ts` and `app/test/state.test.ts`. The tests
must assert call order/topics/payload flags for MQTT and cache/status effects
for polling, not merely that promises resolve.

## Done criteria

- [ ] `app/test/mqtt.test.ts` exercises initialize, restore, register/update,
  reconnect, Home Assistant birth replay, close/LWT, and queued publish failure.
- [ ] `app/test/poll-cycle.test.ts` exercises success, partial data, mixed
  failures, all failures, and optional capture behavior.
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` pass.
- [ ] No MQTT topics, discovery fields, polling intervals, or production error
  policies changed.
- [ ] No files outside the Scope list are modified.
- [ ] `plans/README.md` marks this plan `DONE` only after all gates pass.

## STOP conditions

- The MQTT client API used by production differs from the Current state excerpt
  enough that the fake would test a different contract.
- Moving `pollMonitors` requires changing its behavior rather than only moving
  it and injecting its three side effects.
- A proposed test needs a real broker, live Alexa credentials, or a new package.
- A new failure exposes a production bug requiring behavior changes; record it
  and stop rather than silently fixing it in this test plan.

## Maintenance notes

Keep the fake client local to the MQTT tests so it cannot become a production
abstraction. Any future MQTT topic or retained-state change must update the
lifecycle assertions. Any new poll side effect should be added to the poll
dependency object and tested with a fake before changing the coordinator.
