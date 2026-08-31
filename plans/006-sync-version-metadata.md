# Plan 006: Synchronize application version metadata

> **Executor instructions**: Follow this plan step by step, verify each gate,
> and update the status row in `plans/README.md` when complete.
>
> **Drift check**: `git diff --stat d5db71c..HEAD -- app/src/mqtt.ts app/test/mqtt.test.ts app/package.json app/package-lock.json app/Dockerfile app/config.yaml`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: Plan 001 recommended, not behaviorally required
- **Category**: bug
- **Planned at**: commit `d5db71c`, 2026-08-31

## Why this matters

The published Home Assistant app is version `0.3.0`, but MQTT discovery
identifies the bridge as `0.1.0`, and the Dockerfile fallback plus package root
metadata also remain at `0.1.0`. Home Assistant users and support tooling can
therefore see stale software metadata, and a local/fallback image build can
carry labels that do not match the published app. Use the build-provided version
for runtime discovery and align package/fallback metadata with the app version.

## Current state

- `app/config.yaml:2` — Home Assistant app version: `0.3.0`.
- `app/src/mqtt.ts:17-18` — hardcoded `APP_VERSION = '0.1.0'` used in discovery
  `o.sw`.
- `app/package.json:3` and the root entries of `app/package-lock.json` — package
  version remains `0.1.0`.
- `app/Dockerfile:29` — default `BUILD_VERSION` remains `0.1.0`; CI overrides
  it from `app/config.yaml` in `.github/workflows/publish.yml:72-74`.
- `app/test/mqtt.test.ts` — validates discovery structure but does not assert
  `payload.o.sw`.

Current runtime metadata:

```ts
// app/src/mqtt.ts:17-19
const APP_NAME = 'Alexa2MQTT';
const APP_VERSION = '0.1.0';
const SUPPORT_URL = 'https://github.com/timblazing/alexa2mqtt';
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused test | `npm test -- mqtt.test.ts` from `app/` | Discovery version test passes |
| Typecheck | `npm run typecheck` from `app/` | Exit 0 |
| Lint | `npm run lint` from `app/` | Exit 0 |
| Build | `npm run build` from `app/` | Exit 0; ignored `dist/` only |
| Version search | `rg -n "APP_VERSION|BUILD_VERSION|\"version\"" app/src/mqtt.ts app/Dockerfile app/package.json app/package-lock.json app/config.yaml` | No stale runtime/fallback `0.1.0` remains |

## Scope

**In scope**:

- `app/src/mqtt.ts`.
- `app/test/mqtt.test.ts`.
- `app/Dockerfile`.
- `app/package.json`.
- Only the root package version entries in `app/package-lock.json`.

**Out of scope**:

- Changing `app/config.yaml`'s published version; `0.3.0` is the current source
  version for this plan.
- Changing the MQTT discovery schema, unique IDs, topics, or support URL.
- Changing dependency versions or unrelated lockfile entries.
- Adding a release automation system; the existing publish workflow already
  passes `BUILD_VERSION`.

## Steps

### Step 1: Make discovery use the build-provided version

Replace the hardcoded runtime version in `app/src/mqtt.ts` with a small
environment-backed accessor evaluated when the discovery payload is built:

- use trimmed `process.env.APP_VERSION` when present;
- use a clearly labeled development fallback such as `0.0.0-dev` when running
  outside the container;
- do not expose any broker or auth environment values.

Keep `buildDeviceDiscoveryPayload`'s public arguments and payload shape intact.

**Verify**: `npm test -- mqtt.test.ts` after adding the test in Step 3 → focused
tests pass.

### Step 2: Inject the version into container runtime and align metadata

In `app/Dockerfile`, keep the existing `BUILD_VERSION` build argument used by
CI, change its fallback to `0.3.0`, and set `APP_VERSION` in the runtime image
from that build argument. Update `app/package.json` and only its root package
version entries in `app/package-lock.json` to `0.3.0`; do not change the
dependency version entry that coincidentally has another version value.

Do not change the publish workflow's existing `BUILD_VERSION` argument.

**Verify**: `rg` over the scoped metadata files → the runtime hardcode and
stale Docker/package root values are gone; `npm run typecheck` → exit 0.

### Step 3: Add discovery-version regression coverage

Extend `app/test/mqtt.test.ts` to assert `payload.o.sw` uses the environment
version. Stub the environment inside the test and restore it in cleanup; also
test the development fallback if the accessor exposes it through the builder.
Do not assert a secret or dump the complete environment.

**Verify**: `npm test -- mqtt.test.ts` → all focused tests pass.

### Step 4: Run the full gate

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` from
`app/`. If Docker is available, run the existing CI-equivalent build for the
current architecture with `BUILD_VERSION=0.3.0` and confirm the image build
completes; do not push an image.

**Verify**: all available commands exit 0; no files outside Scope are modified
except ignored build output.

## Test plan

Follow the existing discovery assertions in `app/test/mqtt.test.ts`. The key
regression is that `buildDeviceDiscoveryPayload(...).o.sw` is `0.3.0` when the
container environment supplies that version and is an explicit development
fallback when it does not. Preserve all existing payload/topic assertions.

## Done criteria

- [ ] Runtime MQTT discovery no longer hardcodes `0.1.0`.
- [ ] Container runtime receives `APP_VERSION` from `BUILD_VERSION`.
- [ ] Package root metadata and Docker fallback agree with `app/config.yaml`'s
  current `0.3.0` release.
- [ ] Dependency lockfile entries unrelated to the root package are unchanged.
- [ ] Lint, typecheck, tests, and build pass; Docker build passes if available.
- [ ] No discovery schema, topic, or support behavior changed.
- [ ] No files outside Scope are modified.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

- The runtime image does not preserve `ENV` values from the Dockerfile in the
  Home Assistant base image; report the observed image behavior.
- CI or release tooling derives the version from a different source than the
  current publish workflow excerpt; do not invent a second release source.
- Updating package metadata would require dependency upgrades or broad lockfile
  churn.

## Maintenance notes

The release workflow passes the version from `app/config.yaml` as
`BUILD_VERSION`; future releases must keep that flow intact. Review any new
runtime metadata field for accidental inclusion of credentials or environment
values, and keep the development fallback visibly distinct from a published
release.
