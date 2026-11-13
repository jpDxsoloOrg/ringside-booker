import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parseId } from '@ringside/engine';
import type { PromotionId } from '@ringside/engine';
import { registeredFanBaseColumns } from '@/app/AppShell/status/fanBaseColumnRegistry';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { useSessionStore } from '@/app/session/sessionStore';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { THIS_MONTH_COLUMN_ID, THIS_MONTH_LABEL, thisMonthText } from './fanBaseColumn';

/** The engine's first answer can take a moment under load. */
const LOAD_MS = 10_000;

afterEach(() => {
  useSessionStore.getState().clear();
});

describe('the Fan base sheet\'s "This month" figure (DAY2-06)', () => {
  it('reads the gain against the cap', () => {
    expect(thisMonthText(1.24, 3)).toBe('+1.2 (cap 3)');
    expect(thisMonthText(0, 3)).toBe('+0.0 (cap 3)');
    expect(thisMonthText(3, 3)).toBe('+3.0 (cap reached)');
    expect(thisMonthText(0, 2.5)).toBe('+0.0 (cap 2.5)');
  });

  it("draws a region's gain from popularity.monthGains", async () => {
    const column = registeredFanBaseColumns().find((entry) => entry.id === THIS_MONTH_COLUMN_ID);
    expect(column?.label).toBe(THIS_MONTH_LABEL);
    if (column === undefined) return;

    const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
    const state = fakeEngineState();
    const install = transport.host.installEngine(state);
    useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
    const promotion = state.world.tables.promotions[0];
    if (promotion === undefined) throw new Error('The tiny world has a promotion.');
    const promotionId: PromotionId = promotion.id;

    render(
      <EngineProvider createTransport={() => transport}>
        {column.render(parseId('region', promotion.homeRegionId), { promotionId })}
      </EngineProvider>,
    );
    // No show has won anything this month yet in the fixture world.
    expect(await screen.findByText('+0.0 (cap 3)', undefined, { timeout: LOAD_MS })).toBeVisible();
  });
});
