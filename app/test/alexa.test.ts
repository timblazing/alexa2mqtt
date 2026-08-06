import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadAuthentication, saveAuthentication } from '../src/alexa.js';

const authentication = {
  localCookie: 'private-cookie',
  macDms: {
    adp_token: 'private-adp-token',
    device_private_key: 'private-key',
  },
  refreshToken: 'private-refresh-token',
};

describe('Alexa authentication persistence', () => {
  it('round-trips valid auth with owner-only permissions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aaqm-auth-'));
    const path = join(directory, 'auth.json');

    await saveAuthentication(path, authentication);

    expect(await loadAuthentication(path)).toEqual(authentication);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('returns undefined when no saved auth exists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aaqm-auth-'));

    await expect(loadAuthentication(join(directory, 'missing.json'))).resolves.toBe(
      undefined,
    );
  });

  it('rejects incomplete saved auth', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aaqm-auth-'));
    const path = join(directory, 'auth.json');

    await expect(saveAuthentication(path, { localCookie: 'only-one-field' })).rejects.toThrow(
      'incomplete authentication data',
    );
  });
});
