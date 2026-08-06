import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  emptyStateCache,
  parseStateCache,
  type StateCache,
} from './state.js';

export const loadStateCache = async (path: string): Promise<StateCache> => {
  try {
    return parseStateCache(JSON.parse(await readFile(path, 'utf8')) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyStateCache();
    }
    throw new Error(`Could not load last-known state: ${String(error)}`, {
      cause: error,
    });
  }
};

export const saveStateCache = async (
  path: string,
  cache: StateCache,
): Promise<void> => {
  const temporary = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
  await chmod(path, 0o600);
};
