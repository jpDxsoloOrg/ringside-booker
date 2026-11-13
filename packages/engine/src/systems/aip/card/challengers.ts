/**
 * Challengers: who meets the champions tonight, or who meets for a vacant title.
 *
 * Rules, in order, for every candidate in the card pool (docs/design/rival-booking.md#challengers):
 *
 * 1. fit to wrestle tonight: `canWrestle && restedEnough && !contractBlock`;
 * 2. not booked yet on this card;
 * 3. not a holder of this title;
 * 4. not a holder of another title, while `aip.titles.excludeOtherChampions` is on;
 * 5. eligible for the title (WRK1's `isEligibleForTitle`: gender and inclusive weight limits);
 * 6. not one of the title's last `aip.titles.recentChallengers` challengers. When that leaves
 *    nobody, the rule is lifted: "No fresh challenger: a rematch is allowed".
 *
 * Singles titles rank the survivors by card value, consider the top `aip.titles.challengerPool`
 * and pick one with a weighted roll (weight = card value, at least 1). Team titles (2 or 3
 * holders) use the pool's teams of the matching kind whose members all pass, ranked by mean card
 * value; with no team free, the best eligible worker outside any team is paired with the workers
 * closest to them in card value. A vacant title takes the two best contenders, no roll.
 */

import { rollWeighted } from '../../../core/rng/rolls';
import type { RngStream } from '../../../core/rng/registry';
import type { PersonId, TeamId } from '../../../core/ids';
import { startDecision, type Decision, type Traced } from '../../../core/trace';
import type { TeamKind } from '../../../model/entities/team';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import { formatNumber } from '../../world/people/labels';
import { isEligibleForTitle } from '../../workers/helpers/eligibility';
import { recentChallengersOf } from './titleHistory';
import { CHALLENGERS_DOC_REF } from './tunables';
import type { CardCandidate, CardPool, CardTitle, ChallengerPick, PlannedSide } from './types';

export const NO_FRESH_CHALLENGER = 'No fresh challenger: a rematch is allowed';
export const VACANT_CONTENDERS_REASON = 'Vacant title: the two best eligible contenders meet';
export const WEIGHTED_PICK_REASON = 'Picked by a roll weighted by card value';
export const ONLY_CONTENDER_REASON = 'The only eligible contender';

/** "No established team free: A & B paired for tonight". */
export function pairedForTonightText(names: readonly string[]): string {
  return `No established team free: ${names.join(' & ')} paired for tonight`;
}

/** "#1 Haruto Ise, card value 71". */
export function contenderText(rank: number, name: string, value: number): string {
  return `#${String(rank)} ${name}, card value ${formatNumber(value)}`;
}

export interface ChallengerArgs {
  /** Everyone already on tonight's card, champions of this title included. */
  readonly alreadyBooked: ReadonlySet<PersonId>;
}

export interface ChallengerDeps {
  readonly read: GameWorldView;
  readonly tunables: EngineTunables;
  /** The `aip.card` stream (or `aip.autofill` for the player's Auto-fill). */
  readonly rng: RngStream;
}

/** A side that may challenge: one person, a pool team or a pairing made for tonight. */
interface Contender {
  readonly personIds: readonly PersonId[];
  readonly teamId: TeamId | null;
  readonly name: string;
  readonly value: Traced<number> | number;
  /** The line the trace shows when this contender was made for tonight. */
  readonly pairedNote: string | null;
}

function valueOf(contender: Contender): number {
  return typeof contender.value === 'number' ? contender.value : contender.value.value;
}

/** Who passes rules 1-5, with a rule line for each failure. Rule 6 is applied by the caller. */
function eligibleCandidates(
  pool: CardPool,
  title: CardTitle,
  args: ChallengerArgs,
  deps: ChallengerDeps,
  decision: Decision<string>,
): CardCandidate[] {
  const excludeChampions = decision.tunable(deps.tunables, 'aip.titles.excludeOtherChampions');
  const holders = new Set<string>(title.holderIds);
  const eligible: CardCandidate[] = [];
  for (const candidate of pool.candidates) {
    const name = candidate.ringName;
    if (!candidate.canWrestle) {
      // Talkers and managers are not wrestlers tonight; no line, they were never contenders.
      continue;
    }
    if (holders.has(candidate.personId)) {
      continue;
    }
    if (!candidate.restedEnough) {
      decision.rule(`${name}: too tired (fatigue ${formatNumber(candidate.fatigue)})`, false);
      continue;
    }
    if (candidate.contractBlock !== null) {
      decision.rule(`${name}: contract rules out this show`, false);
      continue;
    }
    if (args.alreadyBooked.has(candidate.personId)) {
      decision.rule(`${name}: already on tonight's card`, false);
      continue;
    }
    const otherTitles = candidate.championOf.filter((titleId) => titleId !== title.titleId);
    if (excludeChampions && otherTitles.length > 0) {
      decision.rule(`${name}: holds another title`, false);
      continue;
    }
    const person = deps.read.tables.people.require(candidate.personId);
    const reasons = isEligibleForTitle(person, {
      name: title.name,
      status: 'active',
      division: title.division,
    });
    if (reasons.length > 0) {
      for (const reason of reasons) {
        decision.rule(`${name}: ${reason.message}`, false);
      }
      continue;
    }
    eligible.push(candidate);
  }
  return eligible;
}

function singlesContenders(people: readonly CardCandidate[]): Contender[] {
  return people.map((candidate) => ({
    personIds: [candidate.personId],
    teamId: null,
    name: candidate.ringName,
    value: candidate.cardValue,
    pairedNote: null,
  }));
}

/** Pool teams of the title's kind whose members all pass, by mean card value, then team ID. */
function teamContenders(pool: CardPool, title: CardTitle, people: readonly CardCandidate[]) {
  const kind: TeamKind = title.holderCount === 2 ? 'tag' : 'trio';
  const fit = new Set<string>(people.map((candidate) => candidate.personId));
  return pool.teams
    .filter(
      (team) =>
        team.kind === kind &&
        team.memberIds.length === title.holderCount &&
        team.memberIds.every((memberId) => fit.has(memberId)),
    )
    .sort(
      (left, right) =>
        right.meanCardValue - left.meanCardValue || compareIds(left.teamId, right.teamId),
    )
    .map((team): Contender => ({
      personIds: [...team.memberIds],
      teamId: team.teamId,
      name: team.name,
      value: team.meanCardValue,
      pairedNote: null,
    }));
}

/**
 * Pairings for tonight from fit workers in no pool team: the best one with the workers closest to
 * them in card value, repeated while `count` more are needed.
 */
function pairings(
  people: readonly CardCandidate[],
  size: number,
  count: number,
  taken: ReadonlySet<string>,
): Contender[] {
  const free = people.filter(
    (candidate) => candidate.teamIds.length === 0 && !taken.has(candidate.personId),
  );
  const made: Contender[] = [];
  while (made.length < count && free.length >= size) {
    const [lead] = free.splice(0, 1);
    if (lead === undefined) {
      break;
    }
    const partners = [...free]
      .sort(
        (left, right) =>
          Math.abs(left.cardValue.value - lead.cardValue.value) -
            Math.abs(right.cardValue.value - lead.cardValue.value) ||
          right.cardValue.value - left.cardValue.value ||
          compareIds(left.personId, right.personId),
      )
      .slice(0, size - 1);
    for (const partner of partners) {
      free.splice(free.indexOf(partner), 1);
    }
    const members = [lead, ...partners];
    const names = members.map((member) => member.ringName);
    made.push({
      personIds: members.map((member) => member.personId),
      teamId: null,
      name: names.join(' & '),
      value: members.reduce((sum, member) => sum + member.cardValue.value, 0) / members.length,
      pairedNote: pairedForTonightText(names),
    });
  }
  return made;
}

/** Contenders from `people`: singles, or teams then pairings for a team title. */
function contendersFrom(
  pool: CardPool,
  title: CardTitle,
  people: readonly CardCandidate[],
  needed: number,
): Contender[] {
  if (title.holderCount === 1) {
    return singlesContenders(people);
  }
  const teams = teamContenders(pool, title, people);
  if (teams.length >= needed) {
    return teams;
  }
  const taken = new Set<string>(teams.flatMap((team) => team.personIds));
  return [...teams, ...pairings(people, title.holderCount, needed - teams.length, taken)];
}

function sideOf(contender: Contender): PlannedSide {
  return { personIds: [...contender.personIds], teamId: contender.teamId, isChampions: false };
}

/**
 * The challengers for `title` tonight, or null when nobody eligible is free (the title is then
 * skipped, never forced into an invalid match). See the module comment for the rules.
 */
export function pickChallengers(
  pool: CardPool,
  title: CardTitle,
  args: ChallengerArgs,
  deps: ChallengerDeps,
): Traced<ChallengerPick> | null {
  const vacant = title.reignId === null;
  const needed = vacant ? 2 : 1;
  const decision = startDecision<string>(
    vacant ? `Contenders for the vacant ${title.name}` : `Challenger for the ${title.name}`,
    { docRef: CHALLENGERS_DOC_REF },
  );

  const eligible = eligibleCandidates(pool, title, args, deps, decision);
  const restCount = decision.tunable(deps.tunables, 'aip.titles.recentChallengers');
  const resting = new Set<string>(recentChallengersOf(deps.read, title.titleId, restCount));
  const fresh = eligible.filter((candidate) => !resting.has(candidate.personId));
  for (const candidate of eligible) {
    if (resting.has(candidate.personId)) {
      decision.rule(`${candidate.ringName}: challenged for this title lately`, false);
    }
  }

  let contenders = contendersFrom(pool, title, fresh, needed);
  if (contenders.length < needed && fresh.length < eligible.length) {
    decision.note(NO_FRESH_CHALLENGER);
    contenders = contendersFrom(pool, title, eligible, needed);
  }
  if (contenders.length < needed) {
    return null;
  }

  const poolSize = decision.tunable(deps.tunables, 'aip.titles.challengerPool');
  const considered = vacant ? contenders.slice(0, needed) : contenders.slice(0, poolSize);
  considered.forEach((contender, index) => {
    const line = contenderText(index + 1, contender.name, valueOf(contender));
    decision.consider(line, contender.value, contender.pairedNote ?? undefined);
    if (contender.pairedNote !== null) {
      decision.note(contender.pairedNote);
    }
  });
  const optionOf = (contender: Contender): string =>
    contenderText(considered.indexOf(contender) + 1, contender.name, valueOf(contender));

  if (vacant) {
    const [first] = considered;
    if (first === undefined) {
      return null;
    }
    const chosen = decision.choose(optionOf(first), VACANT_CONTENDERS_REASON);
    return { value: { sides: considered.map(sideOf) }, trace: chosen.trace };
  }

  const [only] = considered;
  if (considered.length === 1 && only !== undefined) {
    const chosen = decision.choose(optionOf(only), ONLY_CONTENDER_REASON);
    return { value: { sides: [sideOf(only)] }, trace: chosen.trace };
  }
  const roll = rollWeighted(
    deps.rng,
    considered.map((contender) => ({ item: contender, weight: Math.max(1, valueOf(contender)) })),
    `Challenger for the ${title.name}`,
    (contender) => contender.name,
  );
  decision.roll(roll.roll);
  const chosen = decision.choose(optionOf(roll.value), WEIGHTED_PICK_REASON);
  return { value: { sides: [sideOf(roll.value)] }, trace: chosen.trace };
}
