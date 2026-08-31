# Plan 005: Surface authentication persistence failures

> **Executor instructions**: This plan is intended to run after Plan 004.
> Follow it step by step, preserve Plan 004's invalid-auth recovery behavior,
> run every verification gate, and update the status row in `plans/README.md`
> when complete.
>
> **Drift check**: `git diff --stat d5db71c..HEAD -- app/src/alexa.ts app/src/index.ts app/test/alexa.test.ts`
> Changes from Plan 004 are expected only where they match that plan's stated
> behavior. If the live code differs in another way, stop and report.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: Plans 001 and 004
- **Category**: bug
- **Planned at**: commit `d5db71c`, 2026-08-31

## Why this matters

Alexa authentication is usable in memory even when writing the persisted session
fails because of a full volume, permissions, or another storage error. The
current cookie-event queue logs the failure and resolves successfully, so the
app reports authentication success and polls normally while the next restart
will require another sign-in. Initial persistence failure should prevent the
startup path from claiming durable authentication; later refresh failures should
remain visible through a redacted, actionable callback rather than being
silently swallowed.

## Current state

- `app/src/alexa.ts` — listens for `cookie` events and serializes auth writes.
- `app/src/index.ts` — treats a resolved `initializeAlexa` promise as durable
  authentication and sets status to `authenticated` at lines 164–170.
- `app/test/alexa.test.ts` — tests direct save/load behavior but not the cookie
  event persistence queue.

Current swallowing behavior:

```ts
// app/src/alexa.ts:217-237
let pendingSave = Promise.resolve();
remote.on('cookie', () => {
  const authentication = remote.cookieData as unknown;
  // validation omitted here
  pendingSave = pendingSave
    .then(() => saveAuthentication(authPath, authentication))
    .then(() => console.info(`Alexa authentication saved to ${authPath}`))
    .catch((error: unknown) => {
      console.error(`Could not persist Alexa authentication: ${String(error)}`);
    });
});
```

```ts
// app/src/alexa.ts:288-290
finished = true;
void pendingSave.then(() => resolve(remote));
```

The error text must stay redacted: authentication files contain cookies, refresh
tokens, device keys, and related identifiers.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused auth tests | `npm test -- alexa.test.ts` from `app/` | Persistence tests pass |
| Full tests | `npm test` from `app/` | All tests pass |
| Typecheck | `npm run typecheck` from `app/` | Exit 0 |
| Lint | `npm run lint` from `app/` | Exit 0 |

## Scope

**In scope**:

- `app/src/alexa.ts`.
- `app/src/index.ts` only if needed to connect the persistence-error callback
  to existing logging/status behavior.
- `app/test/alexa.test.ts`.

**Out of scope**:

- Changing auth file format, required fields, cookie refresh interval, or proxy
  behavior.
- Logging credential values or changing the redaction policy to include more
  raw Alexa errors.
- Automatically deleting auth, forcing logout, or adding a UI reset control.
- Unrelated MQTT, parser, state, or configuration changes.

## Steps

### Step 1: Make the initial persistence result observable

Refactor the cookie-save queue so it continues serializing writes but retains
the first persistence failure until the `remote.init` success callback has
finished. On initial successful initialization, await the queued save result and
reject `initializeAlexa` with a generic persistence error if that initial save
failed. This causes the existing top-level cleanup/error path to run instead of
claiming durable authentication.

Do not leave a rejected promise unhandled. Later cookie events must be able to
enqueue a fresh save after an earlier failure, and every failure must be
observed.

**Verify**: `npm run typecheck` from `app/` → exit 0.

### Step 2: Add an explicit callback for post-startup persistence failures

Add an optional `onAuthenticationPersistenceError` callback to
`initializeAlexa`. Invoke it with a generic `Error` whenever a cookie refresh
save fails after initialization. In `app/src/index.ts`, connect the callback to
one actionable redacted error log; do not falsely change the status to
`waiting-for-login` while the in-memory session is still usable. The callback
must not expose the underlying auth payload or raw error text.

Preserve Plan 004's behavior: invalid saved content still falls back to fresh
login, while storage failures remain distinguishable and visible.

**Verify**: `npm run lint` and `npm run typecheck` from `app/` → exit 0.

### Step 3: Test initial and later save failures without network access

Extend `app/test/alexa.test.ts` using a mocked `alexa-remote2` constructor/init
callback or a narrowly extracted persistence-queue helper. Test:

- initial cookie save succeeds and initialization resolves;
- initial cookie save fails and initialization rejects with a generic
  persistence message;
- a later cookie save failure invokes the callback, is logged generically, and
  does not produce an unhandled rejection;
- a later save can succeed after an earlier failed save;
- no test assertion or log contains an auth credential value.

If mocking the third-party class proves brittle, extract only the queue logic
into a small local helper module and test that helper; do not add a new runtime
dependency or make the remote injectable throughout the application.

**Verify**: `npm test -- alexa.test.ts` → all focused auth tests pass.

### Step 4: Run the full gate

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` from
`app/`. Review the diff for unhandled promise paths and sensitive logging.

**Verify**: all commands exit 0; only Scope files and plan status are modified.

## Test plan

Keep the existing temporary-directory save/load tests. Add deterministic tests
around the cookie event and init callback using the same direct Vitest style as
the repository. Failure injection must be local and repeatable; do not rely on
filesystem permissions, timing, a real disk-full condition, or Alexa network
access.

## Done criteria

- [ ] Initial authentication persistence failure rejects initialization and is
  not reported as durable success.
- [ ] Post-startup persistence failures invoke an explicit callback and are
  observed without unhandled rejections.
- [ ] Later saves can recover after a failed save.
- [ ] Plan 004's invalid-auth fallback remains intact.
- [ ] No cookie, token, account ID, or auth payload is logged or asserted.
- [ ] Lint, typecheck, tests, and build pass.
- [ ] No files outside Scope are modified.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

- The remote library emits cookie events before the init callback in a way that
  makes initial versus later persistence impossible to distinguish; report the
  observed event order.
- Correct handling requires changing the auth file format or third-party
  library behavior.
- A proposed error path would expose raw auth-related error text or payload.

## Maintenance notes

The persistence queue is a durability boundary, not an authentication logout
boundary: a refresh failure may leave the current in-memory session usable.
Review future changes to cookie refresh and shutdown ordering against both the
initial rejection path and the post-startup callback path.
