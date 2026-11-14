import { describe, expect, it, vi } from 'vitest';
import { QueryCache, queryKey, stableStringify } from './queryCache';
import type { CacheEntry } from './queryCache';

function entry(revision: number, data: unknown = revision): CacheEntry {
  return { revision, outcome: { ok: true, data } };
}

/** A loader whose answer the test releases by hand. */
function deferredLoader(result: CacheEntry) {
  let release: () => void = () => undefined;
  const loader = vi.fn(
    () =>
      new Promise<CacheEntry>((resolve) => {
        release = () => {
          resolve(result);
        };
      }),
  );
  return {
    loader,
    release: () => {
      release();
    },
  };
}

describe('stableStringify and queryKey', () => {
  it('sorts object keys at every level', () => {
    expect(stableStringify({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}',
    );
  });

  it('gives the same key whatever order the arguments were written in', () => {
    expect(queryKey('roster.rows', { promotionId: 'pro_1', limit: 5 })).toBe(
      queryKey('roster.rows', { limit: 5, promotionId: 'pro_1' }),
    );
    expect(queryKey('roster.rows', { limit: 5 })).not.toBe(queryKey('roster.rows', { limit: 6 }));
    expect(queryKey('clock.get', {})).toBe('clock.get:{}');
  });

  it('copes with undefined arguments', () => {
    expect(queryKey('clock.get', undefined)).toBe('clock.get:undefined');
  });
});

describe('QueryCache', () => {
  it('stores what a fetch loads', async () => {
    const cache = new QueryCache();
    await cache.fetch('a', () => Promise.resolve(entry(1)));
    expect(cache.peek('a')).toEqual(entry(1));
  });

  it('shares one request between concurrent fetches of a key', async () => {
    const cache = new QueryCache();
    const deferred = deferredLoader(entry(1));
    const first = cache.fetch('a', deferred.loader);
    const second = cache.fetch('a', deferred.loader);
    expect(cache.isFetching('a')).toBe(true);
    deferred.release();

    await expect(first).resolves.toEqual(entry(1));
    await expect(second).resolves.toEqual(entry(1));
    expect(deferred.loader).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(cache.isFetching('a')).toBe(false);
    });
  });

  it('keeps the previous entry while a refetch is on its way', async () => {
    const cache = new QueryCache();
    cache.set('a', entry(1, 'old'));
    const deferred = deferredLoader(entry(2, 'new'));
    const refetch = cache.fetch('a', deferred.loader);
    expect(cache.peek('a')).toEqual(entry(1, 'old'));
    deferred.release();
    await refetch;
    expect(cache.peek('a')).toEqual(entry(2, 'new'));
  });

  it('evicts the least recently used entry past its capacity', () => {
    const cache = new QueryCache(2);
    cache.set('a', entry(1));
    cache.set('b', entry(1));
    // Writing `a` again makes `b` the oldest.
    cache.set('a', entry(2));
    cache.set('c', entry(1));
    expect(cache.size).toBe(2);
    expect(cache.peek('b')).toBeUndefined();
    expect(cache.peek('a')).toEqual(entry(2));
    expect(cache.peek('c')).toEqual(entry(1));
  });

  it('holds at most 200 entries by default', () => {
    const cache = new QueryCache();
    for (let i = 0; i < 250; i += 1) cache.set(`key-${String(i)}`, entry(i));
    expect(cache.size).toBe(200);
    expect(cache.peek('key-49')).toBeUndefined();
    expect(cache.peek('key-50')).toEqual(entry(50));
  });

  it('drops everything on invalidateAll, including answers still on their way', async () => {
    const cache = new QueryCache();
    cache.set('a', entry(1));
    const deferred = deferredLoader(entry(2));
    const pending = cache.fetch('b', deferred.loader);
    cache.invalidateAll();
    deferred.release();
    await pending;
    expect(cache.size).toBe(0);
    expect(cache.isFetching('b')).toBe(false);
  });

  it('tells a key’s listeners when its entry or fetching state changes', async () => {
    const cache = new QueryCache();
    const listener = vi.fn();
    const unsubscribe = cache.subscribe('a', listener);
    cache.set('b', entry(1));
    expect(listener).not.toHaveBeenCalled();

    await cache.fetch('a', () => Promise.resolve(entry(1)));
    await vi.waitFor(() => {
      expect(cache.isFetching('a')).toBe(false);
    });
    // Fetch started, then the entry stored with the fetch finished.
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    cache.set('a', entry(2));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('starts a new request when a listener of the stored answer fetches again', async () => {
    const cache = new QueryCache();
    const stale = deferredLoader(entry(1));
    const fresh = vi.fn(() => Promise.resolve(entry(2)));
    let refetch: Promise<CacheEntry> | null = null;
    cache.subscribe('a', () => {
      // A mounted query that finds the answer older than the world asks again at once.
      if (cache.peek('a')?.revision === 1 && refetch === null) refetch = cache.fetch('a', fresh);
    });
    const first = cache.fetch('a', stale.loader);
    stale.release();
    await first;

    expect(fresh).toHaveBeenCalledTimes(1);
    await expect(refetch).resolves.toEqual(entry(2));
    expect(cache.peek('a')).toEqual(entry(2));
  });
});
