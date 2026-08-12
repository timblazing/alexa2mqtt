import { describe, expect, it } from 'vitest';

import {
  isAutoMqttUrl,
  loadConfig,
  parseMqttUrl,
  MQTT_AUTO_URL,
} from '../src/config.js';

describe('mqtt_url resolution', () => {
  it('recognizes the Supervisor auto sentinel', () => {
    expect(isAutoMqttUrl(MQTT_AUTO_URL)).toBe(true);
    expect(isAutoMqttUrl(` ${MQTT_AUTO_URL} `)).toBe(true);
    expect(isAutoMqttUrl('mqtt://broker.example:1883')).toBe(false);
  });

  it('parses a fully specified external broker URL', () => {
    expect(parseMqttUrl('mqtts://bridge:s3cr%40t@broker.example:8884')).toEqual({
      host: 'broker.example',
      password: 's3cr@t',
      port: 8884,
      protocol: 'mqtts',
      username: 'bridge',
    });
  });

  it('applies the default port for the scheme and allows anonymous brokers', () => {
    expect(parseMqttUrl('mqtt://192.168.1.10')).toEqual({
      host: '192.168.1.10',
      password: undefined,
      port: 1883,
      protocol: 'mqtt',
      username: undefined,
    });
  });

  it('rejects malformed values', () => {
    expect(() => parseMqttUrl('not a url')).toThrow('mqtt_url must be a URL');
    expect(() => parseMqttUrl('https://broker.example')).toThrow(
      'unsupported scheme',
    );
    expect(() => parseMqttUrl('mqtt://broker.example/topic')).toThrow(
      'must not contain a path',
    );
  });

  it('never repeats the raw value in the malformed-URL message', () => {
    let message = '';
    try {
      parseMqttUrl('mqtt://user:hunter2@');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('mqtt_url must be a URL');
    expect(message).not.toContain('hunter2');
  });
});

describe('loadConfig', () => {
  it('keeps the MQTT_HOST style configuration used by npm run dev', () => {
    const config = loadConfig(
      {
        MQTT_HOST: 'broker.local',
        MQTT_PASSWORD: 'from-env',
        MQTT_PORT: '1884',
        MQTT_USERNAME: 'env-user',
      },
      '/workspace',
    );

    expect(config).toMatchObject({
      authPath: '/workspace/data/auth.json',
      mqttHost: 'broker.local',
      mqttPassword: 'from-env',
      mqttPort: 1884,
      mqttProtocol: 'mqtt',
      mqttUsername: 'env-user',
      statePath: '/workspace/data/last-state.json',
      statusPort: 8099,
    });
  });

  it('falls back to the MQTT_* variables when mqtt_url is the sentinel', () => {
    const config = loadConfig(
      {
        MQTT_HOST: 'core-mosquitto',
        MQTT_PASSWORD: 'supervisor-password',
        MQTT_PORT: '1883',
        MQTT_URL: MQTT_AUTO_URL,
        MQTT_USERNAME: 'supervisor-user',
      },
      '/workspace',
    );

    expect(config).toMatchObject({
      mqttHost: 'core-mosquitto',
      mqttPassword: 'supervisor-password',
      mqttPort: 1883,
      mqttUsername: 'supervisor-user',
    });
  });

  it('prefers an explicit mqtt_url over the MQTT_* variables', () => {
    const config = loadConfig(
      {
        MQTT_HOST: 'ignored',
        MQTT_PASSWORD: 'ignored',
        MQTT_URL: 'mqtt://outside:1884',
        MQTT_USERNAME: 'ignored',
      },
      '/workspace',
    );

    expect(config).toMatchObject({
      mqttHost: 'outside',
      mqttPassword: undefined,
      mqttPort: 1884,
      mqttUsername: undefined,
    });
  });

  it('honours the add-on volume paths', () => {
    const config = loadConfig(
      {
        ALEXA_AUTH_PATH: '/data/auth.json',
        ALEXA_DATA_DIR: '/data',
        ALEXA_STATE_PATH: '/data/last-state.json',
        STATUS_PORT: '8099',
      },
      '/app',
    );

    expect(config).toMatchObject({
      authPath: '/data/auth.json',
      dataDir: '/data',
      statePath: '/data/last-state.json',
    });
  });
});
