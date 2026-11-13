// The card planner's tunables and streams. Design: docs/design/rival-booking.md#tunables
import { describe, expect, it } from 'vitest';
import { isStreamName } from '../../../../src/core/rng/streams';
import {
  aipCardTunables,
  AUTOFILL_STREAM,
  CARD_PLAN_STREAM,
  RIVAL_BOOKING_CATEGORY,
} from '../../../../src/systems/aip';
import { ALL_TUNABLES } from '../../../../src/systems/tunables';

describe('the card planner tunables', () => {
  const entries = Object.entries(aipCardTunables);

  it('are merged into the engine set under Rival booking, docRef rival-booking.md', () => {
    expect(entries).toHaveLength(48);
    for (const [key, def] of entries) {
      expect(ALL_TUNABLES).toHaveProperty([key]);
      expect(def.category).toBe(RIVAL_BOOKING_CATEGORY);
      expect(def.docRef).toMatch(/^rival-booking\.md#[a-z-]+$/);
    }
  });

  it('have the agreed defaults', () => {
    expect(aipCardTunables['aip.card.maxFatigue'].default).toBe(75);
    expect(aipCardTunables['aip.card.minWorkers'].default).toBe(5);
    expect(aipCardTunables['aip.card.talkShare.house'].default).toBe(0);
    expect(aipCardTunables['aip.card.talkShare.regular'].default).toBe(0.3);
    expect(aipCardTunables['aip.titles.maxPerShow.flagship'].default).toBe(6);
    expect(aipCardTunables['aip.card.variantShare'].default).toBe(0.2);
    expect(aipCardTunables['aip.card.order.titleWeight'].default).toBe(0.3);
    expect(aipCardTunables['aip.card.order.heatWeight'].default).toBe(0.2);
    expect(aipCardTunables['aip.card.order.aceBoost'].default).toBe(12);
    expect(aipCardTunables['aip.card.order.prospectBoost'].default).toBe(6);
    expect(aipCardTunables['aip.card.order.talkFactor'].default).toBe(0.8);
    expect(aipCardTunables['aip.card.order.hotOpener'].default).toBe(true);
  });

  it('never mention minutes or length', () => {
    const text = JSON.stringify(aipCardTunables).toLowerCase();
    expect(text).not.toMatch(/minute|length|duration/);
  });
});

describe('the card planner streams', () => {
  it('are valid, separate stream names', () => {
    expect(isStreamName(CARD_PLAN_STREAM)).toBe(true);
    expect(isStreamName(AUTOFILL_STREAM)).toBe(true);
    expect(CARD_PLAN_STREAM).not.toBe(AUTOFILL_STREAM);
  });
});
