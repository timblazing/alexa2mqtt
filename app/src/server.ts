import { createServer, type Server } from 'node:http';

import type { DeviceState } from './state.js';

export type AuthenticationStatus =
  | 'authenticated'
  | 'starting'
  | 'waiting-for-login';

export interface MonitorStatus {
  amazonConnected: boolean;
  name: string;
  state?: DeviceState;
}

export interface BridgeStatus {
  authentication: AuthenticationStatus;
  loginProxyUrl: string;
  monitors: MonitorStatus[];
  mqttConnected: boolean;
  pollIntervalSeconds: number;
}

export interface StatusServer {
  close: () => Promise<void>;
}

const METRICS: Array<{ key: keyof DeviceState; label: string; unit?: string }> = [
  { key: 'iaq_score', label: 'IAQ score' },
  { key: 'temperature_c', label: 'Temperature', unit: '°C' },
  { key: 'humidity_percent', label: 'Humidity', unit: '%' },
  { key: 'pm25_ug_m3', label: 'PM2.5', unit: 'µg/m³' },
  { key: 'pm10_ug_m3', label: 'PM10', unit: 'µg/m³' },
  { key: 'co_ppm', label: 'CO level', unit: 'ppm' },
  { key: 'co_detected', label: 'CO detected' },
  { key: 'voc_index', label: 'VOC index' },
];

const AUTHENTICATION_LABELS: Record<AuthenticationStatus, string> = {
  authenticated: 'Signed in to Amazon',
  starting: 'Connecting to Amazon...',
  'waiting-for-login': 'Amazon sign-in required',
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatMetric = (value: boolean | number | string | undefined, unit?: string): string => {
  if (value === undefined) {
    return 'unknown';
  }

  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }

  return unit ? `${value} ${unit}` : String(value);
};

const renderMonitor = (monitor: MonitorStatus): string => {
  const rows = METRICS.map(
    ({ key, label, unit }) =>
      `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(formatMetric(monitor.state?.[key], unit))}</td></tr>`,
  ).join('');

  return `<section>
  <h2>${escapeHtml(monitor.name)}</h2>
  <p class="meta">Amazon connected: ${monitor.amazonConnected ? 'yes' : 'no'} &middot; Last successful update: ${escapeHtml(monitor.state?.last_successful_update ?? 'never')}</p>
  <table>${rows}</table>
</section>`;
};

export const renderStatusPage = (status: BridgeStatus): string => {
  const monitors = status.monitors.length
    ? status.monitors.map(renderMonitor).join('\n')
    : '<section><p>No air-quality monitors have been discovered yet.</p></section>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Amazon Air Quality to MQTT</title>
<style>
body { font-family: system-ui, sans-serif; margin: 0 auto; max-width: 40rem; padding: 1.5rem; }
h1 { font-size: 1.4rem; }
h2 { font-size: 1.1rem; margin-bottom: 0.25rem; }
p.meta { color: #555; font-size: 0.9rem; margin-top: 0; }
table { border-collapse: collapse; width: 100%; }
th, td { border-bottom: 1px solid #ddd; padding: 0.35rem 0.5rem; text-align: left; }
th { font-weight: 600; width: 12rem; }
.login { background: #fff4e5; border: 1px solid #f0c48a; border-radius: 0.4rem; padding: 0.75rem 1rem; }
</style>
</head>
<body>
<h1>Amazon Air Quality to MQTT</h1>
<p class="meta">MQTT broker: ${status.mqttConnected ? 'connected' : 'disconnected'} &middot; ${escapeHtml(AUTHENTICATION_LABELS[status.authentication])} &middot; Polling every ${status.pollIntervalSeconds} s</p>
<div class="login">
<p>Amazon sign-in runs on this address, and only answers to it. It is only needed while signing in.</p>
<p><a href="${escapeHtml(status.loginProxyUrl)}">${escapeHtml(status.loginProxyUrl)}</a></p>
</div>
${monitors}
</body>
</html>
`;
};

export const startStatusServer = async (
  port: number,
  readStatus: () => BridgeStatus,
): Promise<StatusServer> => {
  const server: Server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0];

    if (path === '/healthz') {
      const healthy = readStatus().mqttConnected;
      response.writeHead(healthy ? 200 : 503, {
        'content-type': 'text/plain; charset=utf-8',
      });
      response.end(healthy ? 'ok\n' : 'mqtt disconnected\n');
      return;
    }

    if (path === '/' || path === '/index.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(renderStatusPage(readStatus()));
      return;
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found\n');
  });

  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error): void => reject(error);
    server.once('error', failed);
    server.listen(port, '0.0.0.0', () => {
      server.removeListener('error', failed);
      resolve();
    });
  });

  server.on('error', (error) => {
    console.error(`Status server error: ${error.message}`);
  });

  return {
    close: async () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};
