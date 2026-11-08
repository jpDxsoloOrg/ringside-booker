import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { cents } from '@ringside/engine';
import { initializeSettings, useSettingsStore } from '@/app/settings/settingsStore';
import type { SettingsStorage } from '@/app/settings/settingsStore';
import { useMoneyFormatter } from './useMoneyFormatter';

const AMOUNT = cents(123_456_700);

function emptyStorage(): SettingsStorage {
  let stored: string | null = null;
  return {
    read: () => stored,
    write: (serialized) => {
      stored = serialized;
    },
    remove: () => {
      stored = null;
    },
  };
}

beforeEach(() => {
  initializeSettings(emptyStorage());
});

describe('useMoneyFormatter', () => {
  it('formats with the compact style, then re-renders in full when the setting changes', () => {
    act(() => {
      useSettingsStore.getState().update({ moneyStyle: 'compact' });
    });
    const { result } = renderHook(() => useMoneyFormatter());
    expect(result.current(AMOUNT)).toBe('$1.2M');

    act(() => {
      useSettingsStore.getState().update({ moneyStyle: 'full' });
    });
    expect(result.current(AMOUNT)).toBe('$1,234,567');
  });

  it('lets a caller insist on one style', () => {
    act(() => {
      useSettingsStore.getState().update({ moneyStyle: 'compact' });
    });
    const { result } = renderHook(() => useMoneyFormatter());
    expect(result.current(AMOUNT, { style: 'full', showCents: true })).toBe('$1,234,567.00');
  });

  it('keeps the same function until the style changes', () => {
    const { result, rerender } = renderHook(() => useMoneyFormatter());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
