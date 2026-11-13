// WRK6-07 with AIP1: the rival rules for off-screen injuries follow the worker's employer: on for a
// computer-run roster, off for a player's and with the level playing field. Design:
// docs/design/health.md#off-screen-injuries
import { describe, expect, it } from 'vitest';
import { offscreenShortcutOf } from '../../../src/systems/health/rivalShortcut';
import { createEngineTunables } from '../../../src/systems/tunables';
import { TEST_PLAYER_ID, worldBuilder } from '../../support';

function shortcutWorld(levelPlayingField: boolean) {
  const { world, ids } = worldBuilder({ settings: { levelPlayingField } })
    .withGeography('mini')
    .withPromotion({ controller: { kind: 'human', playerId: TEST_PLAYER_ID } }, (promotion) =>
      promotion.withRoster(1),
    )
    .withPromotion({ controller: { kind: 'computer' } }, (promotion) => promotion.withRoster(1))
    .build();
  const { A: human, B: computer } = ids.promotions;
  if (human === undefined || computer === undefined) {
    throw new Error('shortcutWorld: missing a promotion');
  }
  return { world, human, computer };
}

const TUNABLES = createEngineTunables();

describe('offscreenShortcutOf', () => {
  it('applies the rival rules to a computer-run roster only', () => {
    const { world, human, computer } = shortcutWorld(false);
    expect(offscreenShortcutOf(world, TUNABLES, computer)?.value).toBe(true);
    const mine = offscreenShortcutOf(world, TUNABLES, human);
    expect(mine?.value).toBe(false);
    expect(JSON.stringify(mine?.trace)).toContain('Run by a player, not the computer');
  });

  it('applies to nobody with the level playing field on', () => {
    const { world, computer } = shortcutWorld(true);
    const rival = offscreenShortcutOf(world, TUNABLES, computer);
    expect(rival?.value).toBe(false);
    expect(JSON.stringify(rival?.trace)).toContain('The level playing field is on');
  });

  it('has no rule for a free agent, or with the shortcut turned off', () => {
    const { world, computer } = shortcutWorld(false);
    expect(offscreenShortcutOf(world, TUNABLES, null)).toBeNull();
    const off = createEngineTunables({ 'ai.skipInMatchInjuries': false });
    expect(offscreenShortcutOf(world, off, computer)?.value).toBe(false);
  });
});
