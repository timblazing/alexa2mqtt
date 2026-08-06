import { describe, expect, it } from 'vitest';

import {
  deviceIdFromEndpointId,
  deviceMetadataFromEndpoint,
} from '../src/device.js';

describe('device identity', () => {
  it('derives stable, topic-safe IDs from endpoint IDs rather than names', () => {
    const first = deviceIdFromEndpointId('amzn1.alexa.endpoint.private-one');
    const repeated = deviceIdFromEndpointId('amzn1.alexa.endpoint.private-one');
    const second = deviceIdFromEndpointId('amzn1.alexa.endpoint.private-two');

    expect(first).toBe(repeated);
    expect(first).not.toBe(second);
    expect(first).toMatch(/^aaqm_[a-f0-9]{16}$/);
    expect(first).not.toContain('private-one');
  });

  it('uses Alexa metadata without making the display name part of the ID', () => {
    const endpoint = {
      friendlyName: 'Bedroom monitor',
      id: 'stable-endpoint-id',
      manufacturer: { value: { text: 'Amazon' } },
      model: { value: { text: 'Smart Air Quality Monitor' } },
    };

    const original = deviceMetadataFromEndpoint(endpoint, 1);
    const renamed = deviceMetadataFromEndpoint(
      { ...endpoint, friendlyName: 'Office monitor' },
      1,
    );

    expect(original.id).toBe(renamed.id);
    expect(original.name).toBe('Bedroom monitor');
    expect(renamed.name).toBe('Office monitor');
  });
});
