# Plan 004: Recover from invalid saved Alexa authentication

> **Executor instructions**: Follow this plan step by step. Run each
> verification command before continuing, honor STOP conditions, and update the
> status row in `plans/README.md` when complete.
>
> **Drift check**: `git diff --stat d5db71c..HEAD -- app/src/alexa.ts app/src/index.ts app/test/alexa.test.ts app/DOCS.md`

## Status

- **Priority**: P1
- **Effort**: S/M
- **Risk**: MED
- **Depends on**: Plan 001 recommended, not behaviorally required
- **Category**: bug
- **Planned at**: commit `d5db71c`, 2026-08-31

## Why this matters

The persisted Alexa session is intentionally stored on the app data volume, but
the startup path treats malformed JSON or a valid JSON object with an obsolete
shape as a fatal application error. A damaged or migrated `auth.json` therefore
prevents the app from reaching its already-supported fresh-login flow; the user
must stop the app, manually delete the file, and restart. Recoverable invalid
credentials should fall back to a fresh sign-in without silently treating disk
permission or other I/O failures as valid authentication.

## Current state

- `app/src/alexa.ts` — validates, loads, saves, and initializes Alexa auth.
- `app/src/index.ts` — calls `initializeAlexa` and has a process-level fatal
  catch at lines 257–260.
- `app/test/alexa.test.ts` — covers valid round-trip, missing file, and rejected
  incomplete save input.
- `app/DOCS.md` — currently tells users to stop and delete `auth.json` when
  sign-in loops.

Current load behavior:

```ts
// app/src/alexa.ts:132-157
try {
  const parsed = JSON.parse(await readFile(authPath, 'utf8')) as unknown;
  // unwrap cookieData, validate required fields
  if (!isAuthenticationData(candidate)) {
    throw new Error('saved authentication has an unexpected shape');
  }
  return candidate;
} catch (error) {
  if (code === 'ENOENT') return undefined;
  throw new Error(`Could not load saved Alexa authentication: ${String(error)}`, {
    cause: error,
  });
}
```

`initializeAlexa` calls this loader before starting the login-capable remote at
`app/src/alexa.ts:210-216`; an exception reaches `main().catch()` and exits.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `npm test -- alexa.test.ts` from `app/` | Auth tests pass |
| Full tests | `npm test` from `app/` | All tests pass |
| Typecheck | `npm run typecheck` from `app/` | Exit 0 |
| Lint | `npm run lint` from `app/` | Exit 0 |

## Scope

**In scope**:

- `app/src/alexa.ts`.
- `app/src/index.ts` only if needed to log the recoverable fallback at the
  existing authentication boundary.
- `app/test/alexa.test.ts`.
- `app/DOCS.md` for the corrected user-facing recovery behavior.

**Out of scope**:

- Changing the authentication format, required credential fields, cookie
  refresh interval, proxy port, or Amazon API behavior.
- Automatically deleting or overwriting an invalid file before a successful
  fresh login.
- Adding an auth reset UI control; that is a separate roadmap feature.
- Logging any cookie, token, account identifier, or file contents.

## Steps

### Step 1: Distinguish recoverable invalid content from fatal I/O errors

Introduce a private or exported typed error in `app/src/alexa.ts` for invalid
saved-auth content. Throw it for JSON parse failures and failed
`isAuthenticationData` validation, while preserving ordinary filesystem errors
such as permission denied as fatal errors. Keep the existing ENOENT behavior of
returning `undefined`.

The error message must contain only a generic description such as invalid saved
authentication; it must not include file contents or credential values.

**Verify**: `npm run typecheck` from `app/` → exit 0.

### Step 2: Start fresh login when the saved content is invalid

At the `initializeAlexa` load boundary, catch only the typed invalid-content
error, log one redacted warning, and continue with `savedAuthentication` set to
`undefined`. This must cause the existing `remote.init` path to advertise the
login proxy and invoke `onLoginRequired`; it must not bypass or weaken normal
authentication validation. Re-throw all other load errors.

Do not rename or delete the invalid file automatically. A successful later
`saveAuthentication` call already replaces it atomically; retaining the file
until then avoids destructive recovery behavior.

**Verify**: `npm test -- alexa.test.ts` → focused tests pass, including the new
invalid-content cases.

### Step 3: Add regression tests and update troubleshooting text

Extend `app/test/alexa.test.ts` with malformed JSON and valid JSON missing a
required authentication field. Assert that the loader identifies invalid
content and that the initialization boundary takes the fresh-login path while
still rejecting a genuine filesystem read failure where practical. Use generic
placeholder data only; never put real credential values in tests or plans.

Update `app/DOCS.md` so invalid saved content is described as recoverable by
restarting into fresh sign-in, while retaining manual deletion as a fallback for
repeated login loops.

**Verify**: `npm test -- alexa.test.ts` and `npm run lint` → exit 0.

### Step 4: Run the full gate

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` from
`app/`. Inspect `git diff` for secret-bearing strings and confirm none were
added.

**Verify**: all commands exit 0; only Scope files and plan status are modified.

## Test plan

Follow the direct filesystem test pattern already used in
`app/test/alexa.test.ts` with temporary directories. Add cases for malformed
JSON, incomplete shape, missing file, valid round-trip, and preservation of
fatal non-content errors. If testing `initializeAlexa` requires mocking the
third-party remote, mock only the constructor/init callback surface and assert
that the login-required callback is reached; do not make a network request.

## Done criteria

- [ ] Malformed or obsolete saved auth reaches fresh login instead of process
  termination.
- [ ] Missing auth still follows the existing fresh-login path.
- [ ] Permission and unrelated filesystem errors remain visible and fatal.
- [ ] No credentials or auth file contents are logged.
- [ ] Focused and full lint/typecheck/test/build gates pass.
- [ ] No files outside Scope are modified.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

- The third-party library requires a valid saved auth object even for fresh
  login; report the observed requirement instead of discarding fields.
- Recoverable and fatal filesystem errors cannot be distinguished without
  changing the public API; stop and report the error shape.
- A test or log would need to include a token, cookie, account ID, or auth file
  contents.

## Maintenance notes

If Alexa changes its persisted cookie shape, update the typed invalid-content
classification and tests together. Keep fresh-login fallback narrowly limited
to content validation; silently ignoring permission, ownership, or storage
failures would hide an operational problem.
