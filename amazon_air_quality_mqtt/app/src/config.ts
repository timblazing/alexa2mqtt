import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';

export interface Config {
  amazonDomain: string;
  captureFixtures: boolean;
  dataDir: string;
  debug: boolean;
  once: boolean;
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

  const proxyPort = Number(env.ALEXA_PROXY_PORT ?? '8098');
  if (!Number.isInteger(proxyPort) || proxyPort < 1024 || proxyPort > 65535) {
    throw new Error('ALEXA_PROXY_PORT must be an integer between 1024 and 65535');
  }

  return {
    amazonDomain,
    captureFixtures: readBoolean(env.ALEXA_CAPTURE_FIXTURES, true),
    dataDir: resolve(cwd, env.ALEXA_DATA_DIR?.trim() || 'data'),
    debug: readBoolean(env.ALEXA_DEBUG, false),
    once: readBoolean(env.ALEXA_ONCE, false),
    proxyHost: env.ALEXA_PROXY_HOST?.trim() || defaultProxyHost(),
    proxyPort,
  };
};
