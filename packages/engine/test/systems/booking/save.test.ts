// A card mid-build survives a save and a load. Design: docs/design/booking.md#the-card-model
import { describe, expect, it } from 'vitest';
import { engineLoadOptions, engineSaveState, initialEngineState } from '../../../src/core/api';
import { parseContentKey } from '../../../src/core/content-key';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES } from '../../../src/model/tables';
import { encodeSave } from '../../../src/persistence/codec';
import { loadSave } from '../../../src/persistence/load';
import { createSaveDocument } from '../../../src/persistence/world-document';
import { cardSegments, MatchDraftSchema, writeSegment } from '../../../src/systems/booking';
import { TEST_ENGINE_VERSION, TEST_SAVED_AT } from '../../support/saves';
import { worldBuilder } from '../../support';

/**
 * A scheduled show with main-card slots 1 and 4 and the pre-show slot filled, slots 0, 2, 3 and 5
 * open, and planned winners on two of the matches.
 */
function worldWithPartCard() {
  const { world, ids } = worldBuilder({ startDate: '2026-01-05' })
    .withCatalogs()
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A' }, (promotion) => promotion.withRoster(6))
    .withEventInstance({ format: { slots: 6, preShowSlots: 1 } })
    .build();
  const [show] = ids.eventInstances;
  if (show === undefined) {
    throw new Error('The world has no show');
  }
  const written = world.transact('book part of the card', (tx) => {
    const positions = [
      { preShow: false, slot: 4, winningSide: 1 },
      { preShow: true, slot: 0, winningSide: null },
      { preShow: false, slot: 1, winningSide: 0 },
    ];
    positions.forEach(({ preShow, slot, winningSide }, index) => {
      const [left, right] = ids.people.slice(index * 2, index * 2 + 2);
      if (left === undefined || right === undefined) {
        throw new Error('The roster is too short');
      }
      writeSegment(tx, {
        eventInstanceId: show,
        preShow,
        slot,
        draft: MatchDraftSchema.parse({
          kind: 'match',
          label: null,
          match: { matchTypeKey: parseContentKey('match.singles') },
          participants: [
            { personId: left, side: 0, role: 'competitor', teamId: null },
            { personId: right, side: 1, role: 'competitor', teamId: null },
          ],
          outcome:
            winningSide === null
              ? null
              : { kind: 'win', winningSide, methodKey: parseContentKey('method.pinfall') },
        }),
      });
    });
  });
  if (!written.ok) {
    throw written.error;
  }
  return { world, show, promotionId: ids.promotions.A ?? null };
}

describe('a card with open slots and planned results', () => {
  it('saves and loads with zero integrity issues', async () => {
    const { world, show, promotionId } = worldWithPartCard();
    expect(
      cardSegments(world, show).map((segment) => [
        segment.preShow,
        segment.slot,
        segment.kind === 'match' ? segment.outcome?.kind : null,
      ]),
    ).toEqual([
      [true, 0, undefined],
      [false, 1, 'win'],
      [false, 4, 'win'],
    ]);
    expect(checkWorld(world, TABLES).issues).toEqual([]);

    const doc = createSaveDocument(engineSaveState(initialEngineState(world)), {
      headerPromotionId: promotionId,
      savedAt: TEST_SAVED_AT,
      label: 'Card being booked',
      engineVersion: TEST_ENGINE_VERSION,
    });
    // Before EVT2-01 this load failed: `segments.slotsNotContiguous` wanted main-card slots
    // 0..n-1 (this card has 1 and 4), and `segments.resultBeforeCompletion` refused any outcome
    // on a show that had not run. A card is now a set of fixed slots from the show's format, any
    // of which may be open, and a match outcome before the show is the booker's planned result.
    const report = await loadSave(await encodeSave(doc), TABLES, engineLoadOptions());
    if (!report.ok) {
      expect.fail(JSON.stringify(report.issues, null, 2));
    }
    expect(report.warnings).toEqual([]);
    expect(checkWorld(report.world, TABLES).issues).toEqual([]);
    expect(cardSegments(report.world, show)).toEqual(cardSegments(world, show));
  });
});
