/**
 * The query cache. One integer decides freshness: an entry remembers the world revision it was
 * computed at, and it is stale once the engine reports a newer one. That rule is small enough that
 * a purpose-built cache is simpler than adapting a general data-fetching library.
 *
 * Keys are `name:args` with the argument keys sorted, so `{ a, b }` and `{ b, a }` share an entry.
 * Concurrent fetches of one key share one request. The cache keeps the 200 most recently used
 * entries. Listeners hear about every change to their key, which is how mounted queries update.
 */

import type { Reason } from '@ringside/engine';

/** Why a query has no data: the engine refused it, or the call never got an answer. */
export type EngineQueryError =
  | { readonly kind: 'rejected'; readonly reasons: Reason[] }
  | { readonly kind: 'transport'; readonly message: string };

export type CachedOutcome =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: EngineQueryError };

/** One cached query: what it returned and the world revision it was computed at. */
export interface CacheEntry {
  readonly revision: number;
  readonly outcome: CachedOutcome;
}

/** What a loader hands back for the cache to store. Loaders never reject. */
export type CacheLoader = () => Promise<CacheEntry>;

export const QUERY_CACHE_CAPACITY = 200;

/** JSON with object keys sorted at every level. `undefined` object values are left out, as in JSON. */
export function stableStringify(value: unknown): string {
  // JSON.stringify gives undefined (despite its type) for undefined or a function on its own.
  const text = JSON.stringify(value, (_key, nested: unknown) => {
    if (typeof nested !== 'object' || nested === null || Array.isArray(nested)) return nested;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(nested).sort()) {
      sorted[key] = Reflect.get(nested, key);
    }
    return sorted;
  }) as string | undefined;
  return text ?? 'undefined';
}

/** The cache key for a query call. */
export function queryKey(name: string, args: unknown): string {
  return `${name}:${stableStringify(args)}`;
}

export class QueryCache {
  readonly #capacity: number;
  /** Map order is recency order: the first key is the least recently used. */
  readonly #entries = new Map<string, CacheEntry>();
  readonly #inFlight = new Map<string, Promise<CacheEntry>>();
  readonly #listeners = new Map<string, Set<() => void>>();
  /** Bumped by `invalidateAll`, so answers to requests made before it are not stored. */
  #generation = 0;

  constructor(capacity: number = QUERY_CACHE_CAPACITY) {
    this.#capacity = capacity;
  }

  get size(): number {
    return this.#entries.size;
  }

  /** The entry for `key` without touching its recency. Safe to call during render. */
  peek(key: string): CacheEntry | undefined {
    return this.#entries.get(key);
  }

  /** Whether a request for `key` is on its way. */
  isFetching(key: string): boolean {
    return this.#inFlight.has(key);
  }

  /** Stores an entry as the most recently used and tells the key's listeners. */
  set(key: string, entry: CacheEntry): void {
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    this.#evict();
    this.#notify(key);
  }

  /**
   * Runs `loader` for `key` and stores what it returns, unless a request for `key` is already on
   * its way, in which case the caller shares that one.
   */
  fetch(key: string, loader: CacheLoader): Promise<CacheEntry> {
    const pending = this.#inFlight.get(key);
    if (pending !== undefined) return pending;
    const request = this.#load(key, loader, this.#generation);
    this.#inFlight.set(key, request);
    this.#notify(key);
    void this.#forgetWhenSettled(key, request);
    return request;
  }

  async #load(key: string, loader: CacheLoader, generation: number): Promise<CacheEntry> {
    const entry = await loader();
    if (generation === this.#generation) this.set(key, entry);
    return entry;
  }

  async #forgetWhenSettled(key: string, request: Promise<CacheEntry>): Promise<void> {
    try {
      await request;
    } catch {
      // The caller that started the request gets the rejection; this only tidies up.
    }
    if (this.#inFlight.get(key) === request) {
      this.#inFlight.delete(key);
      this.#notify(key);
    }
  }

  /** Drops every entry, for example when a different world is loaded. */
  invalidateAll(): void {
    this.#generation += 1;
    const keys = [...this.#entries.keys(), ...this.#inFlight.keys()];
    this.#entries.clear();
    this.#inFlight.clear();
    for (const key of new Set(keys)) this.#notify(key);
  }

  /** Calls `listener` whenever the entry or the fetching state of `key` changes. */
  subscribe(key: string, listener: () => void): () => void {
    let listeners = this.#listeners.get(key);
    if (listeners === undefined) {
      listeners = new Set();
      this.#listeners.set(key, listeners);
    }
    listeners.add(listener);
    return () => {
      const current = this.#listeners.get(key);
      current?.delete(listener);
      if (current?.size === 0) this.#listeners.delete(key);
    };
  }

  #evict(): void {
    for (const key of this.#entries.keys()) {
      if (this.#entries.size <= this.#capacity) return;
      this.#entries.delete(key);
      this.#notify(key);
    }
  }

  #notify(key: string): void {
    const listeners = this.#listeners.get(key);
    if (listeners === undefined) return;
    for (const listener of [...listeners]) listener();
  }
}
