import { createHash } from 'node:crypto';

import type { AlexaEndpoint } from './alexa.js';
import type { DeviceMetadata } from './state.js';

const readLabel = (
  value: { value?: { text?: string } } | null | undefined,
): string | undefined => {
  const label = value?.value?.text?.trim();
  return label || undefined;
};

export const deviceIdFromEndpointId = (endpointId: string): string =>
  `aaqm_${createHash('sha256').update(endpointId).digest('hex').slice(0, 16)}`;

export const deviceMetadataFromEndpoint = (
  endpoint: AlexaEndpoint,
  fallbackIndex: number,
): DeviceMetadata => {
  if (!endpoint.id) {
    throw new Error('Air-quality endpoint is missing its endpoint ID');
  }

  return {
    id: deviceIdFromEndpointId(endpoint.id),
    manufacturer: readLabel(endpoint.manufacturer) ?? 'Amazon',
    model: readLabel(endpoint.model) ?? 'Smart Air Quality Monitor',
    name: endpoint.friendlyName?.trim() || `Amazon Air Quality Monitor ${fallbackIndex}`,
  };
};
