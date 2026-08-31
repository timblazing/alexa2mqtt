# Plan 002: Match shell MQTT sentinel detection to the TypeScript contract

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. Stop and report on any STOP condition.
> Update this plan's status row in `plans/README.md` when complete.
>
> **Drift check**: `git diff --stat d5db71c..HEAD -- app/run.sh app/src/config.ts app/test/config.test.ts`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: Plan 001 recommended, not behaviorally required
- **Category**: bug
- **Planned at**: commit `d5db71c`, 2026-08-31

## Why this matters

The Home Assistant wrapper chooses between the internal MQTT service and an
explicit broker URL before Node starts. The shell script currently recognizes
the sentinel by substring, while TypeScript recognizes it only when the parsed
hostname is exactly `auto_hostname`. An explicit broker whose URL happens to
contain that substring can therefore be ignored and replaced with the internal
broker, with no warning that the requested endpoint was not used.

## Current state

- `app/run.sh` — resolves Home Assistant service credentials or exports
  `MQTT_URL` for Node.
- `app/src/config.ts` — canonical URL parser; `isAutoMqttUrl()` checks exact
  hostname equality at lines 54–55.
- `app/test/config.test.ts` — tests the TypeScript sentinel and explicit URL
  behavior, but not the shell wrapper.

Current mismatch:

```bash
# app/run.sh:10-12
mqtt_url=$(bashio::config 'mqtt_url')

if [[ "${mqtt_url}" == *"auto_hostname"* ]]; then
```

```ts
// app/src/config.ts:54-55,157
export const isAutoMqttUrl = (value: string): boolean =>
  parseUrl(value.trim())?.hostname === 'auto_hostname';
```

The documented default remains the exact sentinel in `app/config.yaml:28`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Shell syntax | `bash -n app/run.sh` from repo root | Exit 0 |
| Shell lint | `shellcheck app/run.sh` from repo root | Exit 0; CI has ShellCheck |
| Tests | `npm test` from `app/` | All tests pass |
| Typecheck | `npm run typecheck` from `app/` | Exit 0 |

## Scope

**In scope**:

- `app/run.sh`.
- `app/test/config.test.ts` only if adding a shared contract assertion is
  useful.
- A new `app/test/run-script.test.ts` only if a lightweight static shell
  contract test is added without dependencies.

**Out of scope**:

- Changing `MQTT_AUTO_URL`, MQTT URL parsing, broker authentication, or MQTT
  connection behavior.
- Changing Home Assistant service discovery or the app configuration schema.
- Introducing Bats, shell test dependencies, or a real Home Assistant runtime.

## Steps

### Step 1: Replace substring matching with exact sentinel matching

Change `app/run.sh:12` so the branch is entered only for the exact configured
sentinel `mqtt://auto_username:auto_password@auto_hostname`. Preserve the
existing service-availability check, credential exports, SSL-to-`mqtts`
mapping, and generic external-URL log message. If trimming is needed to match
the TypeScript `value.trim()` behavior, trim only surrounding whitespace before
the equality check; do not broaden matching by hostname substring.

**Verify**: `bash -n app/run.sh` → exit 0; `shellcheck app/run.sh` → exit 0.

### Step 2: Add a regression contract check

Extend the existing configuration tests or add a dependency-free script
contract test that proves the shell branch uses exact equality and does not
contain the old wildcard substring pattern. Keep the TypeScript tests for
`isAutoMqttUrl()` unchanged except for an additional hostname-containing-string
case if needed to make the intended boundary explicit.

**Verify**: `npm test -- config.test.ts` (and the new script test if present) →
all focused tests pass.

### Step 3: Run the full gate

Run shell syntax/lint plus `npm run lint`, `npm run typecheck`, `npm test`, and
`npm run build` from `app/`. Confirm the diff contains no changes to unrelated
configuration or source files.

**Verify**: every command exits 0; only the Scope files and plan status are
modified.

## Test plan

Preserve the existing sentinel, whitespace, ordinary external URL, and malformed
URL tests in `app/test/config.test.ts`. Add one regression case where the URL is
valid but its hostname is not exactly the sentinel hostname; it must remain an
external URL. If shell execution cannot be tested without a new dependency,
use a static contract assertion and rely on `bash -n` plus CI ShellCheck.

## Done criteria

- [ ] `app/run.sh` uses exact sentinel matching, not `*auto_hostname*`.
- [ ] The TypeScript and shell contracts agree on the sentinel boundary.
- [ ] `bash -n app/run.sh`, ShellCheck, lint, typecheck, tests, and build pass.
- [ ] No MQTT connection or credential behavior changed.
- [ ] No files outside the Scope list are modified.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

- The Home Assistant/bashio configuration value is transformed in a way that
  makes exact comparison impossible; report the observed value shape.
- Fixing the mismatch requires changing the sentinel or TypeScript parser.
- ShellCheck reports an unrelated pre-existing failure; report it separately.

## Maintenance notes

The sentinel is duplicated between `app/config.yaml`, `app/run.sh`, and
`app/src/config.ts` because the shell wrapper runs before Node. Any future
sentinel change must update all three locations and the boundary tests together.
