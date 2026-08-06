import { describe, expect, it } from 'vitest';

import { sanitizeAlexaPayload } from '../src/capture.js';

describe('sanitizeAlexaPayload', () => {
  it('redacts identifiers and credentials while retaining range friendly names', () => {
    const sanitized = sanitizeAlexaPayload({
      cookie: 'secret-cookie',
      data: {
        endpoint: {
          friendlyName: 'Bedroom monitor',
          id: 'amzn1.alexa.endpoint.private',
          serialNumber: { value: { text: 'private-serial' } },
          features: [
            {
              configuration: {
                friendlyName: {
                  value: { text: 'Indoor air quality' },
                },
              },
            },
          ],
        },
      },
      refreshToken: 'secret-token',
    });

    expect(sanitized).toEqual({
      cookie: '[redacted]',
      data: {
        endpoint: {
          friendlyName: '[redacted]',
          id: '[redacted]',
          serialNumber: '[redacted]',
          features: [
            {
              configuration: {
                friendlyName: {
                  value: { text: 'Indoor air quality' },
                },
              },
            },
          ],
        },
      },
      refreshToken: '[redacted]',
    });
  });
});
