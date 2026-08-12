import { join } from 'node:path';

import {
  closeAlexa,
  describeEndpoint,
  discoverEndpoints,
  findAirQualityEndpoints,
  initializeAlexa,
  queryAirQuality,
  type AlexaEndpoint,
} from './alexa.js';
import { writeSanitizedCapture } from './capture.js';
import { loadConfig, type Config } from './config.js';
import { deviceMetadataFromEndpoint } from './device.js';
import { connectMqtt, type MqttBridge } from './mqtt.js';
import { parseAirQualityResponse } from './parser.js';
import { backoffDelayMs, waitForDelay } from './polling.js';
import {
  startStatusServer,
  type AuthenticationStatus,
  type BridgeStatus,
  type MonitorStatus,
} from './server.js';
import { loadStateCache, saveStateCache } from './state-file.js';
import {
  mergeDeviceState,
  type DeviceMetadata,
  type StateCache,
} from './state.js';

interface Monitor {
  device: DeviceMetadata;
  endpoint: AlexaEndpoint;
  fixtureIndex: number;
}

interface PollCycleResult {
  cache: StateCache;
  successful: boolean;
}

const pollMonitors = async (
  monitors: Monitor[],
  remote: Awaited<ReturnType<typeof initializeAlexa>>,
  mqtt: MqttBridge,
  cache: StateCache,
  statePath: string,
  capturesDir: string,
  config: Config,
  monitorStatuses: Map<string, MonitorStatus>,
): Promise<PollCycleResult> => {
  const failures: string[] = [];
  let nextCache = cache;

  for (const monitor of monitors) {
    let response: unknown;
    let reading: ReturnType<typeof parseAirQualityResponse>;
    try {
      response = await queryAirQuality(remote, monitor.endpoint);
      reading = parseAirQualityResponse(response);
    } catch (error) {
      await mqtt.setAmazonConnected(monitor.device.id, false);
      monitorStatuses.set(monitor.device.id, {
        amazonConnected: false,
        name: monitor.device.name,
        state: monitorStatuses.get(monitor.device.id)?.state,
      });
      failures.push(
        `${monitor.device.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    nextCache = mergeDeviceState(
      nextCache,
      monitor.device,
      reading,
      new Date().toISOString(),
    );
    await saveStateCache(statePath, nextCache);
    await mqtt.updateDevice(
      monitor.device,
      nextCache.devices[monitor.device.id]!.state,
      true,
    );
    monitorStatuses.set(monitor.device.id, {
      amazonConnected: true,
      name: monitor.device.name,
      state: nextCache.devices[monitor.device.id]!.state,
    });

    if (config.captureFixtures) {
      try {
        const path = await writeSanitizedCapture(
          capturesDir,
          `air-quality-state-${monitor.fixtureIndex}`,
          response,
        );
        if (config.debug) {
          console.debug(`Wrote sanitized state capture to ${path}`);
        }
      } catch (error) {
        console.warn(
          `Could not write sanitized state capture: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  if (failures.length > 0) {
    console.warn(
      `Amazon poll failed for ${failures.length}/${monitors.length} monitor(s): ${failures.join('; ')}`,
    );
  } else {
    console.info(`Published fresh readings for ${monitors.length} monitor(s)`);
  }

  return { cache: nextCache, successful: failures.length === 0 };
};

const main = async (): Promise<void> => {
  const config = loadConfig();
  const authPath = config.authPath;
  const capturesDir = join(config.dataDir, 'captures');
  const statePath = config.statePath;
  const shutdown = new AbortController();
  const requestShutdown = (): void => shutdown.abort();
  process.once('SIGINT', requestShutdown);
  process.once('SIGTERM', requestShutdown);

  let mqtt: MqttBridge | undefined;
  let remote: Awaited<ReturnType<typeof initializeAlexa>> | undefined;
  let authentication: AuthenticationStatus = 'starting';
  const monitorStatuses = new Map<string, MonitorStatus>();
  const readStatus = (): BridgeStatus => ({
    authentication,
    loginProxyUrl: `http://${config.proxyHost}:${config.proxyPort}/`,
    monitors: [...monitorStatuses.values()],
    mqttConnected: mqtt?.connected ?? false,
    pollIntervalSeconds: config.pollIntervalSeconds,
  });
  const statusServer = await startStatusServer(config.statusPort, readStatus);
  console.info(`Status page listening on port ${config.statusPort}`);

  try {
    let cache = await loadStateCache(statePath);
    for (const { device, state } of Object.values(cache.devices)) {
      monitorStatuses.set(device.id, {
        amazonConnected: false,
        name: device.name,
        state,
      });
    }
    console.info(
      `Starting MQTT bridge (broker: ${config.mqttHost}:${config.mqttPort}, cached monitors: ${Object.keys(cache.devices).length})`,
    );
    mqtt = await connectMqtt(config);
    await mqtt.restore(cache);
    console.info('MQTT connected; retained discovery and cached state published');

    console.info(
      `Amazon login proxy: http://${config.proxyHost}:${config.proxyPort}/`,
    );
    remote = await initializeAlexa(config, authPath, () => {
      authentication = 'waiting-for-login';
    });
    if (shutdown.signal.aborted) {
      return;
    }
    authentication = 'authenticated';
    console.info('Alexa authentication succeeded. Discovering devices...');

    const { endpoints, response: discoveryResponse } =
      await discoverEndpoints(remote);
    if (config.captureFixtures) {
      const path = await writeSanitizedCapture(
        capturesDir,
        'discovery',
        discoveryResponse,
      );
      if (config.debug) {
        console.debug(`Wrote sanitized discovery capture to ${path}`);
      }
    }

    const endpointsWithAirQuality = findAirQualityEndpoints(endpoints);
    if (endpointsWithAirQuality.length === 0) {
      throw new Error(
        `No Amazon air-quality monitor found among ${endpoints.length} discovered endpoints`,
      );
    }

    const monitors = endpointsWithAirQuality.map((endpoint, index): Monitor => ({
      device: deviceMetadataFromEndpoint(endpoint, index + 1),
      endpoint,
      fixtureIndex: index + 1,
    }));

    console.info(`Found ${monitors.length} air-quality monitor(s):`);
    for (const monitor of monitors) {
      console.info(`- ${describeEndpoint(monitor.endpoint)}`);
      await mqtt.registerDevice(monitor.device);
      monitorStatuses.set(monitor.device.id, {
        amazonConnected: false,
        name: monitor.device.name,
        state: cache.devices[monitor.device.id]?.state,
      });
    }

    let consecutiveFailures = 0;
    while (!shutdown.signal.aborted) {
      const result = await pollMonitors(
        monitors,
        remote,
        mqtt,
        cache,
        statePath,
        capturesDir,
        config,
        monitorStatuses,
      );
      cache = result.cache;

      if (config.once) {
        if (!result.successful) {
          throw new Error('One-shot poll did not succeed for every monitor');
        }
        break;
      }

      if (result.successful) {
        consecutiveFailures = 0;
        await waitForDelay(
          config.pollIntervalSeconds * 1000,
          shutdown.signal,
        );
      } else {
        consecutiveFailures += 1;
        const delay = backoffDelayMs(consecutiveFailures);
        console.info(`Retrying Amazon poll in ${Math.round(delay / 1000)} seconds`);
        await waitForDelay(delay, shutdown.signal);
      }
    }
  } finally {
    process.removeListener('SIGINT', requestShutdown);
    process.removeListener('SIGTERM', requestShutdown);
    if (remote) {
      await closeAlexa(remote);
    }
    if (mqtt) {
      await mqtt.close();
    }
    await statusServer.close();
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
