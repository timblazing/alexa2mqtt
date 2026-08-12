import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  parseAirQualityResponse,
  UnsupportedAirQualityResponseError,
} from '../src/parser.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('./fixtures/air-quality-state.json', import.meta.url),
    'utf8',
  ),
) as {
  data: { endpoint: { features: unknown[] } };
};

describe('parseAirQualityResponse', () => {
  it('normalizes the expected monitor measurements', () => {
    expect(parseAirQualityResponse(fixture)).toEqual({
      co_detected: false,
      co_ppm: 0,
      humidity_percent: 50,
      iaq_score: 91,
      pm10_ug_m3: 12,
      pm25_ug_m3: 8,
      temperature_c: 22,
      voc_index: 5,
    });
  });

  it('returns only metrics present in a partial response', () => {
    const partial = structuredClone(fixture);
    partial.data.endpoint.features = partial.data.endpoint.features.slice(0, 2);

    expect(parseAirQualityResponse(partial)).toEqual({
      humidity_percent: 50,
      temperature_c: 22,
    });
  });

  it('does not treat the separate PM10 feature as PM2.5', () => {
    const response = structuredClone(fixture);
    const pm10 = response.data.endpoint.features.find(
      (feature) =>
        (feature as {
          configuration?: { friendlyName?: { value?: { text?: string } } };
        }).configuration?.friendlyName?.value?.text === 'Particulate matter PM10',
    ) as { properties: Array<{ rangeValue: { value: number } }> };
    pm10.properties[0]!.rangeValue.value = 999;

    expect(parseAirQualityResponse(response).pm25_ug_m3).toBe(8);
  });

  it('reads PM10 from its own feature', () => {
    expect(parseAirQualityResponse(fixture).pm10_ug_m3).toBe(12);
  });

  it('ignores invalid numbers instead of manufacturing missing values', () => {
    expect(
      parseAirQualityResponse({
        data: {
          endpoint: {
            features: [
              {
                name: 'range',
                properties: [{ rangeValue: { value: Number.NaN } }],
                configuration: {
                  friendlyName: { value: { text: 'Humidity' } },
                },
              },
              {
                name: 'range',
                properties: [{ rangeValue: { value: 11 } }],
                configuration: {
                  friendlyName: { value: { text: 'Carbon monoxide' } },
                },
              },
            ],
          },
        },
      }),
    ).toEqual({ co_detected: true, co_ppm: 11 });
  });

  it('converts Fahrenheit and Kelvin readings to Celsius', () => {
    const response = (value: number, scale: string) => ({
      data: {
        endpoint: {
          features: [
            {
              name: 'temperatureSensor',
              properties: [{ value: { value, scale } }],
            },
          ],
        },
      },
    });

    expect(parseAirQualityResponse(response(72.5, 'FAHRENHEIT'))).toEqual({
      temperature_c: 22.5,
    });
    expect(parseAirQualityResponse(response(295.65, 'KELVIN'))).toEqual({
      temperature_c: 22.5,
    });
  });

  it('rejects unsupported response shapes', () => {
    expect(() => parseAirQualityResponse({ data: {} })).toThrow(
      UnsupportedAirQualityResponseError,
    );
  });
});
