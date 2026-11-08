import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getImageResolverVersion,
  isPlaceholderRef,
  registerImageResolver,
  resolveImageUrl,
  subscribeToImageResolvers,
} from './resolver';
import type { ImageResolver } from './resolver';
import type { ImageSubject } from './types';

const worker: ImageSubject = { kind: 'person', id: 'per_000001', name: 'Marlo Quint' };

const cleanups: (() => void)[] = [];

function register(resolver: ImageResolver): () => void {
  const unregister = registerImageResolver(resolver);
  cleanups.push(unregister);
  return unregister;
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});

describe('resolveImageUrl', () => {
  it('returns null when no resolver is registered', () => {
    expect(resolveImageUrl(worker)).toBeNull();
  });

  it('uses a registered resolver', () => {
    register((subject) => `/art/${subject.id}.webp`);
    expect(resolveImageUrl(worker)).toBe('/art/per_000001.webp');
  });

  it('asks resolvers in registration order and takes the first URL', () => {
    register(() => null);
    register(() => '/first.webp');
    register(() => '/second.webp');
    expect(resolveImageUrl(worker)).toBe('/first.webp');
  });

  it('falls back to the placeholder again after unregistering', () => {
    const unregister = register(() => '/art.webp');
    expect(resolveImageUrl(worker)).toBe('/art.webp');
    unregister();
    expect(resolveImageUrl(worker)).toBeNull();
    // A second call is harmless.
    unregister();
    expect(resolveImageUrl(worker)).toBeNull();
  });

  it('skips a resolver that throws and logs it once', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    register(() => {
      throw new Error('manifest missing');
    });
    register(() => '/backup.webp');
    expect(resolveImageUrl(worker)).toBe('/backup.webp');
    expect(resolveImageUrl(worker)).toBe('/backup.webp');
    expect(resolveImageUrl({ ...worker, id: 'per_000002' })).toBe('/backup.webp');
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it('passes placeholder references to resolvers as no reference', () => {
    const seen: (string | undefined)[] = [];
    register((subject) => {
      seen.push(subject.imageRef);
      return null;
    });
    resolveImageUrl({ ...worker, imageRef: 'placeholder:person' });
    resolveImageUrl({ ...worker, imageRef: 'workers/marlo.webp' });
    expect(seen).toEqual([undefined, 'workers/marlo.webp']);
  });
});

describe('registry subscription', () => {
  it('notifies subscribers and bumps the version on every change', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToImageResolvers(listener);
    const before = getImageResolverVersion();
    const unregister = register(() => null);
    unregister();
    unsubscribe();
    register(() => null);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getImageResolverVersion()).toBe(before + 3);
  });
});

describe('isPlaceholderRef', () => {
  it('recognises placeholder references only', () => {
    expect(isPlaceholderRef('placeholder:title')).toBe(true);
    expect(isPlaceholderRef('titles/heritage.webp')).toBe(false);
    expect(isPlaceholderRef(undefined)).toBe(false);
  });
});
