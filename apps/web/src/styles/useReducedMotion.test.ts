import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setMatchMedia } from '@/test/matchMedia';
import {
  REDUCED_MOTION_ATTRIBUTE,
  REDUCED_MOTION_QUERY,
  useReducedMotion,
} from './useReducedMotion';

afterEach(() => {
  document.documentElement.removeAttribute(REDUCED_MOTION_ATTRIBUTE);
});

describe('useReducedMotion', () => {
  it('is false when nothing asks for less motion', () => {
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it('follows the OS setting as it changes', () => {
    const { result } = renderHook(() => useReducedMotion());

    act(() => {
      setMatchMedia((query) => query === REDUCED_MOTION_QUERY);
    });
    expect(result.current).toBe(true);

    act(() => {
      setMatchMedia(() => false);
    });
    expect(result.current).toBe(false);
  });

  it('lets the in-game setting override the OS either way', async () => {
    setMatchMedia((query) => query === REDUCED_MOTION_QUERY);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);

    await act(async () => {
      document.documentElement.setAttribute(REDUCED_MOTION_ATTRIBUTE, 'off');
      // MutationObserver callbacks run as a microtask.
      await Promise.resolve();
    });
    expect(result.current).toBe(false);

    await act(async () => {
      setMatchMedia(() => false);
      document.documentElement.setAttribute(REDUCED_MOTION_ATTRIBUTE, 'on');
      await Promise.resolve();
    });
    expect(result.current).toBe(true);
  });
});
