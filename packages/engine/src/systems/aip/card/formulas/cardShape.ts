/**
 * The card shape: how a rival splits a show's main-card slots before it picks anyone.
 *
 * - `talkSlotsFor`: how many of the N main-card slots are talking segments, from the show's
 *   importance and the booker's taste for talking;
 * - `titleMatchCapFor`: how many title matches the card may hold;
 * - `mainEventMustBeMatch`: whether the last slot has to be a match.
 *
 * Shapes are counted in slots only (D-10): a show has N slots, each slot's position gives its
 * role, and nothing here sets how long anything runs.
 *
 * Design: docs/design/rival-booking.md#card-shape.
 */

import { constantOf, inputOf, startCalc, startDecision, type Traced } from '../../../../core/trace';
import type { EventImportance } from '../../../../model/entities/event-definition';
import type { EngineTunables } from '../../../tunables';
import { CARD_SHAPE_DOC_REF, talkShareKey, TITLE_CAP_DOC_REF, titleCapKey } from '../tunables';

/** The middle of the taste scale: taste 50 leaves the talking share as it is. */
export const NEUTRAL_TALK_TASTE = 50;

/** The constant reason on the back-to-back limit. */
export const NO_BACK_TO_BACK_REASON = 'No two talking segments in a row';

/** The reason `mainEventMustBeMatch` gives, whatever the show. */
export const MAIN_EVENT_RULE = 'House shows may end on anything; every other show ends on a match';

export interface TalkSlotsInputs {
  /** The show's name, for the trace's title. */
  showName: string;
  /** Main-card slots (`format.slots`); the pre-show is planned separately. */
  slots: number;
  importance: EventImportance;
  /**
   * The booker's taste for talking, 0-100 (`tasteOf(...).values.talkShare`). Pass the traced
   * axis (`{ value, trace }` from `TracedTaste.traces`) to keep where it came from in the Why?.
   */
  talkShare: number | Traced<number>;
}

export interface TitleMatchCapInputs {
  importance: EventImportance;
  /** Main-card slots left for matches once the talking segments are counted. */
  matchSlots: number;
}

function tracedTaste(talkShare: number | Traced<number>): Traced<number> {
  return typeof talkShare === 'number'
    ? inputOf('Taste for talking', talkShare, undefined, 'points')
    : talkShare;
}

/** `1 + swing × (taste − 50) ÷ 50`: how the booker's taste scales the show's talking share. */
function tasteFactor(taste: Traced<number>, tunables: EngineTunables): Traced<number> {
  const calc = startCalc('Taste factor', taste, { unit: 'multiplier' });
  return calc
    .subtract(
      'Neutral taste',
      constantOf('Neutral taste', NEUTRAL_TALK_TASTE, 'Taste 50 leaves the share as it is'),
    )
    .divide(
      'Over half the taste scale',
      constantOf(
        'Half the taste scale',
        NEUTRAL_TALK_TASTE,
        'Taste runs from 0 to 100, so 50 either side of neutral',
      ),
    )
    .multiply('Taste swing', calc.tunable(tunables, 'aip.card.talkTasteSwing'))
    .add('On top of the share itself', constantOf('The share itself', 1, 'Neutral taste keeps it'))
    .done();
}

/**
 * The talking share of this show:
 * `aip.card.talkShare.<importance> × (1 + aip.card.talkTasteSwing × (taste − 50) ÷ 50)`,
 * kept within 0 and `aip.card.maxTalkShare`.
 */
function talkShareFor(inputs: TalkSlotsInputs, tunables: EngineTunables): Traced<number> {
  const taste = tracedTaste(inputs.talkShare);
  const calc = startCalc(`Talking share for a ${inputs.importance} show`, 0, {
    unit: 'ratio',
    startLabel: 'No talking yet',
  });
  calc.add(
    `Share on a ${inputs.importance} show`,
    calc.tunable(tunables, talkShareKey(inputs.importance)),
  );
  calc.multiply(
    `Booker's taste for talking (${String(taste.value)})`,
    tasteFactor(taste, tunables),
  );
  const maxShare = calc.tunable(tunables, 'aip.card.maxTalkShare');
  return calc.clamp(0, maxShare, 'Within the largest talking share').done();
}

/**
 * How many main-card slots are talking segments:
 *
 * 1. `share` (see `talkShareFor`);
 * 2. `raw = round(slots × share)`;
 * 3. `min(raw, limit)`, where `limit = ceil((slots − 1) ÷ 2)` on a show whose main event must be a
 *    match and `ceil(slots ÷ 2)` on a house show, so no two talking segments sit next to each other.
 */
export function talkSlotsFor(
  inputs: TalkSlotsInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc(
    `Talking segments on ${inputs.showName}`,
    inputOf('Main-card slots', inputs.slots, undefined, 'count'),
    { unit: 'count', docRef: CARD_SHAPE_DOC_REF },
  );
  const share = talkShareFor(inputs, tunables);
  calc.multiply(`Talking share for a ${inputs.importance} show`, share).round('round', 'Rounded');

  const endsOnMatch = inputs.importance !== 'house';
  const room = Math.max(0, Math.ceil((endsOnMatch ? inputs.slots - 1 : inputs.slots) / 2));
  const reason = endsOnMatch
    ? `${NO_BACK_TO_BACK_REASON}, and the main event is a match`
    : NO_BACK_TO_BACK_REASON;
  return calc
    .min(
      'Room without back-to-back talking',
      constantOf('Room without back-to-back talking', room, reason),
    )
    .done();
}

/** `min(aip.titles.maxPerShow.<importance>, matchSlots)`: title matches the card may hold. */
export function titleMatchCapFor(
  inputs: TitleMatchCapInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const calc = startCalc(
    `Title matches allowed on a ${inputs.importance} show`,
    inputOf('Match slots', inputs.matchSlots, undefined, 'count'),
    { unit: 'count', docRef: TITLE_CAP_DOC_REF },
  );
  return calc
    .min(
      `Most title matches on a ${inputs.importance} show`,
      calc.tunable(deps.tunables, titleCapKey(inputs.importance)),
    )
    .done();
}

/** Whether the show's last slot must be a match: every show but a house show. */
export function mainEventMustBeMatch(importance: EventImportance): Traced<boolean> {
  const isHouse = importance === 'house';
  return startDecision<boolean>('Main event must be a match', { docRef: CARD_SHAPE_DOC_REF })
    .rule('This is a house show', isHouse)
    .choose(!isHouse, MAIN_EVENT_RULE);
}
