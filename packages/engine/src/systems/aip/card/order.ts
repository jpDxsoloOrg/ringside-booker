/**
 * Ordering the card: which slot each planned segment takes (D-10: the slot's position gives its
 * role, and the main event is the heaviest slot).
 *
 * `orderCard(segments, scores, { slots, preShowSlots, mainEventMustBeMatch, fixed }, deps)` places
 * every planned segment by its card score (`formulas/cardScore.ts`). Rules, in order, each a line
 * in the order trace:
 *
 * 1. the main event slot (the last main-card slot) gets the highest-scoring match ("Strongest
 *    match closes the show"); on a house show the highest-scoring segment of any kind;
 * 2. with `aip.card.order.hotOpener` and at least three matches on the main card, the
 *    second-highest match opens the show ("Second-best match opens the show");
 * 3. the rest fill the other main-card slots in ascending score towards the main event; on a
 *    short card they take the open slots nearest the main event, so empty slots fall early;
 * 4. no two talking segments in a row: when rule 3 puts two together, talking segments move to the
 *    nearest slots that keep them apart and the matches close up around them, each move a line.
 *    The card shape (`talkSlotsFor`) leaves room for that; if the opener is needed it gives up its
 *    place, and if fixed slots make it impossible the order is kept with a note;
 * 5. the pre-show slots (while `aip.card.fillPreShow`) take the lowest-scoring matches; talking
 *    segments never go to the pre-show.
 *
 * Fixed segments (keep-filled mode: the ones already on the card) never move; planned segments only
 * take open slots. Main-card slots are filled before the pre-show.
 *
 * Design: docs/design/rival-booking.md#ordering.
 */

import { startDecision, type Traced, type TraceNode } from '../../../core/trace';
import type { SegmentDraft } from '../../booking/draft';
import type { EngineTunables } from '../../tunables';
import { formatNumber } from '../../world/people/labels';
import { ORDERING_DOC_REF } from './tunables';
import type { PlannedSegment } from './types';

export const MAIN_EVENT_MATCH_RULE = 'Strongest match closes the show';
export const MAIN_EVENT_ANY_RULE = 'Strongest segment closes the house show';
export const NO_MATCH_TO_CLOSE = 'No match to close the show: the strongest segment instead';
export const HOT_OPENER_RULE = 'Second-best match opens the show';
export const ASCENDING_RULE = 'Builds towards the main event';
export const SPACED_RULE = 'Moved so no two talking segments are in a row';
export const PRE_SHOW_RULE = 'Lowest-scoring matches go on the pre-show';
export const OPENER_GIVES_WAY =
  'The second-best match gives up the opener: the talking segments need the room';
export const CANNOT_SPACE_NOTE =
  'Segments already on the card leave no way to keep talking segments apart: the order is kept';
export const MAIN_EVENT_FIXED_NOTE = 'The main event slot is already booked';
export const NO_ROOM_ON_CARD = 'No open slot left on the card';

/** A segment already on the card in keep-filled mode. */
export interface FixedSegment {
  readonly kind: SegmentDraft['kind'];
  /** The matchup or segment name, for the trace. */
  readonly label: string;
}

/** `main:<slot>` or `pre:<slot>`, slots 0-based as stored. */
export function slotKeyOf(preShow: boolean, slot: number): string {
  return `${preShow ? 'pre' : 'main'}:${String(slot)}`;
}

export interface OrderCardOptions {
  /** Main-card slots (`format.slots`). */
  readonly slots: number;
  /** Pre-show slots (`format.preShowSlots`). */
  readonly preShowSlots: number;
  /** `mainEventMustBeMatch(importance).value`. */
  readonly mainEventMustBeMatch: boolean;
  /** Segments already on the card, by `slotKeyOf`; they never move. */
  readonly fixed: ReadonlyMap<string, FixedSegment>;
  /** The trace's title; defaults to "Card order". */
  readonly label?: string;
}

/** Where one planned segment goes. */
export interface CardPlacement {
  readonly segmentKey: string;
  readonly preShow: boolean;
  /** 0-based, as stored. */
  readonly slot: number;
  /** The ordering rule that put it there. */
  readonly rule: string;
}

export interface CardOrder {
  /** In running order: the pre-show first, then the main card. */
  readonly placements: readonly CardPlacement[];
  /** Planned segments that found no open slot. */
  readonly unplaced: readonly { readonly segmentKey: string; readonly reason: string }[];
  readonly trace: TraceNode;
}

interface Ranked {
  readonly segment: PlannedSegment;
  readonly score: number;
  readonly index: number;
}

/** "Haruto Ise vs Daichi Kuroe (score 71)". */
function scoredText(entry: Ranked): string {
  return `${entry.segment.trace.trace.label} (score ${formatNumber(entry.score)})`;
}

/** "Slot 3" (1-based) or "Pre-show slot 1". */
function slotText(preShow: boolean, slot: number): string {
  return `${preShow ? 'Pre-show slot' : 'Slot'} ${String(slot + 1)}`;
}

/** Highest score first; ties keep the planner's own order. */
function byScoreDesc(left: Ranked, right: Ranked): number {
  return right.score - left.score || left.index - right.index;
}

/** One occupied main-card position, in running order. */
interface Cell {
  readonly slot: number;
  /** Known kind (fixed, or placed by rules 1-2), or null for a slot rule 3 fills. */
  kind: SegmentDraft['kind'] | null;
}

/**
 * Whether `talks` talking segments fit the free cells from `index` on with no two in a row, given
 * whether the cell before is talking. Memoised by the caller.
 */
function fits(
  cells: readonly Cell[],
  index: number,
  previousTalks: boolean,
  talks: number,
  memo: Map<string, boolean>,
): boolean {
  const key = `${String(index)}|${String(previousTalks)}|${String(talks)}`;
  const known = memo.get(key);
  if (known !== undefined) {
    return known;
  }
  let result: boolean;
  const cell = cells[index];
  if (cell === undefined) {
    result = talks === 0;
  } else if (cell.kind === 'angle') {
    result = !previousTalks && fits(cells, index + 1, true, talks, memo);
  } else if (cell.kind === 'match') {
    result = fits(cells, index + 1, false, talks, memo);
  } else {
    result =
      (talks > 0 && !previousTalks && fits(cells, index + 1, true, talks - 1, memo)) ||
      fits(cells, index + 1, false, talks, memo);
  }
  memo.set(key, result);
  return result;
}

/**
 * Which free cells take talking segments: the ones the ascending order wants where that keeps them
 * apart, otherwise the nearest that do. Null when no spacing exists.
 */
function spacedKinds(
  cells: readonly Cell[],
  natural: readonly SegmentDraft['kind'][],
  talks: number,
): SegmentDraft['kind'][] | null {
  const memo = new Map<string, boolean>();
  if (!fits(cells, 0, false, talks, memo)) {
    return null;
  }
  const kinds: SegmentDraft['kind'][] = [];
  let left = talks;
  let previousTalks = false;
  let free = 0;
  for (const [index, cell] of cells.entries()) {
    if (cell.kind !== null) {
      kinds.push(cell.kind);
      previousTalks = cell.kind === 'angle';
      continue;
    }
    const wanted = natural[free] === 'angle';
    free += 1;
    const talkFits = left > 0 && !previousTalks && fits(cells, index + 1, true, left - 1, memo);
    const matchFits = fits(cells, index + 1, false, left, memo);
    const talk = wanted ? talkFits : !matchFits;
    kinds.push(talk ? 'angle' : 'match');
    if (talk) {
      left -= 1;
    }
    previousTalks = talk;
  }
  return kinds;
}

/** Places the planned segments. See the module comment for the rules. */
export function orderCard(
  segments: readonly PlannedSegment[],
  scores: ReadonlyMap<string, Traced<number>>,
  options: OrderCardOptions,
  deps: { readonly tunables: EngineTunables },
): CardOrder {
  const { tunables } = deps;
  const decision = startDecision<string>(options.label ?? 'Card order', {
    docRef: ORDERING_DOC_REF,
  });
  const ranked: Ranked[] = segments.map((segment, index) => ({
    segment,
    score: scores.get(segment.key)?.value ?? 0,
    index,
  }));
  const talks = ranked.filter((entry) => entry.segment.kind === 'angle').sort(byScoreDesc);
  const matches = ranked.filter((entry) => entry.segment.kind === 'match').sort(byScoreDesc);

  const openMain = Array.from({ length: options.slots }, (_, slot) => slot).filter(
    (slot) => !options.fixed.has(slotKeyOf(false, slot)),
  );
  const fillPreShow = decision.tunable(tunables, 'aip.card.fillPreShow');
  const openPre = fillPreShow
    ? Array.from({ length: options.preShowSlots }, (_, slot) => slot).filter(
        (slot) => !options.fixed.has(slotKeyOf(true, slot)),
      )
    : [];
  decision.note(
    `${String(openMain.length)} open main-card slots and ${String(openPre.length)} open pre-show slots`,
  );

  const unplaced: { segmentKey: string; reason: string }[] = [];
  // Talking segments only go on the main card; the best matches fill what is left of it.
  const mainTalks = talks.slice(0, openMain.length);
  for (const entry of talks.slice(openMain.length)) {
    unplaced.push({ segmentKey: entry.segment.key, reason: NO_ROOM_ON_CARD });
  }
  const mainMatchCount = Math.min(matches.length, openMain.length - mainTalks.length);
  const mainMatches = matches.slice(0, mainMatchCount);
  const preMatches = matches.slice(mainMatchCount, mainMatchCount + openPre.length);
  for (const entry of matches.slice(mainMatchCount + openPre.length)) {
    unplaced.push({ segmentKey: entry.segment.key, reason: NO_ROOM_ON_CARD });
  }

  const placed = new Map<number, { entry: Ranked; rule: string }>();
  const remaining = new Set<Ranked>([...mainTalks, ...mainMatches]);

  // Rule 1: the main event.
  const mainEventSlot = options.slots - 1;
  if (mainEventSlot >= 0 && options.fixed.has(slotKeyOf(false, mainEventSlot))) {
    decision.note(MAIN_EVENT_FIXED_NOTE);
  } else if (mainEventSlot >= 0 && remaining.size > 0) {
    const anyKind = [...remaining].sort(byScoreDesc)[0];
    const [bestMatch] = mainMatches;
    let pick: Ranked | undefined;
    let rule: string;
    if (!options.mainEventMustBeMatch) {
      pick = anyKind;
      rule = MAIN_EVENT_ANY_RULE;
    } else if (bestMatch !== undefined) {
      pick = bestMatch;
      rule = MAIN_EVENT_MATCH_RULE;
    } else {
      pick = anyKind;
      rule = NO_MATCH_TO_CLOSE;
    }
    if (pick !== undefined) {
      placed.set(mainEventSlot, { entry: pick, rule });
      remaining.delete(pick);
      decision.rule(`${rule}: ${scoredText(pick)}`, true);
    }
  }

  // Rule 2: the hot opener.
  const hotOpener = decision.tunable(tunables, 'aip.card.order.hotOpener');
  const openerSlot = 0;
  const openerFree =
    openerSlot !== mainEventSlot && !options.fixed.has(slotKeyOf(false, openerSlot));
  let opener: Ranked | undefined;
  if (hotOpener && mainMatches.length >= 3 && openerFree) {
    opener = mainMatches.find((entry) => remaining.has(entry));
    if (opener !== undefined) {
      placed.set(openerSlot, { entry: opener, rule: HOT_OPENER_RULE });
      remaining.delete(opener);
      decision.rule(`${HOT_OPENER_RULE}: ${scoredText(opener)}`, true);
    }
  } else if (hotOpener) {
    decision.rule(
      `${HOT_OPENER_RULE}: needs three matches on the main card and an open first slot`,
      false,
    );
  }

  // Rule 3: the rest, in ascending score towards the main event. On a short card they take the
  // open slots nearest the main event, so the slots left empty fall early on the card.
  const restSlotsOf = (): number[] => {
    const free = openMain.filter((slot) => !placed.has(slot));
    return remaining.size === 0 ? [] : free.slice(Math.max(0, free.length - remaining.size));
  };
  let rest = [...remaining].sort((left, right) => byScoreDesc(right, left));
  let restSlots = restSlotsOf();

  // Rule 4: keep talking segments apart.
  const cellsFor = (): Cell[] => {
    const occupied = new Set<number>([...restSlots, ...placed.keys()]);
    for (let slot = 0; slot < options.slots; slot++) {
      if (options.fixed.has(slotKeyOf(false, slot))) {
        occupied.add(slot);
      }
    }
    return [...occupied]
      .sort((left, right) => left - right)
      .map((slot) => {
        const fixed = options.fixed.get(slotKeyOf(false, slot));
        const kind = fixed?.kind ?? placed.get(slot)?.entry.segment.kind ?? null;
        return { slot, kind };
      });
  };
  const restTalks = rest.filter((entry) => entry.segment.kind === 'angle').length;
  let kinds = spacedKinds(
    cellsFor(),
    rest.map((entry) => entry.segment.kind),
    restTalks,
  );
  if (kinds === null && opener !== undefined) {
    placed.delete(openerSlot);
    remaining.add(opener);
    decision.note(OPENER_GIVES_WAY);
    opener = undefined;
    rest = [...remaining].sort((left, right) => byScoreDesc(right, left));
    restSlots = restSlotsOf();
    kinds = spacedKinds(
      cellsFor(),
      rest.map((entry) => entry.segment.kind),
      restTalks,
    );
  }

  if (kinds === null) {
    decision.note(CANNOT_SPACE_NOTE);
    for (const [index, entry] of rest.entries()) {
      const slot = restSlots[index];
      if (slot !== undefined) {
        placed.set(slot, { entry, rule: ASCENDING_RULE });
      }
    }
  } else {
    const cells = cellsFor();
    const naturalSlot = new Map<Ranked, number>();
    for (const [index, entry] of rest.entries()) {
      const slot = restSlots[index];
      if (slot !== undefined) {
        naturalSlot.set(entry, slot);
      }
    }
    const restTalkQueue = rest.filter((entry) => entry.segment.kind === 'angle');
    const restMatchQueue = rest.filter((entry) => entry.segment.kind === 'match');
    for (const [index, cell] of cells.entries()) {
      if (cell.kind !== null) {
        continue;
      }
      const entry = kinds[index] === 'angle' ? restTalkQueue.shift() : restMatchQueue.shift();
      if (entry === undefined) {
        continue;
      }
      const moved = entry.segment.kind === 'angle' && naturalSlot.get(entry) !== cell.slot;
      placed.set(cell.slot, { entry, rule: moved ? SPACED_RULE : ASCENDING_RULE });
      const from = naturalSlot.get(entry);
      if (moved && from !== undefined) {
        decision.rule(
          `${SPACED_RULE}: ${entry.segment.trace.trace.label} from ${slotText(false, from)} to ${slotText(false, cell.slot)}`,
          true,
        );
      }
    }
  }

  // Rule 5: the pre-show, lowest first.
  const preOrdered = [...preMatches].sort((left, right) => byScoreDesc(right, left));
  const prePlaced: CardPlacement[] = [];
  for (const [index, entry] of preOrdered.entries()) {
    const slot = openPre[index];
    if (slot === undefined) {
      continue;
    }
    prePlaced.push({ segmentKey: entry.segment.key, preShow: true, slot, rule: PRE_SHOW_RULE });
    decision.rule(`${PRE_SHOW_RULE}: ${scoredText(entry)}`, true);
  }
  if (preOrdered.length === 0 && openPre.length > 0) {
    decision.note('No match left over for the pre-show');
  }

  const mainPlaced: CardPlacement[] = [...placed.entries()]
    .sort(([left], [right]) => left - right)
    .map(([slot, { entry, rule }]) => ({
      segmentKey: entry.segment.key,
      preShow: false,
      slot,
      rule,
    }));
  const placements = [...prePlaced, ...mainPlaced];
  for (const entry of unplaced) {
    decision.rule(`${entry.segmentKey}: ${entry.reason}`, false);
  }
  const trace = decision.choose(
    String(placements.length),
    `${String(placements.length)} segments placed, ${String(unplaced.length)} without a slot`,
  ).trace;
  return { placements, unplaced, trace };
}
