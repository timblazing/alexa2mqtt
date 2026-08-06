import { describe, expect, it } from 'vitest';

import {
  emptyStateCache,
  mergeDeviceState,
  mergeReading,
  parseStateCache,
} from '../src/state.js';

const timestamp = '2026-08-06T20:00:00.000Z';

describe('last-known state', () => {
  it('merges partial readings without clearing prior measurements', () => {
    const previous = {
      co_detected: false,
      co_ppm: 1,
      humidity_percent: 52,
      iaq_score: 97,
      last_successful_update: '2026-08-06T19:00:00.000Z',
      pm25_ug_m3: 3,
      temperature_c: 22.5,
      voc_index: 2,
    };

    const merged = mergeReading(previous, { humidity_percent: 53 }, timestamp);

    expect(merged).toEqual({
      ...previous,
      humidity_percent: 53,
      last_successful_update: timestamp,
    });
    expect(previous.humidity_percent).toBe(52);
  });

  it('adds a device without mutating the prior cache', () => {
    const cache = emptyStateCache();
    const updated = mergeDeviceState(
      cache,
      { id: 'aaqm_1', name: 'Bedroom monitor' },
      { iaq_score: 97 },
      timestamp,
    );

    expect(cache.devices).toEqual({});
    expect(updated.devices.aaqm_1?.state).toEqual({
      iaq_score: 97,
      last_successful_update: timestamp,
    });
  });

  it('rejects corrupt persisted entries instead of publishing invalid values', () => {
    expect(() =>
      parseStateCache({
        devices: {
          aaqm_1: {
            device: { id: 'different_id', name: 'Monitor' },
            state: { last_successful_update: timestamp },
          },
        },
        version: 1,
      }),
    ).toThrow('entry "aaqm_1" is invalid');
  });
});
