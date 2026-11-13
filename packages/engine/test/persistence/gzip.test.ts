import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { defaultGzipEngine, gunzip, gzip } from '../../src/persistence/gzip';

const text = new TextEncoder().encode(
  JSON.stringify({ roster: Array.from({ length: 2000 }, (_, index) => ({ id: index })) }),
);

describe('gzip', () => {
  it('uses the platform streams where they exist', () => {
    expect(defaultGzipEngine()).toBe('platform');
  });

  it('round-trips with the fallback used on browsers without CompressionStream', async () => {
    const packed = await gzip(text, 'fallback');
    expect(await gunzip(packed, Number.POSITIVE_INFINITY, 'fallback')).toEqual(text);
  });

  it('reads saves written by the other engine, both ways', async () => {
    const fromPlatform = await gzip(text, 'platform');
    const fromFallback = await gzip(text, 'fallback');
    expect(await gunzip(fromPlatform, Number.POSITIVE_INFINITY, 'fallback')).toEqual(text);
    expect(await gunzip(fromFallback, Number.POSITIVE_INFINITY, 'platform')).toEqual(text);
    expect(await gunzip(gzipSync(text), Number.POSITIVE_INFINITY, 'fallback')).toEqual(text);
  });

  it('stops the fallback once the output passes the limit', async () => {
    const packed = await gzip(text, 'fallback');
    expect(await gunzip(packed, 100, 'fallback')).toBeNull();
  });

  it('rejects truncated input in the fallback', async () => {
    const packed = await gzip(text, 'fallback');
    await expect(gunzip(packed.subarray(0, 40), 1_000_000, 'fallback')).rejects.toThrow();
  });
});
