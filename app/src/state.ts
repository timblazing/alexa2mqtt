import type { NormalizedReading } from './parser.js';

export interface DeviceMetadata {
  id: string;
  manufacturer?: string;
  model?: string;
  name: string;
}

export interface DeviceState extends NormalizedReading {
  last_successful_update: string;
}

export interface CachedDevice {
  device: DeviceMetadata;
  state: DeviceState;
}

export interface StateCache {
  devices: Record<string, CachedDevice>;
  version: 1;
}

const NUMBER_METRICS = [
  'co_ppm',
  'humidity_percent',
  'iaq_score',
  'pm10_ug_m3',
  'pm25_ug_m3',
  'temperature_c',
  'voc_index',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

const parseCachedDevice = (value: unknown): CachedDevice | undefined => {
  if (!isRecord(value) || !isRecord(value.device) || !isRecord(value.state)) {
    return undefined;
  }

  const id = optionalString(value.device.id);
  const name = optionalString(value.device.name);
  const lastSuccessfulUpdate = optionalString(
    value.state.last_successful_update,
  );
  if (
    !id ||
    !name ||
    !lastSuccessfulUpdate ||
    !Number.isFinite(Date.parse(lastSuccessfulUpdate))
  ) {
    return undefined;
  }

  const state: DeviceState = {
    last_successful_update: lastSuccessfulUpdate,
  };
  for (const metric of NUMBER_METRICS) {
    const metricValue = value.state[metric];
    if (typeof metricValue === 'number' && Number.isFinite(metricValue)) {
      state[metric] = metricValue;
    }
  }
  if (typeof value.state.co_detected === 'boolean') {
    state.co_detected = value.state.co_detected;
  }

  return {
    device: {
      id,
      manufacturer: optionalString(value.device.manufacturer),
      model: optionalString(value.device.model),
      name,
    },
    state,
  };
};

export const emptyStateCache = (): StateCache => ({
  devices: {},
  version: 1,
});

export const parseStateCache = (value: unknown): StateCache => {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.devices)) {
    throw new Error('Last-known-state file has an unsupported shape');
  }

  const devices: Record<string, CachedDevice> = {};
  for (const [id, candidate] of Object.entries(value.devices)) {
    const device = parseCachedDevice(candidate);
    if (!device || device.device.id !== id) {
      throw new Error(`Last-known-state entry "${id}" is invalid`);
    }
    devices[id] = device;
  }

  return { devices, version: 1 };
};

export const mergeReading = (
  previous: DeviceState | undefined,
  reading: NormalizedReading,
  successfulUpdate: string,
): DeviceState => {
  if (!Number.isFinite(Date.parse(successfulUpdate))) {
    throw new Error('Successful update timestamp must be a valid ISO timestamp');
  }

  return {
    ...previous,
    ...reading,
    last_successful_update: successfulUpdate,
  };
};

export const mergeDeviceState = (
  cache: StateCache,
  device: DeviceMetadata,
  reading: NormalizedReading,
  successfulUpdate: string,
): StateCache => ({
  devices: {
    ...cache.devices,
    [device.id]: {
      device,
      state: mergeReading(
        cache.devices[device.id]?.state,
        reading,
        successfulUpdate,
      ),
    },
  },
  version: 1,
});
