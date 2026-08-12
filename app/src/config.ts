import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';

export type MqttProtocol = 'mqtt' | 'mqtts' | 'ws' | 'wss';

export interface MqttEndpoint {
  host: string;
  password?: string;
  port: number;
  protocol: MqttProtocol;
  username?: string;
}

export interface Config {
  amazonDomain: string;
  authPath: string;
  captureFixtures: boolean;
  dataDir: string;
  debug: boolean;
  mqttHost: string;
  mqttPassword?: string;
  mqttPort: number;
  mqttProtocol: MqttProtocol;
  mqttTopicPrefix: string;
  mqttUsername?: string;
  once: boolean;
  pollIntervalSeconds: number;
  proxyHost: string;
  proxyPort: number;
  statePath: string;
  statusPort: number;
}

export const MQTT_AUTO_URL = 'mqtt://auto_username:auto_password@auto_hostname';

const DEFAULT_MQTT_PORTS: Record<MqttProtocol, number> = {
  mqtt: 1883,
  mqtts: 8883,
  ws: 80,
  wss: 443,
};

const isMqttProtocol = (value: string): value is MqttProtocol =>
  value in DEFAULT_MQTT_PORTS;

const parseUrl = (value: string): URL | undefined => {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
};

export const isAutoMqttUrl = (value: string): boolean =>
  parseUrl(value.trim())?.hostname === 'auto_hostname';

export const parseMqttUrl = (value: string): MqttEndpoint => {
  const url = parseUrl(value.trim());
  if (!url) {
    throw new Error(
      'mqtt_url must be a URL such as mqtt://broker.example:1883 (value hidden because it may contain a password)',
    );
  }

  const protocol = url.protocol.replace(/:$/, '');
  if (!isMqttProtocol(protocol)) {
    throw new Error(
      `mqtt_url uses the unsupported scheme "${protocol}"; use mqtt, mqtts, ws or wss`,
    );
  }

  const host = url.hostname.replace(/^\[|]$/g, '');
  if (!host) {
    throw new Error('mqtt_url is missing a broker hostname');
  }

  if (url.pathname !== '' && url.pathname !== '/') {
    throw new Error('mqtt_url must not contain a path');
  }

  const port = url.port ? Number(url.port) : DEFAULT_MQTT_PORTS[protocol];
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('mqtt_url must use a port between 1 and 65535');
  }

  return {
    host,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    port,
    protocol,
    username: url.username ? decodeURIComponent(url.username) : undefined,
  };
};

const readBoolean = (
  value: string | undefined,
  fallback: boolean,
): boolean => {
  if (value === undefined) {
    return fallback;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw new Error(`Expected true or false, received "${value}"`);
};

const defaultProxyHost = (): string => {
  for (const addresses of Object.values(networkInterfaces())) {
    const address = addresses?.find(
      (candidate) => candidate.family === 'IPv4' && !candidate.internal,
    );

    if (address) {
      return address.address;
    }
  }

  return '127.0.0.1';
};

const readInteger = (
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return parsed;
};

export const loadConfig = (
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): Config => {
  const amazonDomain = env.AMAZON_DOMAIN?.trim() || 'amazon.com';
  if (!/^amazon\.[a-z.]+$/i.test(amazonDomain)) {
    throw new Error(
      'AMAZON_DOMAIN must look like amazon.com or amazon.co.uk (no scheme or path)',
    );
  }

  const mqttUrl = env.MQTT_URL?.trim();
  const endpoint =
    mqttUrl && !isAutoMqttUrl(mqttUrl) ? parseMqttUrl(mqttUrl) : undefined;

  const mqttHost = endpoint?.host ?? (env.MQTT_HOST?.trim() || '127.0.0.1');
  if (mqttHost.includes('://') || /[/?#]/.test(mqttHost)) {
    throw new Error('MQTT_HOST must be a hostname or IP address without a scheme');
  }

  const mqttProtocol = env.MQTT_PROTOCOL?.trim() || 'mqtt';
  if (!isMqttProtocol(mqttProtocol)) {
    throw new Error('MQTT_PROTOCOL must be mqtt, mqtts, ws or wss');
  }

  const mqttTopicPrefix =
    env.MQTT_TOPIC_PREFIX?.trim().replace(/^\/+|\/+$/g, '') || 'alexa2mqtt';
  if (/[+#\0]/.test(mqttTopicPrefix)) {
    throw new Error('MQTT_TOPIC_PREFIX cannot contain MQTT wildcards or null bytes');
  }

  const mqttUsername = endpoint
    ? endpoint.username
    : env.MQTT_USERNAME?.trim() || undefined;
  const mqttPassword = endpoint ? endpoint.password : env.MQTT_PASSWORD || undefined;
  const dataDir = resolve(cwd, env.ALEXA_DATA_DIR?.trim() || 'data');

  return {
    amazonDomain,
    authPath: resolve(cwd, env.ALEXA_AUTH_PATH?.trim() || join(dataDir, 'auth.json')),
    captureFixtures: readBoolean(env.ALEXA_CAPTURE_FIXTURES, false),
    dataDir,
    debug: readBoolean(env.ALEXA_DEBUG, false),
    mqttHost,
    mqttPassword,
    mqttPort:
      endpoint?.port ?? readInteger('MQTT_PORT', env.MQTT_PORT, 1883, 1, 65535),
    mqttProtocol: endpoint?.protocol ?? mqttProtocol,
    mqttTopicPrefix,
    mqttUsername,
    once: readBoolean(env.ALEXA_ONCE, false),
    pollIntervalSeconds: readInteger(
      'POLL_INTERVAL',
      env.POLL_INTERVAL,
      60,
      15,
      900,
    ),
    proxyHost: env.ALEXA_PROXY_HOST?.trim() || defaultProxyHost(),
    proxyPort: readInteger(
      'ALEXA_PROXY_PORT',
      env.ALEXA_PROXY_PORT,
      8098,
      1024,
      65535,
    ),
    statePath: resolve(
      cwd,
      env.ALEXA_STATE_PATH?.trim() || join(dataDir, 'last-state.json'),
    ),
    statusPort: readInteger('STATUS_PORT', env.STATUS_PORT, 8099, 1, 65535),
  };
};
