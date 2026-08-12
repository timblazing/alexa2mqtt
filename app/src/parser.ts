export interface NormalizedReading {
  co_detected?: boolean;
  co_ppm?: number;
  humidity_percent?: number;
  iaq_score?: number;
  pm10_ug_m3?: number;
  pm25_ug_m3?: number;
  temperature_c?: number;
  voc_index?: number;
}

interface AlexaFeature {
  configuration?: {
    friendlyName?: {
      value?: {
        text?: unknown;
      };
    };
  } | null;
  name?: unknown;
  properties?: Array<{
    rangeValue?: { value?: unknown } | null;
    value?: { scale?: unknown; value?: unknown } | null;
  }> | null;
}

interface AirQualityResponse {
  data?: {
    endpoint?: {
      features?: AlexaFeature[] | null;
    } | null;
  } | null;
}

const RANGE_NAMES = {
  co_ppm: ['carbon monoxide'],
  humidity_percent: ['humidity', 'indoor humidity'],
  iaq_score: ['indoor air quality'],
  pm10_ug_m3: ['particulate matter pm10', 'pm 10', 'pm10'],
  pm25_ug_m3: ['pm 2.5', 'pm2.5', 'particulate matter'],
  voc_index: ['volatile organic compounds'],
} as const;

const normalizeFriendlyName = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const rangeValue = (feature: AlexaFeature): number | undefined => {
  for (const property of feature.properties ?? []) {
    const value = finiteNumber(property.rangeValue?.value);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
};

const round = (value: number): number => Math.round(value * 100) / 100;

const temperatureCelsius = (feature: AlexaFeature): number | undefined => {
  for (const property of feature.properties ?? []) {
    const value = finiteNumber(property.value?.value);
    if (value === undefined) {
      continue;
    }

    switch (property.value?.scale) {
      case 'CELSIUS':
        return value;
      case 'FAHRENHEIT':
        return round(((value - 32) * 5) / 9);
      case 'KELVIN':
        return round(value - 273.15);
      default:
        continue;
    }
  }

  return undefined;
};

export class UnsupportedAirQualityResponseError extends Error {
  constructor() {
    super('The Alexa response contained no supported air-quality measurements');
    this.name = 'UnsupportedAirQualityResponseError';
  }
}

export const parseAirQualityResponse = (
  response: unknown,
): NormalizedReading => {
  const features = (response as AirQualityResponse)?.data?.endpoint?.features;
  if (!Array.isArray(features)) {
    throw new UnsupportedAirQualityResponseError();
  }

  const reading: NormalizedReading = {};

  for (const feature of features) {
    if (feature.name === 'temperatureSensor') {
      const value = temperatureCelsius(feature);
      if (value !== undefined) {
        reading.temperature_c = value;
      }
      continue;
    }

    if (feature.name !== 'range') {
      continue;
    }

    const rawName = feature.configuration?.friendlyName?.value?.text;
    if (typeof rawName !== 'string') {
      continue;
    }

    const value = rangeValue(feature);
    if (value === undefined) {
      continue;
    }

    const friendlyName = normalizeFriendlyName(rawName);
    for (const [metric, aliases] of Object.entries(RANGE_NAMES)) {
      if (aliases.some((alias) => alias === friendlyName)) {
        reading[metric as keyof typeof RANGE_NAMES] = value;
        break;
      }
    }
  }

  if (reading.co_ppm !== undefined) {
    reading.co_detected = reading.co_ppm > 10;
  }

  if (Object.keys(reading).length === 0) {
    throw new UnsupportedAirQualityResponseError();
  }

  return reading;
};
