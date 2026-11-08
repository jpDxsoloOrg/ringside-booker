import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isDialogOpen,
  isTextEntryTarget,
  shouldHandleDayShortcut,
  useDayShortcut,
} from './useDayShortcut';
import type { ShortcutKeyEvent } from './useDayShortcut';

function keyEvent(overrides: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return {
    key: 'N',
    code: 'KeyN',
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    target: document.body,
    ...overrides,
  };
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  setup: (node: HTMLElementTagNameMap[K]) => void = () => undefined,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  setup(node);
  document.body.append(node);
  return node;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('shouldHandleDayShortcut', () => {
  it('runs for Shift+N on the page', () => {
    expect(shouldHandleDayShortcut(keyEvent())).toBe(true);
    expect(shouldHandleDayShortcut(keyEvent({ key: 'n' }))).toBe(true);
  });

  it('needs Shift and no other modifier', () => {
    expect(shouldHandleDayShortcut(keyEvent({ shiftKey: false, key: 'n' }))).toBe(false);
    expect(shouldHandleDayShortcut(keyEvent({ ctrlKey: true }))).toBe(false);
    expect(shouldHandleDayShortcut(keyEvent({ metaKey: true }))).toBe(false);
    expect(shouldHandleDayShortcut(keyEvent({ altKey: true }))).toBe(false);
  });

  it('ignores other keys and a held-down key', () => {
    expect(shouldHandleDayShortcut(keyEvent({ key: 'M', code: 'KeyM' }))).toBe(false);
    expect(shouldHandleDayShortcut(keyEvent({ repeat: true }))).toBe(false);
  });

  it('stays out of text fields', () => {
    const textInput = element('input', (node) => {
      node.type = 'text';
    });
    const numberInput = element('input', (node) => {
      node.type = 'number';
    });
    const textArea = element('textarea');
    const select = element('select');
    for (const target of [textInput, numberInput, textArea, select]) {
      expect(shouldHandleDayShortcut(keyEvent({ target }))).toBe(false);
    }
  });

  it('still runs from a focused button or checkbox', () => {
    const button = element('button');
    const checkbox = element('input', (node) => {
      node.type = 'checkbox';
    });
    expect(shouldHandleDayShortcut(keyEvent({ target: button }))).toBe(true);
    expect(shouldHandleDayShortcut(keyEvent({ target: checkbox }))).toBe(true);
  });

  it('stays out of editable content', () => {
    const editable = element('div', (node) => {
      node.setAttribute('contenteditable', 'true');
    });
    const inner = document.createElement('span');
    editable.append(inner);
    expect(isTextEntryTarget(inner)).toBe(true);
    expect(shouldHandleDayShortcut(keyEvent({ target: inner }))).toBe(false);
  });

  it('does nothing while a dialog is open', () => {
    const dialog = element('div', (node) => {
      node.setAttribute('role', 'dialog');
    });
    expect(isDialogOpen()).toBe(true);
    expect(shouldHandleDayShortcut(keyEvent())).toBe(false);
    dialog.remove();

    element('dialog', (node) => {
      node.setAttribute('open', '');
    });
    expect(shouldHandleDayShortcut(keyEvent())).toBe(false);
  });

  it('ignores a closed native dialog', () => {
    element('dialog');
    expect(isDialogOpen()).toBe(false);
    expect(shouldHandleDayShortcut(keyEvent())).toBe(true);
  });
});

describe('useDayShortcut', () => {
  it('calls back on Shift+N while enabled, and stops when disabled', () => {
    const onShortcut = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ enabled }: { enabled: boolean }) => {
        useDayShortcut(onShortcut, enabled);
      },
      { initialProps: { enabled: true } },
    );

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'N', code: 'KeyN', shiftKey: true }),
    );
    expect(onShortcut).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'N', code: 'KeyN', shiftKey: true }),
    );
    expect(onShortcut).toHaveBeenCalledTimes(1);
    unmount();
  });
});
