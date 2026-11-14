import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveAfterChanges } from './saveAfterChanges';

const DELAY_MS = 100;

/** A save that stays open until the test finishes it. */
function controlledSave() {
  const finishers: (() => void)[] = [];
  const save = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishers.push(resolve);
      }),
  );
  const finishNext = async (): Promise<void> => {
    finishers.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
  };
  return { save, finishNext };
}

describe('SaveAfterChanges', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves once, a short while after the last change of a burst', async () => {
    const save = vi.fn(async () => undefined);
    const saver = new SaveAfterChanges({ save, canSave: () => true, delayMs: DELAY_MS });

    saver.noteChange();
    await vi.advanceTimersByTimeAsync(DELAY_MS - 10);
    saver.noteChange();
    await vi.advanceTimersByTimeAsync(DELAY_MS - 10);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10);
    expect(save).toHaveBeenCalledTimes(1);
    expect(saver.pending).toBe(false);
  });

  it('reports unsaved changes until the save after them has finished', async () => {
    const { save, finishNext } = controlledSave();
    const seen: boolean[] = [];
    const saver = new SaveAfterChanges({
      save,
      canSave: () => true,
      delayMs: DELAY_MS,
      onPendingChange: (pending) => seen.push(pending),
    });

    saver.noteChange();
    saver.noteChange();
    expect(saver.pending).toBe(true);
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
    expect(saver.pending).toBe(true);

    await finishNext();
    expect(saver.pending).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it('waits while the engine is busy, then saves', async () => {
    let busy = true;
    const save = vi.fn(async () => undefined);
    const saver = new SaveAfterChanges({ save, canSave: () => !busy, delayMs: DELAY_MS });

    saver.noteChange();
    await vi.advanceTimersByTimeAsync(DELAY_MS * 5);
    expect(save).not.toHaveBeenCalled();
    expect(saver.pending).toBe(true);

    busy = false;
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves again for a change made while a save was running, never two at once', async () => {
    const { save, finishNext } = controlledSave();
    const saver = new SaveAfterChanges({ save, canSave: () => true, delayMs: DELAY_MS });

    saver.noteChange();
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);

    saver.noteChange();
    await vi.advanceTimersByTimeAsync(DELAY_MS * 3);
    expect(save).toHaveBeenCalledTimes(1);

    await finishNext();
    expect(saver.pending).toBe(true);
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(save).toHaveBeenCalledTimes(2);
    await finishNext();
    expect(saver.pending).toBe(false);
  });

  it('saves straight away on flush, and does nothing when all is saved', async () => {
    const save = vi.fn(async () => undefined);
    const saver = new SaveAfterChanges({ save, canSave: () => true, delayMs: DELAY_MS });

    await saver.flush();
    expect(save).not.toHaveBeenCalled();

    saver.noteChange();
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DELAY_MS * 2);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('drops waiting changes on cancel and stops for good on dispose', async () => {
    const save = vi.fn(async () => undefined);
    const saver = new SaveAfterChanges({ save, canSave: () => true, delayMs: DELAY_MS });

    saver.noteChange();
    saver.cancel();
    expect(saver.pending).toBe(false);
    await vi.advanceTimersByTimeAsync(DELAY_MS * 2);
    expect(save).not.toHaveBeenCalled();

    saver.dispose();
    saver.noteChange();
    await vi.advanceTimersByTimeAsync(DELAY_MS * 2);
    expect(save).not.toHaveBeenCalled();
  });

  it('counts a save that throws as done', async () => {
    const save = vi.fn(async () => {
      throw new Error('disk full');
    });
    const saver = new SaveAfterChanges({ save, canSave: () => true, delayMs: DELAY_MS });

    saver.noteChange();
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
    expect(saver.pending).toBe(false);
  });
});
