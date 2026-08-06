import { describe, expect, it } from 'vitest';

import { backoffDelayMs } from '../src/polling.js';

describe('backoffDelayMs', () => {
  it('backs off from 10 seconds to a five-minute cap', () => {
    const noJitter = (): number => 0.5;

    expect(
      Array.from({ length: 7 }, (_, index) =>
        backoffDelayMs(index + 1, noJitter),
      ),
    ).toEqual([10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]);
  });

  it('applies bounded jitter', () => {
    expect(backoffDelayMs(1, () => 0)).toBe(8_000);
    expect(backoffDelayMs(1, () => 1)).toBe(12_000);
  });
});
