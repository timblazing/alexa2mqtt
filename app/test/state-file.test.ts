import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadStateCache, saveStateCache } from '../src/state-file.js';
import { emptyStateCache, mergeDeviceState } from '../src/state.js';

describe('last-known-state persistence', () => {
  it('returns an empty cache when no state file exists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aaqm-state-'));

    await expect(
      loadStateCache(join(directory, 'missing.json')),
    ).resolves.toEqual(emptyStateCache());
  });

  it('round-trips cached state with owner-only permissions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aaqm-state-'));
    const path = join(directory, 'last-state.json');
    const cache = mergeDeviceState(
      emptyStateCache(),
      { id: 'aaqm_1', name: 'Bedroom monitor' },
      { humidity_percent: 52, iaq_score: 97 },
      '2026-08-06T20:00:00.000Z',
    );

    await saveStateCache(path, cache);

    await expect(loadStateCache(path)).resolves.toEqual(cache);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
});
