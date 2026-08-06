import { join } from 'node:path';

import {
  closeAlexa,
  describeEndpoint,
  discoverEndpoints,
  findAirQualityEndpoints,
  initializeAlexa,
  queryAirQuality,
} from './alexa.js';
import { writeSanitizedCapture } from './capture.js';
import { loadConfig } from './config.js';
import { parseAirQualityResponse } from './parser.js';

const main = async (): Promise<void> => {
  const config = loadConfig();
  const authPath = join(config.dataDir, 'auth.json');
  const capturesDir = join(config.dataDir, 'captures');

  console.info(
    `Starting Phase 1 proof of concept (Amazon domain: ${config.amazonDomain})`,
  );
  console.info(
    `Amazon login proxy: http://${config.proxyHost}:${config.proxyPort}/`,
  );

  const remote = await initializeAlexa(config, authPath);
  console.info('Alexa authentication succeeded. Discovering devices...');

  const { endpoints, response: discoveryResponse } =
    await discoverEndpoints(remote);
  if (config.captureFixtures) {
    const path = await writeSanitizedCapture(
      capturesDir,
      'discovery',
      discoveryResponse,
    );
    console.info(`Wrote sanitized discovery capture to ${path}`);
  }

  const monitors = findAirQualityEndpoints(endpoints);
  if (monitors.length === 0) {
    throw new Error(
      `No Amazon air-quality monitor found among ${endpoints.length} discovered endpoints`,
    );
  }

  console.info(`Found ${monitors.length} air-quality monitor(s):`);
  for (const endpoint of monitors) {
    console.info(`- ${describeEndpoint(endpoint)}`);
  }

  for (const [index, endpoint] of monitors.entries()) {
    const response = await queryAirQuality(remote, endpoint);
    if (config.captureFixtures) {
      const path = await writeSanitizedCapture(
        capturesDir,
        `air-quality-state-${index + 1}`,
        response,
      );
      console.info(`Wrote sanitized state capture to ${path}`);
    }

    console.info(
      JSON.stringify(
        {
          device_name: endpoint.friendlyName ?? `Monitor ${index + 1}`,
          ...parseAirQualityResponse(response),
        },
        null,
        2,
      ),
    );
  }

  if (config.once) {
    await closeAlexa(remote);
    return;
  }

  console.info(
    'Proof of concept is running to observe cookie refresh. Press Ctrl-C to stop.',
  );

  const shutdown = (): void => {
    void closeAlexa(remote).finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
