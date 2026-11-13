/**
 * The title picture: which of the show's titles are on the line tonight, who challenges, and in
 * what kind of match. Read-only; it returns planned title matches for the card planner and writes
 * nothing.
 *
 * Titles are considered in prestige order (highest first, then title ID). Each gets one decision,
 * labelled with the title's name, whose rules run in this order:
 *
 * 1. "Vacant: crown a new champion": a vacant title is always wanted;
 * 2. "Champion available tonight": every holder is in the pool, fit to wrestle, rested enough, free
 *    of contract blocks and not already defending another title tonight; else the title is skipped
 *    with the reason;
 * 3. urgency (`formulas/titleUrgency.ts`): the title is due when urgency reaches
 *    `aip.titles.dueThreshold`;
 * 4. the cap: the card holds at most `cap` title matches.
 *
 * Wanted titles are booked vacant first, then by urgency (highest first), then prestige. Each one
 * then needs a match type and challengers; a title without them is skipped, never forced. The
 * match type is rolled with the filler matches' weights (`formulas/matchTypeWeight.ts`) among the
 * types that can hold the title, after the challengers are picked.
 *
 * Design: docs/design/rival-booking.md#title-picture.
 */

import { diffDays, type GameDate } from '../../../core/date';
import type { PersonId } from '../../../core/ids';
import type { RngStream } from '../../../core/rng/registry';
import { rollWeighted } from '../../../core/rng/rolls';
import {
  limitTrace,
  startDecision,
  type Decision,
  type Traced,
  type TraceNode,
} from '../../../core/trace';
import { matchTypesOf, type MatchTypeDef } from '../../../model/catalogs';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import { formatNumber } from '../../world/people/labels';
import type { TracedTaste } from '../formulas/defaultTaste';
import { openReignOf } from '../inputs';
import { pickChallengers } from './challengers';
import { familyPlaceOf, matchFamilyOf, matchTypeWeight } from './formulas/matchTypeWeight';
import { daysSinceText, titleUrgency } from './formulas/titleUrgency';
import { lastDefenceOf } from './titleHistory';
import { TITLE_PICTURE_DOC_REF } from './tunables';
import type {
  CardPool,
  CardTitle,
  PlannedSide,
  PlannedTitleMatch,
  SkippedTitle,
  TitlePicture,
} from './types';

export const VACANT_RULE = 'Vacant: crown a new champion';
export const CHAMPION_AVAILABLE_RULE = 'Champion available tonight';
export const NO_CHALLENGER_REASON = 'No eligible challenger tonight';
export const NO_MATCH_TYPE_REASON = 'No match type can hold this title';
export const NO_DEFENCE_YET_NOTE = "No completed defence yet: counting from the reign's start";
export const DEFEND_REASON = 'On the line tonight';
export const MATCH_TYPE_LABEL = 'Match type';

/** A title left off because it is not due: "Not due: 12 days since the last defence". */
export function notDueText(days: number): string {
  return `Not due: ${daysSinceText(days)}`;
}

/** "Tessen Heavyweight Championship: due, 41 days since the last defence". */
export function titleDueText(titleName: string, days: number): string {
  return `${titleName}: due, ${daysSinceText(days)}`;
}

/** "Due: urgency 1.6 ≥ 1" or "Not due: urgency 0.4 < 1". */
export function dueText(urgency: number, threshold: number): string {
  const shown = formatNumber(urgency);
  return urgency >= threshold
    ? `Due: urgency ${shown} ≥ ${formatNumber(threshold)}`
    : `Not due: urgency ${shown} < ${formatNumber(threshold)}`;
}

/** "Card already has 2 title matches (limit 2)". */
export function capText(booked: number, cap: number): string {
  return `Card already has ${String(booked)} title ${booked === 1 ? 'match' : 'matches'} (limit ${String(cap)})`;
}

export interface TitlePictureArgs {
  /** The show's date (the pool's `date`). */
  readonly today: GameDate;
  /** The booker's taste; its `titleFocus` axis sets how often titles are defended. */
  readonly taste: TracedTaste;
  /** The most title matches the card may hold (`titleMatchCapFor`). */
  readonly cap: Traced<number>;
  /** People already on the card before the titles are planned (none by default). */
  readonly alreadyBooked?: ReadonlySet<PersonId>;
}

export interface TitlePictureDeps {
  readonly read: GameWorldView;
  readonly tunables: EngineTunables;
  /** The `aip.card` stream for a rival show, `aip.autofill` for the player's Auto-fill. */
  readonly rng: RngStream;
}

/** A title still in the running after rules 1-3. */
interface Wanted {
  readonly title: CardTitle;
  readonly decision: Decision<'defend' | 'skip'>;
  readonly urgency: number;
  readonly vacant: boolean;
}

/**
 * The non-hidden match types that can hold `title`: they allow titles, two sides with equal sides
 * of the title's holder count. Display order.
 */
function titleTypesOf(read: GameWorldView, title: CardTitle): MatchTypeDef[] {
  return matchTypesOf(read).filter(
    (type) =>
      type.allowsTitles &&
      type.equalSides &&
      type.sides.min <= 2 &&
      type.sides.max >= 2 &&
      type.sideSize.min <= title.holderCount &&
      type.sideSize.max >= title.holderCount,
  );
}

/**
 * The title match's type: a roll weighted by `matchTypeWeight` among the fitting types (the same
 * weights as a filler match). With every weight at 0, the first by display order.
 */
function matchTypeFor(
  pool: CardPool,
  title: CardTitle,
  fitting: readonly MatchTypeDef[],
  free: number,
  deps: TitlePictureDeps,
): { type: MatchTypeDef; trace: TraceNode } | null {
  const [first] = fitting;
  if (first === undefined) {
    return null;
  }
  const decision = startDecision<string>(MATCH_TYPE_LABEL, { docRef: TITLE_PICTURE_DOC_REF });
  const kind = title.holderCount === 3 ? 'trio' : 'tag';
  const teams = pool.teams.filter(
    (team) => team.kind === kind && team.memberIds.length === title.holderCount,
  ).length;
  const risk: Traced<number> = {
    value: pool.taste.values.riskAppetite,
    trace: pool.taste.traces.riskAppetite,
  };
  // Shares within a family come from the whole catalog, not just the types that fit tonight.
  const catalog = matchTypesOf(deps.read);
  const options = new Map<string, string>();
  const weighted: { type: MatchTypeDef; weight: number }[] = [];
  for (const type of fitting) {
    // Two types may share a name; the key keeps the options apart.
    const option = [...options.values()].includes(type.name)
      ? `${type.name} (${type.key})`
      : type.name;
    options.set(type.key, option);
    const weight = matchTypeWeight(
      {
        typeName: type.name,
        family: matchFamilyOf(type),
        familyPlace: familyPlaceOf(type, catalog),
        peopleNeeded: 2 * title.holderCount,
        freeWrestlers: free,
        freeTeams: teams,
        riskAppetite: risk,
      },
      deps,
    );
    decision.consider(option, weight);
    if (weight.value > 0) {
      weighted.push({ type, weight: weight.value });
    }
  }
  const optionOf = (type: MatchTypeDef): string => options.get(type.key) ?? type.name;
  if (weighted.length === 0) {
    return {
      type: first,
      trace: decision.choose(optionOf(first), 'Every type weighs 0: the first that fits the title')
        .trace,
    };
  }
  const [only] = weighted;
  if (weighted.length === 1 && only !== undefined) {
    return {
      type: only.type,
      trace: decision.choose(optionOf(only.type), 'The only match type that fits the title').trace,
    };
  }
  const roll = rollWeighted(
    deps.rng,
    weighted.map((entry) => ({ item: entry.type, weight: entry.weight })),
    `Match type for the ${title.name}`,
    (type) => type.name,
  );
  decision.roll(roll.roll);
  return {
    type: roll.value,
    trace: decision.choose(
      optionOf(roll.value),
      `Picked from ${String(weighted.length)} match types by a roll weighted by match type weight`,
    ).trace,
  };
}

/** The decision's trace with `extra` appended as children. */
function withChildren(chosen: Traced<string>, extra: readonly TraceNode[]): Traced<string> {
  if (extra.length === 0) {
    return chosen;
  }
  return {
    value: chosen.value,
    trace: limitTrace({ ...chosen.trace, children: [...(chosen.trace.children ?? []), ...extra] }),
  };
}

/**
 * Which titles go on tonight's card. See the module comment for the rules; every title ends up in
 * `planned` or `skipped` with a reason, and `trace` holds one decision per title.
 */
export function decideTitlePicture(
  pool: CardPool,
  args: TitlePictureArgs,
  deps: TitlePictureDeps,
): TitlePicture {
  const { read, tunables } = deps;
  const { today } = args;
  const byPerson = new Map(pool.candidates.map((candidate) => [candidate.personId, candidate]));
  const exclusions = new Map(pool.excluded.map((entry) => [entry.personId, entry.reason]));
  const titles = [...pool.titles].sort(
    (left, right) => right.prestige - left.prestige || compareIds(left.titleId, right.titleId),
  );
  const focus: Traced<number> = {
    value: args.taste.values.titleFocus,
    trace: args.taste.traces.titleFocus,
  };

  const results = new Map<string, Traced<string>>();
  const skipped = new Map<string, SkippedTitle>();
  const skip = (title: CardTitle, decision: Decision<'defend' | 'skip'>, reason: string): void => {
    results.set(title.titleId, decision.choose('skip', reason));
    skipped.set(title.titleId, { titleId: title.titleId, reason });
  };

  // Rules 1-3: vacant, champion available, urgency.
  const wanted: Wanted[] = [];
  for (const title of titles) {
    const decision = startDecision<'defend' | 'skip'>(title.name, {
      docRef: TITLE_PICTURE_DOC_REF,
    });
    if (title.reignId === null) {
      decision.rule(VACANT_RULE, true);
      wanted.push({ title, decision, urgency: 0, vacant: true });
      continue;
    }

    const unavailable = title.holderIds
      .map((holderId, index) => {
        const name = title.holderNames[index] ?? holderId;
        const candidate = byPerson.get(holderId);
        if (
          candidate !== undefined &&
          candidate.canWrestle &&
          candidate.restedEnough &&
          candidate.contractBlock === null
        ) {
          return null;
        }
        const why = exclusions.get(holderId) ?? 'not on this show';
        return `Champion ${name} can't defend tonight: ${why}`;
      })
      .filter((line): line is string => line !== null);
    decision.rule(CHAMPION_AVAILABLE_RULE, unavailable.length === 0);
    const [firstReason] = unavailable;
    if (firstReason !== undefined) {
      for (const line of unavailable) {
        decision.note(line);
      }
      skip(title, decision, firstReason);
      continue;
    }

    const last = lastDefenceOf(read, title, today);
    const days = last.date === null ? 0 : Math.max(0, diffDays(last.date, today));
    if (last.source === 'reignStart') {
      decision.note(NO_DEFENCE_YET_NOTE);
    }
    const urgency = titleUrgency(
      {
        titleName: title.name,
        prestige: title.prestige,
        daysSinceDefence: days,
        importance: pool.importance,
        titleFocus: focus,
      },
      { tunables },
    );
    const threshold = decision.tunable(tunables, 'aip.titles.dueThreshold');
    decision.consider('defend', urgency, 'Urgency');
    decision.consider('skip', threshold, 'Urgency needed to be due');
    const due = urgency.value >= threshold;
    decision.rule(dueText(urgency.value, threshold), due);
    if (!due) {
      skip(title, decision, notDueText(days));
      continue;
    }
    wanted.push({ title, decision, urgency: urgency.value, vacant: false });
  }

  // Rule 4 and the match itself, in booking order.
  wanted.sort(
    (left, right) =>
      Number(right.vacant) - Number(left.vacant) ||
      right.urgency - left.urgency ||
      right.title.prestige - left.title.prestige ||
      compareIds(left.title.titleId, right.title.titleId),
  );
  const booked = new Set<PersonId>(args.alreadyBooked ?? []);
  const planned: PlannedTitleMatch[] = [];
  const cap = args.cap.value;
  for (const { title, decision } of wanted) {
    const holderBooked = title.holderIds.find((holderId) => booked.has(holderId));
    if (holderBooked !== undefined) {
      const index = title.holderIds.indexOf(holderBooked);
      skip(
        title,
        decision,
        `Champion ${title.holderNames[index] ?? holderBooked} is already on tonight's card`,
      );
      continue;
    }
    const underCap = planned.length < cap;
    decision.rule(capText(planned.length, cap), underCap);
    if (!underCap) {
      skip(title, decision, capText(planned.length, cap));
      continue;
    }
    const fitting = titleTypesOf(read, title);
    if (fitting.length === 0) {
      skip(title, decision, NO_MATCH_TYPE_REASON);
      continue;
    }
    const pick = pickChallengers(
      pool,
      title,
      { alreadyBooked: new Set([...booked, ...title.holderIds]) },
      { read, tunables, rng: deps.rng },
    );
    if (pick === null) {
      skip(title, decision, NO_CHALLENGER_REASON);
      continue;
    }

    const champions: PlannedSide[] =
      title.holderIds.length === 0
        ? []
        : [
            {
              personIds: [...title.holderIds],
              teamId: openReignOf(read, title.titleId)?.teamId ?? null,
              isChampions: true,
            },
          ];
    const sides = [...champions, ...pick.value.sides.map((side) => ({ ...side }))];
    const free = Math.max(0, pool.availableWrestlers - booked.size);
    const matchType = matchTypeFor(pool, title, fitting, free, deps);
    if (matchType === null) {
      skip(title, decision, NO_MATCH_TYPE_REASON);
      continue;
    }
    for (const side of sides) {
      for (const personId of side.personIds) {
        booked.add(personId);
      }
    }
    const reason = title.reignId === null ? VACANT_RULE : DEFEND_REASON;
    const trace = withChildren(decision.choose('defend', reason), [pick.trace, matchType.trace]);
    results.set(title.titleId, trace);
    const challenger = typeof pick.trace.value === 'string' ? pick.trace.value : null;
    planned.push({
      titleId: title.titleId,
      matchTypeKey: matchType.type.key,
      sides,
      trace,
      challenger,
    });
  }

  const children = titles.flatMap((title) => {
    const result = results.get(title.titleId);
    return result === undefined ? [] : [result.trace];
  });
  const summary = startDecision<string>(`Title picture for ${pool.showName}`, {
    docRef: TITLE_PICTURE_DOC_REF,
  })
    .note(`Up to ${String(cap)} title ${cap === 1 ? 'match' : 'matches'} tonight`)
    .choose(
      String(planned.length),
      `${String(planned.length)} of ${String(titles.length)} titles on the line`,
    );
  const trace = limitTrace({
    ...summary.trace,
    children: [args.cap.trace, ...(summary.trace.children ?? []), ...children],
  });

  return {
    planned,
    skipped: titles.flatMap((title) => {
      const entry = skipped.get(title.titleId);
      return entry === undefined ? [] : [entry];
    }),
    trace,
  };
}
