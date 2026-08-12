import { describe, expect, it } from 'vitest';

import { renderStatusPage, type BridgeStatus } from '../src/server.js';

const status: BridgeStatus = {
  authentication: 'authenticated',
  loginProxyUrl: 'http://192.168.1.42:8098/',
  monitors: [
    {
      amazonConnected: true,
      name: 'Bedroom monitor',
      state: {
        co_detected: false,
        co_ppm: 1,
        humidity_percent: 52,
        iaq_score: 97,
        last_successful_update: '2026-08-12T19:26:34.000Z',
        pm25_ug_m3: 3,
        temperature_c: 22.5,
        voc_index: 2,
      },
    },
  ],
  mqttConnected: true,
  pollIntervalSeconds: 60,
};

describe('status page', () => {
  it('shows every measurement and the login proxy port', () => {
    const page = renderStatusPage(status);

    expect(page).toContain('Bedroom monitor');
    expect(page).toContain('97');
    expect(page).toContain('22.5 °C');
    expect(page).toContain('52 %');
    expect(page).toContain('3 µg/m³');
    expect(page).toContain('1 ppm');
    expect(page).toContain('2026-08-12T19:26:34.000Z');
    expect(page).toContain('http://192.168.1.42:8098/');
  });

  it('renders unknown metrics rather than omitting them', () => {
    const page = renderStatusPage({
      ...status,
      authentication: 'waiting-for-login',
      monitors: [{ amazonConnected: false, name: 'New monitor' }],
    });

    expect(page).toContain('Amazon sign-in required');
    expect(page).toContain('Last successful update: never');
    expect((page.match(/unknown/g) ?? []).length).toBe(8);
  });

  it('escapes device names', () => {
    const page = renderStatusPage({
      ...status,
      monitors: [{ amazonConnected: true, name: '<script>alert(1)</script>' }],
    });

    expect(page).not.toContain('<script>alert(1)</script>');
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
