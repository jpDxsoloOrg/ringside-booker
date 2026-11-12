/**
 * Show score: one number for a whole show, from its segments' scores.
 *
 * A slot-weighted mean (D-10): each filled slot's score counts by its slot weight, so the main
 * event moves the score most and the pre-show (at the default factor 0) not at all. Each empty
 * main-card slot costs a flat penalty. Then the `adjust` modifiers (card flow) run and the result
 * is kept within 0..100 and rounded: that is the raw score. Then the `cap` modifiers (the
 * production ceiling) run, and the result is kept and rounded again: that is the score.
 *
 * Design: docs/design/show-night.md#show-score.
 */

import type { ContentKey } from '../../../core/content-key';
import type { JsonValue } from '../../../core/json';
import type { PersonId, SegmentId, StorylineId } from '../../../core/ids';
import { startCalc, type Calc, type Traced } from '../../../core/trace';
import type { EventImportance } from '../../../model/entities/event-definition';
import type { EngineTunables } from '../../tunables';
import { formatNumber } from '../../world/people/labels';
import { sortShowScoreModifiers, type ShowScoreModifier } from '../showScoreModifiers';

export const SHOW_SCORE_DOC_REF = 'docs/design/show-night.md#show-score';

/** The ends of the show score scale. Fixed, like every other 0..100 score in the game. */
export const SHOW_SCORE_MIN = 0;
export const SHOW_SCORE_MAX = 100;

/** One slot of the card, as the shows phase hands it in. */
export interface ShowSlotInput {
  /** The slot as stored on the segment: 0-based, counted separately for the pre-show. */
  slot: number;
  preShow: boolean;
  /** The slot's role as the player reads it, such as "Main event". */
  roleLabel: string;
  /** How much the slot counts, from `slotWeightOf`. */
  weight: Traced<number>;
  /** False for an empty main-card slot. */
  filled: boolean;
  segmentId: SegmentId | null;
  kind: 'match' | 'angle' | null;
  matchTypeKey: ContentKey | null;
  /** The segment's score, 0 to 100. Set whenever `filled` is true. */
  score: number | null;
  participantIds: PersonId[];
  storylineIds: StorylineId[];
}

/** What the show score needs. */
export interface ShowScoreInputs {
  showName: string;
  importance: EventImportance;
  format: { slots: number; preShowSlots: number };
  /** One entry per main-card slot (filled or not) and one per filled pre-show slot. */
  slots: ShowSlotInput[];
  /** What each modifier's `gather` returned, by modifier id. */
  extras: Record<string, JsonValue>;
}

export interface ShowScoreDeps {
  tunables: EngineTunables;
  modifiers: readonly ShowScoreModifier[];
}

export interface ShowScoreResult {
  /** The final score, after every `cap` modifier. */
  score: Traced<number>;
  /** The score before any `cap` modifier. Equal to `score.value` when no cap applies. */
  rawScore: number;
}

/** Pre-show first, then the main card, each in slot order. */
function cardOrder(left: ShowSlotInput, right: ShowSlotInput): number {
  if (left.preShow !== right.preShow) {
    return left.preShow ? -1 : 1;
  }
  return left.slot - right.slot;
}

/** "Slot 3" or "Pre-show slot 1", 1-based as the player counts. */
function slotName(entry: ShowSlotInput): string {
  const shown = String(entry.slot + 1);
  return entry.preShow ? `Pre-show slot ${shown}` : `Slot ${shown}`;
}

function filledScore(entry: ShowSlotInput): number {
  if (entry.score === null) {
    throw new RangeError(`showScore: ${slotName(entry)} is filled but has no score`);
  }
  return entry.score;
}

/** How much a filled slot counts: its weight, times the pre-show factor on the pre-show. */
function countedWeight(entry: ShowSlotInput, tunables: EngineTunables): Traced<number> {
  const calc = startCalc(`${entry.roleLabel} counts`, entry.weight, { unit: 'multiplier' });
  if (entry.preShow) {
    calc.multiply(
      'Pre-show factor',
      calc.tunable(tunables, 'shows.score.preShowFactor', 'Pre-show factor'),
    );
  }
  return calc.done();
}

function applyStage(
  calc: Calc,
  stage: ShowScoreModifier['stage'],
  inputs: ShowScoreInputs,
  deps: ShowScoreDeps,
): void {
  const ordered = sortShowScoreModifiers(deps.modifiers).filter(
    (modifier) => modifier.stage === stage,
  );
  for (const modifier of ordered) {
    modifier.apply(calc, inputs, inputs.extras[modifier.id], { tunables: deps.tunables });
  }
}

/**
 * The show's score: `Σ score_i × w_i / Σ w_i` over the filled slots (pre-show weights times
 * `shows.score.preShowFactor`), less `shows.emptySlotPenalty` per empty main-card slot, then the
 * `adjust` modifiers, kept within 0..100 and rounded (the raw score), then the `cap` modifiers,
 * kept and rounded again (the score).
 *
 * @throws RangeError when a filled slot has no score.
 */
export function showScore(inputs: ShowScoreInputs, deps: ShowScoreDeps): ShowScoreResult {
  const calc = startCalc('Show score', 0, {
    unit: 'points',
    docRef: SHOW_SCORE_DOC_REF,
    startLabel: 'Nothing counted yet',
  });
  const ordered = [...inputs.slots].sort(cardOrder);
  const totalWeight = startCalc('Total weight', 0, { unit: 'multiplier', startLabel: 'No weight' });
  const emptySlots: ShowSlotInput[] = [];

  for (const entry of ordered) {
    if (!entry.filled) {
      if (!entry.preShow) {
        emptySlots.push(entry);
      }
      continue;
    }
    const score = filledScore(entry);
    const counts = countedWeight(entry, deps.tunables);
    const line = `${entry.roleLabel}: ${formatNumber(score)} × ${formatNumber(counts.value)}`;
    const contribution = startCalc(line, score, {
      unit: 'points',
      startLabel: `${entry.roleLabel} score`,
    })
      .multiply('Counts', counts)
      .done();
    calc.add(line, contribution);
    totalWeight.add(entry.roleLabel, counts.value);
  }

  const weightTotal = totalWeight.done();
  if (weightTotal.value > 0) {
    calc.divide('Divided by the total weight', weightTotal);
  } else {
    // Every counted weight is 0, so every line above added exactly 0: the mean is 0.
    calc.note('No slot counts toward the score');
  }

  if (emptySlots.length > 0) {
    const penalty = startCalc(`Empty main-card slots (${String(emptySlots.length)})`, 0, {
      unit: 'points',
      startLabel: 'No penalty',
    });
    const perSlot = penalty.tunable(deps.tunables, 'shows.emptySlotPenalty', 'Penalty per slot');
    for (const entry of emptySlots) {
      penalty.add(`${slotName(entry)} (${entry.roleLabel}) is empty`, perSlot);
    }
    calc.subtract(`Empty main-card slots (${String(emptySlots.length)})`, penalty.done());
  }

  applyStage(calc, 'adjust', inputs, deps);
  calc.clamp(SHOW_SCORE_MIN, SHOW_SCORE_MAX).round('round');
  const rawScore = calc.current;

  if (deps.modifiers.some((modifier) => modifier.stage === 'cap')) {
    calc.note(`Score before any cap: ${formatNumber(rawScore)}`);
    applyStage(calc, 'cap', inputs, deps);
    calc.clamp(SHOW_SCORE_MIN, SHOW_SCORE_MAX).round('round');
  }
  return { score: calc.done(), rawScore };
}
