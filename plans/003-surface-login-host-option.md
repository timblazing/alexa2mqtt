# Plan 003: Surface the documented login host option by default

> **Executor instructions**: Follow this plan exactly, verify each step, and
> update the status row in `plans/README.md` when complete.
>
> **Drift check**: `git diff --stat d5db71c..HEAD -- app/config.yaml app/run.sh app/translations/en.yaml app/DOCS.md`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: Plan 001 recommended, not behaviorally required
- **Category**: bug
- **Planned at**: commit `d5db71c`, 2026-08-31

## Why this matters

The app documents `login_host` as an empty-by-default option for installations
where the Home Assistant host's primary IPv4 is not the address the user opens
in a browser. The schema and translations define it, and `run.sh` consumes it,
but the `options:` block omits it. The normal saved-options surface therefore
does not present the documented default field, making the supported Tailscale,
hostname, or alternate-address setup unnecessarily difficult.

## Current state

- `app/config.yaml` — Home Assistant app metadata, defaults, and schema.
- `app/run.sh` — reads `login_host` when it has a non-empty configured value and
  otherwise auto-detects a host address.
- `app/translations/en.yaml` — already contains the field's label and help text.
- `app/DOCS.md` — already documents the empty default and override behavior.

Current configuration mismatch:

```yaml
# app/config.yaml:27-39
options:
  mqtt_url: "mqtt://auto_username:auto_password@auto_hostname"
  amazon_domain: amazon.com
  poll_interval: 60
  mqtt_topic_prefix: alexa2mqtt
  debug: false
schema:
  mqtt_url: url
  amazon_domain: str
  login_host: "str?"
```

The runtime path already supports the field:

```bash
# app/run.sh:33-47
login_host=""
if bashio::config.has_value 'login_host'; then
    login_host=$(bashio::config 'login_host')
else
    # auto-detect the primary IPv4, then fall back to hostname.local
fi
```

The repository's documented UI decision is to keep the field in the Options
card, place it last, and give it an empty-string default; do not attempt to move
it into the generated Network card.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Inspect config | `sed -n '1,45p' app/config.yaml` | `login_host: ""` appears in `options:` and `login_host: "str?"` remains in `schema:` |
| Tests | `npm test` from `app/` | All tests pass |
| Lint | `npm run lint` from `app/` | Exit 0 |
| Typecheck | `npm run typecheck` from `app/` | Exit 0 |

## Scope

**In scope**:

- `app/config.yaml`.
- `app/test/config.test.ts` only if a dependency-free text/config contract test
  is appropriate.

**Out of scope**:

- `app/run.sh` behavior; it already handles empty versus non-empty values.
- `app/translations/en.yaml` and `app/DOCS.md`; their `login_host` content is
  already present and should remain unchanged.
- Any attempt to alter Home Assistant's generated Network card.

## Steps

### Step 1: Add the empty default in the Options card

Add `login_host: ""` to the `options:` block in `app/config.yaml`, after the
other user-facing options so it is the last normal option before `schema:`.
Keep the existing optional schema type `"str?"`; an empty value must remain
legal and must continue to trigger `run.sh` auto-detection.

**Verify**: `sed -n '1,45p' app/config.yaml` → exactly one `login_host` entry
under `options:` with an empty value and exactly one optional schema entry.

### Step 2: Add a narrow configuration contract check if practical

If the existing test conventions permit reading YAML as text without adding a
dependency, add an assertion that the default block contains the empty
`login_host` option and the schema still declares `"str?"`. Otherwise, do not
add a fragile parser; the exact config inspection and CI app validation are
the verification for this metadata-only change.

**Verify**: `npm test` from `app/` → all tests pass.

### Step 3: Run the standard gate

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` from
`app/`. Inspect the diff to ensure no runtime or translation changes slipped in.

**Verify**: all commands exit 0; only Scope files and plan status are modified.

## Test plan

The runtime environment-variable behavior is already covered by
`app/test/config.test.ts` and `app/run.sh` is not changing. The regression to
prevent is metadata drift: the default must exist while the optional schema and
empty-value fallback remain intact.

## Done criteria

- [ ] `app/config.yaml` includes `login_host: ""` under `options:` as the last
  option.
- [ ] The schema remains `login_host: "str?"`.
- [ ] Existing translations, docs, and `run.sh` behavior are preserved.
- [ ] Lint, typecheck, tests, and build pass.
- [ ] No files outside Scope are modified.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

- Home Assistant app validation rejects an empty-string optional default; report
  the exact validation result instead of changing the schema type.
- A change appears necessary in `run.sh` to preserve empty-value behavior.
- The field would need to be moved into the Network card; that is outside this
  plan and not supported by the documented design decision.

## Maintenance notes

Keep `options.login_host` and `schema.login_host` synchronized. If Home
Assistant changes how optional fields are rendered, verify the UI behavior again
before changing this metadata; the runtime fallback is intentionally keyed to an
empty value.
