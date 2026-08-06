/*
 * Alexa authentication and GraphQL behavior are adapted from
 * homebridge-alexa-smarthome, Copyright (c) 2023 Joey Hage (MIT), and use
 * alexa-remote2/alexa-cookie2, Copyright (c) Apollon77 and contributors (MIT).
 */
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import AlexaRemote, {
  type CallbackWithErrorAndBody,
  type InitOptions,
} from 'alexa-remote2';

import type { Config } from './config.js';

export interface AlexaEndpoint {
  displayCategories?: { primary?: { value?: string } } | null;
  enablement?: string;
  features?: AlexaFeature[] | null;
  friendlyName?: string;
  id?: string;
  manufacturer?: { value?: { text?: string } } | null;
  model?: { value?: { text?: string } } | null;
  serialNumber?: { value?: { text?: string } } | null;
}

interface AlexaFeature {
  configuration?: {
    friendlyName?: { value?: { text?: string } };
  } | null;
  instance?: string | null;
  name?: string;
  operations?: Array<{ name?: string }> | null;
  properties?: unknown[] | null;
}

interface AuthenticationData {
  amazonPage?: string;
  localCookie: string;
  macDms: {
    adp_token: string;
    device_private_key: string;
  };
  refreshToken: string;
  [key: string]: unknown;
}

interface GraphQlResponse {
  data?: unknown;
  errors?: Array<{ message?: string }>;
}

const ENDPOINTS_QUERY = `query Endpoints {
  endpoints {
    items {
      id
      friendlyName
      displayCategories { primary { value } }
      serialNumber { value { text } }
      enablement
      model { value { text } }
      manufacturer { value { text } }
      features {
        name
        instance
        operations { name }
        properties {
          name
          ... on RangeValue { rangeValue { value } }
          ... on TemperatureSensor { value { value scale } }
          ... on ToggleState { toggleStateValue }
        }
        configuration {
          ... on RangeConfiguration { friendlyName { value { text } } }
        }
      }
    }
  }
}`;

export const AIR_QUALITY_QUERY = `query getAirQualityStates(
  $endpointId: String!
) {
  endpoint(id: $endpointId) {
    features {
      name
      properties {
        name
        ... on RangeValue {
          rangeValue {
            value
          }
        }
        ... on TemperatureSensor {
          value {
            value
            scale
          }
        }
        ... on ToggleState {
          toggleStateValue
        }
      }
      configuration {
        ... on RangeConfiguration {
          friendlyName {
            value {
              text
            }
          }
        }
      }
    }
  }
}`;

const isAuthenticationData = (value: unknown): value is AuthenticationData => {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<AuthenticationData>;
  return (
    typeof candidate.localCookie === 'string' &&
    typeof candidate.refreshToken === 'string' &&
    candidate.macDms !== null &&
    typeof candidate.macDms === 'object' &&
    typeof candidate.macDms.adp_token === 'string' &&
    typeof candidate.macDms.device_private_key === 'string'
  );
};

export const loadAuthentication = async (
  authPath: string,
): Promise<AuthenticationData | undefined> => {
  try {
    const parsed = JSON.parse(await readFile(authPath, 'utf8')) as unknown;
    const candidate =
      parsed !== null &&
      typeof parsed === 'object' &&
      'cookieData' in parsed
        ? (parsed as { cookieData?: unknown }).cookieData
        : parsed;

    if (!isAuthenticationData(candidate)) {
      throw new Error('saved authentication has an unexpected shape');
    }

    return candidate;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return undefined;
    }
    throw new Error(`Could not load saved Alexa authentication: ${String(error)}`, {
      cause: error,
    });
  }
};

export const saveAuthentication = async (
  authPath: string,
  authentication: unknown,
): Promise<void> => {
  if (!isAuthenticationData(authentication)) {
    throw new Error('Alexa returned incomplete authentication data');
  }

  const temporary = `${authPath}.${process.pid}.tmp`;
  await mkdir(dirname(authPath), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(authentication)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, authPath);
  await chmod(authPath, 0o600);
};

const redactedAlexaLogger = (debug: boolean) => (message: unknown): void => {
  if (!debug || typeof message !== 'string') {
    return;
  }

  if (
    /cookie|csrf|token|customer|email|serial|device.?id|macdms|authorization/i.test(
      message,
    )
  ) {
    console.debug('[Alexa debug message omitted because it may contain secrets]');
    return;
  }

  console.debug(message);
};

const safeErrorMessage = (message: string): string => {
  if (/cookie|csrf|token|customer|email|serial|macdms|authorization/i.test(message)) {
    return '[sensitive Alexa error details omitted]';
  }

  return message
    .replace(/amzn1\.alexa\.endpoint\.[\w.-]+/gi, '[redacted endpoint]')
    .replace(
      /[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}/gi,
      '[redacted identifier]',
    );
};

const authenticationUrl = (message: string): string | undefined =>
  message.match(/http:\/\/[^\s]+:\d+\//)?.[0];

export const initializeAlexa = async (
  config: Config,
  authPath: string,
): Promise<AlexaRemote> => {
  const remote = new AlexaRemote();
  const savedAuthentication = await loadAuthentication(authPath);
  let pendingSave = Promise.resolve();

  remote.on('cookie', () => {
    const authentication = remote.cookieData as unknown;
    pendingSave = pendingSave
      .then(() => saveAuthentication(authPath, authentication))
      .then(() => console.info(`Alexa authentication saved to ${authPath}`))
      .catch((error: unknown) => {
        console.error(`Could not persist Alexa authentication: ${String(error)}`);
      });
  });

  const effectiveDomain = savedAuthentication?.amazonPage ?? config.amazonDomain;
  const options = {
    acceptLanguage: 'en-US',
    alexaServiceHost: `alexa.${effectiveDomain}`,
    amazonPage: effectiveDomain,
    amazonPageProxyLanguage: 'en_US',
    cookie: savedAuthentication?.localCookie,
    cookieRefreshInterval: 4 * 24 * 60 * 60 * 1000,
    deviceAppName: 'Amazon Air Quality to MQTT',
    formerRegistrationData: savedAuthentication,
    logger: redactedAlexaLogger(config.debug),
    macDms: savedAuthentication?.macDms,
    proxyLogLevel: config.debug ? 'info' : 'error',
    proxyOnly: true,
    proxyOwnIp: config.proxyHost,
    proxyPort: config.proxyPort,
    usePushConnection: false,
    useWsMqtt: false,
  } as InitOptions;

  return new Promise((resolve, reject) => {
    let loginPromptShown = false;
    let finished = false;

    remote.init(options, (error?: Error) => {
      if (finished) {
        return;
      }

      if (error) {
        const url = authenticationUrl(error.message);
        if (url) {
          if (!loginPromptShown) {
            loginPromptShown = true;
            console.info(`Authentication required. Open ${url}`);
            console.info('Waiting for the Amazon login to complete...');
          }
          return;
        }

        finished = true;
        reject(
          new Error(`Alexa initialization failed: ${safeErrorMessage(error.message)}`),
        );
        return;
      }

      finished = true;
      void pendingSave.then(() => resolve(remote));
    });
  });
};

const executeGraphQl = async <T>(
  remote: AlexaRemote,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> =>
  new Promise((resolve, reject) => {
    const callback = (error?: Error, body?: unknown): void => {
      if (error) {
        reject(error);
        return;
      }

      const response = body as GraphQlResponse | undefined;
      if (!response) {
        reject(new Error('Alexa returned an empty GraphQL response'));
        return;
      }

      if (response.errors?.length && response.data === undefined) {
        reject(
          new Error(
            `Alexa GraphQL error: ${response.errors
              .map(({ message }) => safeErrorMessage(message ?? 'unknown error'))
              .join('; ')}`,
          ),
        );
        return;
      }

      resolve(response as T);
    };

    remote.httpsGet(
      false,
      '/nexus/v1/graphql',
      callback as CallbackWithErrorAndBody,
      {
        data: JSON.stringify({ query, variables }),
        method: 'POST',
      },
    );
  });

export interface DiscoveryResponse {
  data?: {
    endpoints?: {
      items?: AlexaEndpoint[] | null;
    } | null;
  } | null;
}

export const discoverEndpoints = async (
  remote: AlexaRemote,
): Promise<{ endpoints: AlexaEndpoint[]; response: DiscoveryResponse }> => {
  const response = await executeGraphQl<DiscoveryResponse>(
    remote,
    ENDPOINTS_QUERY,
  );
  const endpoints = response.data?.endpoints?.items;
  if (!Array.isArray(endpoints)) {
    throw new Error('Alexa discovery response did not include an endpoint list');
  }

  return { endpoints, response };
};

const rangeFriendlyNames = (endpoint: AlexaEndpoint): string[] =>
  (endpoint.features ?? [])
    .filter((feature) => feature.name === 'range')
    .map((feature) => feature.configuration?.friendlyName?.value?.text)
    .filter((name): name is string => typeof name === 'string');

export const findAirQualityEndpoints = (
  endpoints: AlexaEndpoint[],
): AlexaEndpoint[] =>
  endpoints.filter((endpoint) =>
    rangeFriendlyNames(endpoint).some(
      (name) => name.trim().toLowerCase() === 'indoor air quality',
    ),
  );

export const describeEndpoint = (endpoint: AlexaEndpoint): string => {
  const name = endpoint.friendlyName?.trim() || 'Unnamed monitor';
  const ranges = rangeFriendlyNames(endpoint);
  return `${name} (range features: ${ranges.join(', ') || 'none'})`;
};

export const queryAirQuality = async (
  remote: AlexaRemote,
  endpoint: AlexaEndpoint,
): Promise<unknown> => {
  if (!endpoint.id) {
    throw new Error('Air-quality endpoint is missing its endpoint ID');
  }

  return executeGraphQl(remote, AIR_QUALITY_QUERY, {
    endpointId: endpoint.id,
  });
};

export const closeAlexa = async (remote: AlexaRemote): Promise<void> => {
  remote.stop();
  await Promise.race([
    new Promise<void>((resolve) => {
      remote.stopProxyServer(() => resolve());
    }),
    new Promise<void>((resolve) => setTimeout(resolve, 250)),
  ]);
};
