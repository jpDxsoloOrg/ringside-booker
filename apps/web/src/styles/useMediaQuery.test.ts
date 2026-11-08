import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setMatchMedia } from '@/test/matchMedia';
import { BP_MOBILE_QUERY } from './breakpoints';
import { useIsMobile, useMediaQuery } from './useMediaQuery';

const DARK_QUERY = '(prefers-color-scheme: dark)';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useMediaQuery', () => {
  it('returns false when the query does not match', () => {
    const { result } = renderHook(() => useMediaQuery(DARK_QUERY));
    expect(result.current).toBe(false);
  });

  it('returns the initial value when the query already matches', () => {
    setMatchMedia((query) => query === DARK_QUERY);
    const { result } = renderHook(() => useMediaQuery(DARK_QUERY));
    expect(result.current).toBe(true);
  });

  it('updates when the query starts or stops matching', () => {
    const { result } = renderHook(() => useMediaQuery(DARK_QUERY));

    act(() => {
      setMatchMedia((query) => query === DARK_QUERY);
    });
    expect(result.current).toBe(true);

    act(() => {
      setMatchMedia(() => false);
    });
    expect(result.current).toBe(false);
  });

  it('follows a new query when the argument changes', () => {
    setMatchMedia((query) => query === DARK_QUERY);
    const { result, rerender } = renderHook(({ query }) => useMediaQuery(query), {
      initialProps: { query: DARK_QUERY },
    });
    expect(result.current).toBe(true);

    rerender({ query: BP_MOBILE_QUERY });
    expect(result.current).toBe(false);
  });

  it('removes its change listener on unmount', () => {
    const addSpy = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const removeSpy = vi.spyOn(EventTarget.prototype, 'removeEventListener');
    const { unmount } = renderHook(() => useMediaQuery(DARK_QUERY));

    const isMediaQueryChange = (target: unknown, type: unknown): boolean =>
      type === 'change' &&
      typeof target === 'object' &&
      target !== null &&
      'media' in target &&
      target.media === DARK_QUERY;
    const addedListeners = addSpy.mock.calls
      .filter((call, index) => isMediaQueryChange(addSpy.mock.contexts[index], call[0]))
      .map((call) => call[1]);
    expect(addedListeners.length).toBeGreaterThan(0);

    unmount();

    const removedListeners = removeSpy.mock.calls
      .filter((call, index) => isMediaQueryChange(removeSpy.mock.contexts[index], call[0]))
      .map((call) => call[1]);
    expect(removedListeners).toEqual(addedListeners);
  });
});

describe('useIsMobile', () => {
  it('tracks the mobile breakpoint query', () => {
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      setMatchMedia((query) => query === BP_MOBILE_QUERY);
    });
    expect(result.current).toBe(true);
  });
});
