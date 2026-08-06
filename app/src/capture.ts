import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const SENSITIVE_KEYS = new Set([
  'accountid',
  'accountname',
  'adp_token',
  'authorization_code',
  'cookie',
  'csrf',
  'customeremail',
  'customerid',
  'deviceaccountid',
  'deviceownercustomerid',
  'device_private_key',
  'deviceid',
  'deviceserial',
  'email',
  'endpointid',
  'entityid',
  'frc',
  'id',
  'localcookie',
  'macdms',
  'ownercustomerid',
  'directedid',
  'refreshtoken',
  'registrationid',
  'serialnumber',
]);

export const sanitizeAlexaPayload = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sanitizeAlexaPayload);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      SENSITIVE_KEYS.has(key.toLowerCase()) ||
      (key === 'friendlyName' && typeof child === 'string')
        ? '[redacted]'
        : sanitizeAlexaPayload(child),
    ]),
  );
};

export const writeSanitizedCapture = async (
  capturesDir: string,
  name: string,
  payload: unknown,
): Promise<string> => {
  const destination = join(capturesDir, `${name}.sanitized.json`);
  const temporary = `${destination}.${process.pid}.tmp`;

  await mkdir(dirname(destination), { recursive: true });
  await writeFile(
    temporary,
    `${JSON.stringify(sanitizeAlexaPayload(payload), null, 2)}\n`,
    { mode: 0o600 },
  );
  await rename(temporary, destination);

  return destination;
};
