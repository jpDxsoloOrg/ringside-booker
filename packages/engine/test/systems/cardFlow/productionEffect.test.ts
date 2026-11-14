// The show-quality ceiling as a production effect line (ECO7-04): on the stage, camera, editing
// and pyro rows of production.overview, and as a before → after row in production.changePreview.
// Design: docs/design/production.md#effects, docs/design/card-flow.md#production-ceiling
import { describe, expect, it } from 'vitest';
import type { Viewer } from '../../../src/core/api/controller';
import {
  SHOW_CEILING_EFFECT_ID,
  SHOW_CEILING_EFFECT_LABEL,
  showCeilingText,
} from '../../../src/systems/cardFlow';
import { listProductionEffects } from '../../../src/systems/production';
import {
  OTHER_PLAYER,
  PLAYER,
  productionEngine,
  productionWorld,
} from '../production/production-world';

const PLAYER_VIEW: Viewer = { kind: 'controller', controller: PLAYER };
const OTHER_VIEW: Viewer = { kind: 'controller', controller: OTHER_PLAYER };

describe('the show-quality ceiling effect', () => {
  it('is registered for the four areas that set the ceiling only', () => {
    const effect = listProductionEffects().find((entry) => entry.id === SHOW_CEILING_EFFECT_ID);
    expect(effect?.areas).toEqual(['stage', 'camera', 'editing', 'pyro']);
    expect(effect?.ownOnly).toBeUndefined();
    expect(listProductionEffects('music').map((entry) => entry.id)).not.toContain(
      SHOW_CEILING_EFFECT_ID,
    );
  });

  it("shows the ceiling on the per-show rows, to the player and to a rival's viewer", () => {
    const built = productionWorld();
    const engine = productionEngine(built.world);
    for (const viewer of [PLAYER_VIEW, OTHER_VIEW]) {
      const result = engine.query('production.overview', { promotionId: built.human }, viewer);
      if (!result.ok) throw new Error('overview refused');
      for (const area of ['stage', 'camera', 'editing', 'pyro'] as const) {
        const row = result.data.rows.find((entry) => entry.area === area);
        // Hardpan: 40 + stage 1 × 1.5 + camera 2 × 2 + editing 1 × 1.5 + pyro 0 = 47.
        expect(row?.effects[0]).toMatchObject({
          id: SHOW_CEILING_EFFECT_ID,
          label: SHOW_CEILING_EFFECT_LABEL,
          value: 47,
          unit: 'points',
          text: 'Shows can score up to 47 (90 earns an extra main-card slot)',
        });
        expect(row?.effects[0]?.trace).toMatchObject({ value: 47 });
      }
    }
  });

  it('previews the ceiling before and after a camera change', () => {
    const built = productionWorld();
    const engine = productionEngine(built.world);
    const result = engine.query(
      'production.changePreview',
      { promotionId: built.human, area: 'camera', level: 4 },
      PLAYER_VIEW,
    );
    if (!result.ok) throw new Error('preview refused');
    expect(result.data.rows.map((row) => row.id)).toEqual([
      'areaCost',
      'upcomingShows',
      SHOW_CEILING_EFFECT_ID,
    ]);
    expect(result.data.rows.find((row) => row.id === SHOW_CEILING_EFFECT_ID)).toMatchObject({
      label: SHOW_CEILING_EFFECT_LABEL,
      before: 47,
      after: 51,
      unit: 'points',
    });
  });

  it('says when the ceiling is high enough for the bonus slot', () => {
    expect(showCeilingText(92.5, 90)).toBe(
      'Shows can score up to 92.5, enough for an extra main-card slot',
    );
    expect(showCeilingText(59, 90)).toBe(
      'Shows can score up to 59 (90 earns an extra main-card slot)',
    );
  });
});
