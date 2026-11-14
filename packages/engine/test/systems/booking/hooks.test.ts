// Booking's segment hooks (CRTV4-01). Design: docs/design/booking.md#integration
import { afterEach, describe, expect, it } from 'vitest';
import type { SegmentId } from '../../../src/core/ids';
import { RegistryError } from '../../../src/core/errors';
import {
  clearSegmentHooksForTests,
  registeredSegmentHooks,
  registerSegmentHook,
  removeSegment,
  writeSegment,
} from '../../../src/systems/booking';
import { commandWorld, promo, singles, wrestler } from './command-world';

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
});

describe('segment hooks', () => {
  it('runs afterWrite and beforeRemove inside the writer, in id order', () => {
    restore = clearSegmentHooksForTests();
    const calls: string[] = [];
    const record = (name: string) => ({
      id: `test.${name}`,
      afterWrite: (_tx: unknown, segmentId: SegmentId) => calls.push(`${name} write ${segmentId}`),
      beforeRemove: (_tx: unknown, segmentId: SegmentId) =>
        calls.push(`${name} remove ${segmentId}`),
    });
    registerSegmentHook(record('zeta'));
    registerSegmentHook(record('alpha'));
    expect(registeredSegmentHooks().map((hook) => hook.id)).toEqual(['test.alpha', 'test.zeta']);

    const booked = commandWorld();
    const result = booked.world.transact('book and remove', (tx) => {
      const id = writeSegment(tx, {
        eventInstanceId: booked.shows.open,
        preShow: false,
        slot: 0,
        draft: singles(wrestler(booked, 0), wrestler(booked, 1)),
      });
      writeSegment(tx, {
        eventInstanceId: booked.shows.open,
        preShow: false,
        slot: 0,
        draft: promo(wrestler(booked, 2)),
        segmentId: id,
      });
      removeSegment(tx, id);
      return id;
    });
    if (!result.ok) throw result.error;
    const id = result.value;
    expect(calls).toEqual([
      `alpha write ${id}`,
      `zeta write ${id}`,
      `alpha write ${id}`,
      `zeta write ${id}`,
      `alpha remove ${id}`,
      `zeta remove ${id}`,
    ]);
  });

  it('refuses a malformed or duplicate id', () => {
    restore = clearSegmentHooksForTests();
    expect(() => registerSegmentHook({ id: 'nodot' })).toThrow(RegistryError);
    const remove = registerSegmentHook({ id: 'test.once' });
    expect(() => registerSegmentHook({ id: 'test.once' })).toThrow(RegistryError);
    remove();
    expect(registeredSegmentHooks()).toEqual([]);
  });

  it('has the storylines finale hook registered by default', () => {
    expect(registeredSegmentHooks().map((hook) => hook.id)).toContain(
      'storylines.clearFinaleOnRemove',
    );
  });
});
