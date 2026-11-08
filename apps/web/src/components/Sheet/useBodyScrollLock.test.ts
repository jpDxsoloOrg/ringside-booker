import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireBodyScrollLock,
  bodyScrollLockCount,
  SCROLL_LOCK_CLASS,
  useBodyScrollLock,
} from './useBodyScrollLock';

function isLocked(): boolean {
  return document.documentElement.classList.contains(SCROLL_LOCK_CLASS);
}

describe('useBodyScrollLock', () => {
  afterEach(() => {
    expect(bodyScrollLockCount()).toBe(0);
    expect(isLocked()).toBe(false);
  });

  it('adds the class while active and removes it on unmount', () => {
    const { unmount } = renderHook(() => {
      useBodyScrollLock(true);
    });
    expect(isLocked()).toBe(true);

    unmount();
    expect(isLocked()).toBe(false);
  });

  it('does nothing while inactive', () => {
    const { rerender, unmount } = renderHook(
      ({ active }: { active: boolean }) => {
        useBodyScrollLock(active);
      },
      { initialProps: { active: false } },
    );
    expect(isLocked()).toBe(false);

    rerender({ active: true });
    expect(isLocked()).toBe(true);

    rerender({ active: false });
    expect(isLocked()).toBe(false);
    unmount();
  });

  it('keeps the page locked until the outer of two nested locks closes', () => {
    const outer = renderHook(() => {
      useBodyScrollLock(true);
    });
    const inner = renderHook(() => {
      useBodyScrollLock(true);
    });
    expect(bodyScrollLockCount()).toBe(2);

    inner.unmount();
    expect(isLocked()).toBe(true);
    expect(bodyScrollLockCount()).toBe(1);

    outer.unmount();
    expect(isLocked()).toBe(false);
  });

  it('never sets an inline style', () => {
    const { unmount } = renderHook(() => {
      useBodyScrollLock(true);
    });
    expect(document.documentElement.getAttribute('style')).toBeNull();
    expect(document.body.getAttribute('style')).toBeNull();
    unmount();
  });

  it('ignores a second release of the same hold', () => {
    const releaseFirst = acquireBodyScrollLock();
    const releaseSecond = acquireBodyScrollLock();

    releaseFirst();
    releaseFirst();
    expect(isLocked()).toBe(true);

    releaseSecond();
    expect(isLocked()).toBe(false);
  });
});
