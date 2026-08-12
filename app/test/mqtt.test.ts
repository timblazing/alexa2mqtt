import { describe, expect, it } from 'vitest';

import {
  buildDeviceDiscoveryPayload,
  deviceTopics,
} from '../src/mqtt.js';

const device = {
  id: 'aaqm_0123456789abcdef',
  manufacturer: 'Amazon',
  model: 'Smart Air Quality Monitor',
  name: 'Bedroom monitor',
};

describe('MQTT discovery', () => {
  it('builds one device-discovery payload with stable unique IDs', () => {
    const payload = buildDeviceDiscoveryPayload('alexa2mqtt', device);

    expect(payload.dev).toEqual({
      ids: [device.id],
      mf: 'Amazon',
      mdl: 'Smart Air Quality Monitor',
      name: 'Bedroom monitor',
    });
    expect(payload.state_topic).toBe(
      'alexa2mqtt/aaqm_0123456789abcdef/state',
    );
    expect(Object.keys(payload.cmps)).toHaveLength(11);
    expect(
      new Set(Object.values(payload.cmps).map(({ unique_id }) => unique_id)).size,
    ).toBe(11);
    expect(payload.cmps.temperature_c).toMatchObject({
      device_class: 'temperature',
      name: 'Temperature',
      unit_of_measurement: '°C',
      unique_id: `${device.id}_temperature_c`,
    });
    expect(payload.cmps.pm25_ug_m3).toMatchObject({
      device_class: 'pm25',
      unit_of_measurement: 'µg/m³',
    });
    expect(payload.cmps.pm10_ug_m3).toMatchObject({
      device_class: 'pm10',
      unit_of_measurement: 'µg/m³',
    });
    expect(payload.cmps.iaq_score?.name).toBe('IAQ score');
    expect(payload.cmps.co_ppm?.name).toBe('CO level');
    expect(payload.cmps.voc_index?.unit_of_measurement).toBeUndefined();
  });

  it('keeps bridge availability off measurement entities', () => {
    const payload = buildDeviceDiscoveryPayload('alexa2mqtt', device);
    const measurementIds = [
      'co_detected',
      'co_ppm',
      'humidity_percent',
      'iaq_score',
      'last_successful_update',
      'pm25_ug_m3',
      'temperature_c',
      'voc_index',
    ];

    for (const id of measurementIds) {
      expect(payload.cmps[id]?.availability_topic).toBeUndefined();
    }
    expect(payload.cmps.amazon_connected).toMatchObject({
      availability_topic: 'alexa2mqtt/bridge/availability',
      device_class: 'connectivity',
      entity_category: 'diagnostic',
    });
    expect(payload.cmps.bridge_connected).toMatchObject({
      device_class: 'connectivity',
      entity_category: 'diagnostic',
      state_topic: 'alexa2mqtt/bridge/availability',
    });
  });

  it('uses the required discovery, state, and LWT topics', () => {
    expect(deviceTopics('custom_prefix', device.id)).toEqual({
      availability: 'custom_prefix/bridge/availability',
      discovery: `homeassistant/device/${device.id}/config`,
      state: `custom_prefix/${device.id}/state`,
    });
  });
});
