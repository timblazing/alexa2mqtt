import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';

export interface Config {
  amazonDomain: string;
  captureFixtures: boolean;
  dataDir: string;
  debug: boolean;
  mqttHost: string;
  mqttPassword?: string;
  mqttPort: number;
  mqttTopicPrefix: string;
  mqttUsername?: string;
  once: boolean;
  pollIntervalSeconds: number;
  proxyHost: string;
  proxyPort: number;
}

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

  const mqttHost = env.MQTT_HOST?.trim() || '127.0.0.1';
  if (mqttHost.includes('://') || /[/?#]/.test(mqttHost)) {
    throw new Error('MQTT_HOST must be a hostname or IP address without a scheme');
  }

  const mqttTopicPrefix =
    env.MQTT_TOPIC_PREFIX?.trim().replace(/^\/+|\/+$/g, '') ||
    'amazon_air_quality';
  if (/[+#\0]/.test(mqttTopicPrefix)) {
    throw new Error('MQTT_TOPIC_PREFIX cannot contain MQTT wildcards or null bytes');
  }

  const mqttUsername = env.MQTT_USERNAME?.trim() || undefined;
  const mqttPassword = env.MQTT_PASSWORD || undefined;

  return {
    amazonDomain,
    captureFixtures: readBoolean(env.ALEXA_CAPTURE_FIXTURES, false),
    dataDir: resolve(cwd, env.ALEXA_DATA_DIR?.trim() || 'data'),
    debug: readBoolean(env.ALEXA_DEBUG, false),
    mqttHost,
    mqttPassword,
    mqttPort: readInteger('MQTT_PORT', env.MQTT_PORT, 1883, 1, 65535),
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
  };
};
