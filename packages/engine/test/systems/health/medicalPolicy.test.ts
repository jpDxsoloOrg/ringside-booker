// WRK6-07 with ECO1: the medical policy's health lines in the Finances preview, and a policy change
// reaching the next injury's Why?. Design: docs/design/health.md#medical-care
import { describe, expect, it } from 'vitest';
import {
  controllerViewer,
  createEngine,
  initialEngineState,
  type Engine,
} from '../../../src/core/api';
import { defineSystem } from '../../../src/core/api/system';
import type { PersonId, PromotionId } from '../../../src/core/ids';
import { definePhase } from '../../../src/core/pipeline/phase';
import { findTraceNodes } from '../../../src/core/trace';
import { isFullTrace } from '../../../src/core/trace/store';
import { parseContentKey } from '../../../src/core/content-key';
import { defaultSystems } from '../../../src/systems';
import type { PolicyLevel } from '../../../src/systems/finance/policies';
import {
  injure,
  injuryTraceRef,
  MEDICAL_POLICY_EFFECT_ID,
  medicalPolicyLines,
} from '../../../src/systems/health';
import { listPolicyEffects } from '../../../src/systems/finance';
import { createEngineTunables } from '../../../src/systems/tunables';
import { TEST_PLAYER_ID, worldBuilder } from '../../support';

const PLAYER = { kind: 'human', playerId: TEST_PLAYER_ID } as const;
const VIEWER = controllerViewer(PLAYER);
const OMNISCIENT = { kind: 'omniscient' } as const;

interface Built {
  readonly engine: Engine;
  readonly promotionId: PromotionId;
  readonly worker: PersonId;
}

/** The player's promotion on Good medical care (level 2), one worker; injures them on day one. */
function medicalWorld(): Built {
  let injuredOnce = false;
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withInjuryCatalog()
    .withPromotion({ controller: PLAYER, policies: { medical: 2 } }, (promotion) =>
      promotion.withRoster(1),
    )
    .build();
  const promotionId = ids.promotions.A;
  const worker = ids.people[0];
  if (promotionId === undefined || worker === undefined) {
    throw new Error('medicalWorld: missing the promotion or its worker');
  }
  const hurtOnce = defineSystem({
    id: 'testHurt',
    phases: [
      definePhase({
        id: 'testHurt.once',
        group: 'housekeeping',
        order: 50,
        cadence: { kind: 'daily' },
        run: (ctx) => {
          if (injuredOnce) {
            return;
          }
          injuredOnce = true;
          injure(ctx, worker, {
            source: 'world',
            kindKey: parseContentKey('injury.test-arm'),
            severity: 'moderate',
          });
        },
      }),
    ],
  });
  const engine = createEngine({
    state: initialEngineState(world),
    systems: [...defaultSystems, hurtOnce],
  });
  return { engine, promotionId, worker };
}

describe('the medical policy in Finances', () => {
  it('is registered once, for the medical area', () => {
    expect(
      listPolicyEffects('medical').filter((effect) => effect.id === MEDICAL_POLICY_EFFECT_ID),
    ).toHaveLength(1);
    expect(listPolicyEffects('travel').map((effect) => effect.id)).not.toContain(
      MEDICAL_POLICY_EFFECT_ID,
    );
  });

  it('says how long injuries keep workers out and how fast condition heals, per level', () => {
    const { engine, promotionId } = medicalWorld();
    const preview = engine.query('finance.policyPreview', { promotionId, area: 'medical' }, VIEWER);
    if (!preview.ok) {
      throw new Error(JSON.stringify(preview.reasons));
    }
    const lines = preview.data.levels.map((level) =>
      level.effects.map(({ text, tone }) => ({ text, tone })),
    );
    expect(lines).toEqual([
      [
        { text: 'Injuries heal in ×1.2 of the time', tone: 'negative' },
        { text: 'Body condition recovers ×0.8 per week', tone: 'negative' },
      ],
      [
        { text: 'Injuries heal in the usual time', tone: 'neutral' },
        { text: 'Body condition recovers at the usual rate each week', tone: 'neutral' },
      ],
      [
        { text: 'Injuries heal in ×0.9 of the time', tone: 'positive' },
        { text: 'Body condition recovers ×1.15 per week', tone: 'positive' },
      ],
      [
        { text: 'Injuries heal in ×0.8 of the time', tone: 'positive' },
        { text: 'Body condition recovers ×1.3 per week', tone: 'positive' },
      ],
    ]);
    // Each line's Why? is the tunable behind it.
    for (const level of preview.data.levels) {
      for (const effect of level.effects) {
        expect(effect.trace).toBeDefined();
      }
    }
  });

  it('follows the tunables', () => {
    const tunables = createEngineTunables({ 'health.medical.injuryMultiplier.level3': 0.5 });
    const [injury] = medicalPolicyLines(3 satisfies PolicyLevel, tunables);
    expect(injury?.text).toBe('Injuries heal in ×0.5 of the time');
  });

  it("changes the next injury's Why? when the policy changes", async () => {
    const { engine, promotionId, worker } = medicalWorld();
    expect(
      engine.command('finance.setPolicy', { promotionId, area: 'medical', level: 0 }, PLAYER).ok,
    ).toBe(true);
    await engine.advanceDays({ maxDays: 1 });

    const [row] = engine.exportState().world.tables.injuries;
    expect(row?.personId).toBe(worker);
    const stored = engine.query('trace.get', { ref: injuryTraceRef(row!.id) }, OMNISCIENT);
    if (!stored.ok || stored.data === null || !isFullTrace(stored.data)) {
      throw new Error('expected a full injury trace');
    }
    const medical = findTraceNodes(stored.data.trace, 'tunable').filter((node) =>
      node.key.startsWith('health.medical.injuryMultiplier.'),
    );
    expect(medical.map((node) => [node.key, node.value])).toEqual([
      ['health.medical.injuryMultiplier.level0', 1.2],
    ]);
  });
});
