import { describe, expect, it, beforeEach } from 'vitest';
import { devSeat } from '../dev/EnterShellRoute';
import { selectHasPromotion, useSessionStore } from './sessionStore';

beforeEach(() => {
  useSessionStore.getState().clear();
});

describe('sessionStore', () => {
  it('starts with no world and no seat', () => {
    const state = useSessionStore.getState();

    expect(state.worldLoaded).toBe(false);
    expect(state.saveSlotId).toBeNull();
    expect(state.seat).toBeNull();
    expect(selectHasPromotion(state)).toBe(false);
  });

  it('records the loaded world and its seat', () => {
    const seat = devSeat('pro_dev');
    useSessionStore.getState().setLoaded({ saveSlotId: 'slot-1', seat });

    const state = useSessionStore.getState();
    expect(state.worldLoaded).toBe(true);
    expect(state.saveSlotId).toBe('slot-1');
    expect(state.seat).toBe(seat);
    expect(selectHasPromotion(state)).toBe(true);
  });

  it('has no promotion for an unemployed seat', () => {
    useSessionStore.getState().setLoaded({ saveSlotId: null, seat: devSeat(null) });

    expect(useSessionStore.getState().worldLoaded).toBe(true);
    expect(selectHasPromotion(useSessionStore.getState())).toBe(false);
  });

  it('clears back to no world', () => {
    useSessionStore.getState().setLoaded({ saveSlotId: 'slot-1', seat: devSeat('pro_dev') });
    useSessionStore.getState().clear();

    expect(useSessionStore.getState()).toMatchObject({
      worldLoaded: false,
      saveSlotId: null,
      seat: null,
    });
  });
});
