import { randomBytes } from 'node:crypto';

import {
  connectAsync,
  type IClientOptions,
  type MqttClient,
} from 'mqtt';

import type { Config } from './config.js';
import type {
  CachedDevice,
  DeviceMetadata,
  DeviceState,
  StateCache,
} from './state.js';

const APP_NAME = 'Amazon Air Quality to MQTT';
const APP_VERSION = '0.1.0';
const SUPPORT_URL = 'https://github.com/timblazing/amazon-air-quality-mqtt';
const DISCOVERY_PREFIX = 'homeassistant';

interface RuntimeDevice {
  amazonConnected: boolean;
  device: DeviceMetadata;
  state?: DeviceState;
}

interface DiscoveryComponent {
  availability_topic?: string;
  device_class?: string;
  entity_category?: 'diagnostic';
  name: string;
  p: 'binary_sensor' | 'sensor';
  payload_off?: string;
  payload_on?: string;
  state_class?: 'measurement';
  state_topic?: string;
  unique_id: string;
  unit_of_measurement?: string;
  value_template?: string;
}

export interface DeviceDiscoveryPayload {
  cmps: Record<string, DiscoveryComponent>;
  dev: {
    ids: string[];
    mf?: string;
    mdl?: string;
    name: string;
  };
  o: {
    name: string;
    sw: string;
    url: string;
  };
  qos: 1;
  state_topic: string;
}

export interface DeviceTopics {
  availability: string;
  discovery: string;
  state: string;
}

export const deviceTopics = (
  topicPrefix: string,
  deviceId: string,
): DeviceTopics => ({
  availability: `${topicPrefix}/bridge/availability`,
  discovery: `${DISCOVERY_PREFIX}/device/${deviceId}/config`,
  state: `${topicPrefix}/${deviceId}/state`,
});

export const buildDeviceDiscoveryPayload = (
  topicPrefix: string,
  device: DeviceMetadata,
): DeviceDiscoveryPayload => {
  const topics = deviceTopics(topicPrefix, device.id);
  const component = (
    suffix: string,
    definition: Omit<DiscoveryComponent, 'unique_id'>,
  ): DiscoveryComponent => ({
    ...definition,
    unique_id: `${device.id}_${suffix}`,
  });

  return {
    cmps: {
      amazon_connected: component('amazon_connected', {
        availability_topic: topics.availability,
        device_class: 'connectivity',
        entity_category: 'diagnostic',
        name: 'Amazon connected',
        p: 'binary_sensor',
        payload_off: 'OFF',
        payload_on: 'ON',
        value_template:
          "{{ 'ON' if value_json.amazon_connected else 'OFF' }}",
      }),
      bridge_connected: component('bridge_connected', {
        device_class: 'connectivity',
        entity_category: 'diagnostic',
        name: 'Bridge connected',
        p: 'binary_sensor',
        payload_off: 'offline',
        payload_on: 'online',
        state_topic: topics.availability,
      }),
      co_detected: component('co_detected', {
        device_class: 'carbon_monoxide',
        name: 'CO detected',
        p: 'binary_sensor',
        payload_off: 'OFF',
        payload_on: 'ON',
        value_template:
          "{{ 'ON' if value_json.co_detected is true else 'OFF' if value_json.co_detected is false else none }}",
      }),
      co_ppm: component('co_ppm', {
        device_class: 'carbon_monoxide',
        name: 'CO level',
        p: 'sensor',
        state_class: 'measurement',
        unit_of_measurement: 'ppm',
        value_template: '{{ value_json.co_ppm }}',
      }),
      humidity_percent: component('humidity_percent', {
        device_class: 'humidity',
        name: 'Humidity',
        p: 'sensor',
        state_class: 'measurement',
        unit_of_measurement: '%',
        value_template: '{{ value_json.humidity_percent }}',
      }),
      iaq_score: component('iaq_score', {
        device_class: 'aqi',
        name: 'IAQ score',
        p: 'sensor',
        state_class: 'measurement',
        value_template: '{{ value_json.iaq_score }}',
      }),
      last_successful_update: component('last_successful_update', {
        device_class: 'timestamp',
        name: 'Last update',
        p: 'sensor',
        value_template: '{{ value_json.last_successful_update }}',
      }),
      pm25_ug_m3: component('pm25_ug_m3', {
        device_class: 'pm25',
        name: 'PM2.5',
        p: 'sensor',
        state_class: 'measurement',
        unit_of_measurement: 'µg/m³',
        value_template: '{{ value_json.pm25_ug_m3 }}',
      }),
      temperature_c: component('temperature_c', {
        device_class: 'temperature',
        name: 'Temperature',
        p: 'sensor',
        state_class: 'measurement',
        unit_of_measurement: '°C',
        value_template: '{{ value_json.temperature_c }}',
      }),
      voc_index: component('voc_index', {
        name: 'VOC index',
        p: 'sensor',
        state_class: 'measurement',
        value_template: '{{ value_json.voc_index }}',
      }),
    },
    dev: {
      ids: [device.id],
      mf: device.manufacturer,
      mdl: device.model,
      name: device.name,
    },
    o: {
      name: APP_NAME,
      sw: APP_VERSION,
      url: SUPPORT_URL,
    },
    qos: 1,
    state_topic: topics.state,
  };
};

const mqttUrl = (config: Config): string => {
  const host = config.mqttHost.includes(':')
    ? `[${config.mqttHost}]`
    : config.mqttHost;
  return `mqtt://${host}:${config.mqttPort}`;
};

const sameMetadata = (
  left: DeviceMetadata,
  right: DeviceMetadata,
): boolean =>
  left.id === right.id &&
  left.manufacturer === right.manufacturer &&
  left.model === right.model &&
  left.name === right.name;

export class MqttBridge {
  readonly #client: MqttClient;
  readonly #devices = new Map<string, RuntimeDevice>();
  readonly #topicPrefix: string;
  #connected = true;
  #outbound = Promise.resolve();
  #stopping = false;

  constructor(client: MqttClient, topicPrefix: string) {
    this.#client = client;
    this.#topicPrefix = topicPrefix;

    client.on('connect', () => {
      this.#connected = true;
      if (!this.#stopping) {
        void this.#enqueue(() => this.#publishEverything());
      }
    });
    client.on('offline', () => {
      this.#connected = false;
    });
    client.on('close', () => {
      this.#connected = false;
    });
    client.on('error', (error) => {
      console.error(`MQTT client error: ${error.message}`);
    });
    client.on('message', (topic, payload) => {
      if (
        topic === `${DISCOVERY_PREFIX}/status` &&
        payload.toString().trim() === 'online'
      ) {
        void this.#enqueue(() => this.#publishEverything());
      }
    });
  }

  async initialize(): Promise<void> {
    await this.#enqueue(() => this.#publishEverything());
  }

  async restore(cache: StateCache): Promise<void> {
    for (const { device, state } of Object.values(cache.devices)) {
      this.#devices.set(device.id, {
        amazonConnected: false,
        device,
        state,
      });
    }
    await this.#enqueue(() => this.#publishDevices(Object.values(cache.devices)));
  }

  async registerDevice(device: DeviceMetadata): Promise<void> {
    const current = this.#devices.get(device.id);
    const metadataChanged = !current || !sameMetadata(current.device, device);
    this.#devices.set(device.id, {
      amazonConnected: current?.amazonConnected ?? false,
      device,
      state: current?.state,
    });

    await this.#enqueue(async () => {
      if (!this.#connected) {
        return;
      }
      if (metadataChanged) {
        await this.#publishDiscovery(device);
      }
      await this.#publishState(this.#devices.get(device.id)!);
    });
  }

  async updateDevice(
    device: DeviceMetadata,
    state: DeviceState,
    amazonConnected: boolean,
  ): Promise<void> {
    const current = this.#devices.get(device.id);
    const metadataChanged = !current || !sameMetadata(current.device, device);
    const runtime = { amazonConnected, device, state };
    this.#devices.set(device.id, runtime);

    await this.#enqueue(async () => {
      if (!this.#connected) {
        return;
      }
      if (metadataChanged) {
        await this.#publishDiscovery(device);
      }
      await this.#publishState(runtime);
    });
  }

  async setAmazonConnected(
    deviceId: string,
    amazonConnected: boolean,
  ): Promise<void> {
    const runtime = this.#devices.get(deviceId);
    if (!runtime) {
      return;
    }
    runtime.amazonConnected = amazonConnected;
    await this.#enqueue(async () => {
      if (this.#connected) {
        await this.#publishState(runtime);
      }
    });
  }

  async close(): Promise<void> {
    this.#stopping = true;
    await this.#outbound;
    if (this.#client.connected) {
      await this.#client.publishAsync(
        deviceTopics(this.#topicPrefix, 'unused').availability,
        'offline',
        { qos: 1, retain: true },
      );
    }
    await this.#client.endAsync();
  }

  #enqueue(operation: () => Promise<void>): Promise<void> {
    const scheduled = this.#outbound.then(operation);
    this.#outbound = scheduled.catch((error: unknown) => {
      console.error(
        `Could not publish MQTT update: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    return this.#outbound;
  }

  async #publishEverything(): Promise<void> {
    if (!this.#connected || this.#stopping) {
      return;
    }

    await this.#client.subscribeAsync(`${DISCOVERY_PREFIX}/status`, { qos: 1 });
    await this.#client.publishAsync(
      deviceTopics(this.#topicPrefix, 'unused').availability,
      'online',
      { qos: 1, retain: true },
    );
    for (const runtime of this.#devices.values()) {
      await this.#publishDiscovery(runtime.device);
      await this.#publishState(runtime);
    }
  }

  async #publishDevices(devices: CachedDevice[]): Promise<void> {
    if (!this.#connected) {
      return;
    }
    for (const { device } of devices) {
      await this.#publishDiscovery(device);
      await this.#publishState(this.#devices.get(device.id)!);
    }
  }

  async #publishDiscovery(device: DeviceMetadata): Promise<void> {
    const topics = deviceTopics(this.#topicPrefix, device.id);
    await this.#client.publishAsync(
      topics.discovery,
      JSON.stringify(buildDeviceDiscoveryPayload(this.#topicPrefix, device)),
      { qos: 1, retain: true },
    );
  }

  async #publishState(runtime: RuntimeDevice): Promise<void> {
    const topics = deviceTopics(this.#topicPrefix, runtime.device.id);
    await this.#client.publishAsync(
      topics.state,
      JSON.stringify({
        ...runtime.state,
        amazon_connected: runtime.amazonConnected,
      }),
      { qos: 1, retain: true },
    );
  }
}

export const connectMqtt = async (config: Config): Promise<MqttBridge> => {
  const options: IClientOptions = {
    clean: true,
    clientId: `amazon_air_quality_mqtt_${randomBytes(6).toString('hex')}`,
    connectTimeout: 10_000,
    password: config.mqttPassword,
    reconnectPeriod: 5_000,
    username: config.mqttUsername,
    will: {
      payload: Buffer.from('offline'),
      qos: 1,
      retain: true,
      topic: deviceTopics(config.mqttTopicPrefix, 'unused').availability,
    },
  };

  const client = await connectAsync(mqttUrl(config), options);
  const bridge = new MqttBridge(client, config.mqttTopicPrefix);
  await bridge.initialize();
  return bridge;
};
