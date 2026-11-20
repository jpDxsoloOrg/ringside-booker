/**
 * A different job (UNITY-38): the player offers someone on their roster another job, such as a
 * manager who gets a shot in the ring, or a wrestler who moves to managing or commentary.
 *
 * A job change is a renewal of the live contract whose offer names a different role. It goes
 * through the same talks as any renewal (the money is weighed, they may counter), with one extra
 * question first: do they want the new job at all? That answer is a score, every part traced:
 *
 * - fit: their rating in the new job against `contracts.jobChange.fitPivot` (wrestling skills
 *   for wrestling; mic, charisma and presence for managing or commentary, through the role
 *   rating weights);
 * - the ring's pull: a wrestler rated at least `contracts.react.refuseCrewRoleRating` still wants
 *   to wrestle;
 * - age: past `contracts.jobChange.oldFromAge` wrestling appeals less and a job outside the ring
 *   more; a young wrestler does not want to leave the ring;
 * - health: an injury or a worn-down body counts against wrestling and for leaving the ring;
 * - morale with you, and ambition (a thrill-seeker loves the ring; an egotist hates a smaller
 *   spotlight; a selfless worker helps out);
 * - the new pay against today's, and how much the new job is in the spotlight against today's
 *   (more for someone driven by legacy or power, pay more for someone driven by money).
 *
 * At or above `contracts.jobChange.acceptAt` they will take the job (then the money decides as
 * usual); below it they turn it down, and the biggest reason against is the answer's words.
 * Nothing is rolled and nothing here changes morale.
 *
 * Design: docs/design/negotiation.md#job-change.
 */

import { ageInYears, type GameDate } from '../../core/date';
import { startCalc } from '../../core/trace/calc';
import { startDecision } from '../../core/trace/decision';
import type { Traced } from '../../core/trace/types';
import type {
  ContractTerms,
  Employment,
  EmploymentRole,
  Push,
} from '../../model/entities/employment';
import type { Attributes, Person, RingStyle } from '../../model/entities/person';
import type { DeepReadonly } from '../../model/world';
import type { EngineTunables } from '../tunables';
import { overallOf } from '../workers/formulas/roleRating';
import { percentText, ROLE_WORDS } from './formulas/shared';

export const JOB_CHANGE_DOC_REF = 'negotiation.md#job-change';

/** The outcome code of talks closed because they did not want the new job. */
export const REFUSES_JOB_CODE = 'contracts.refusesJob';
export const REFUSES_JOB_MESSAGE = "Doesn't want the new job";

/** The jobs a job change can offer, in the order a screen lists them. */
export const JOB_CHANGE_ROLES = [
  'wrestler',
  'manager',
  'announcer',
  'presenter',
  'referee',
  'producer',
] as const satisfies readonly EmploymentRole[];

/** How much each job is in the spotlight, a wrestler's by card position. */
const SPOTLIGHT: Readonly<Record<Exclude<EmploymentRole, 'wrestler'>, number>> = {
  announcer: 3,
  booker: 3,
  manager: 2,
  presenter: 2,
  producer: 1,
  referee: 1,
};
const WRESTLER_SPOTLIGHT: Readonly<Record<Push, number>> = {
  mainEvent: 5,
  upperCard: 4,
  midCard: 3,
  lowerCard: 2.5,
  enhancement: 2,
  none: 2,
};

/** "the manager job", "wrestling". */
export function jobWords(role: EmploymentRole): string {
  return role === 'wrestler' ? 'wrestling' : `the ${ROLE_WORDS[role]} job`;
}

function spotlightOf(role: EmploymentRole, push: Push): number {
  return role === 'wrestler' ? WRESTLER_SPOTLIGHT[push] : SPOTLIGHT[role];
}

/** Pay a month: the wage, or the fee at a usual number of appearances. */
function monthlyPay(terms: DeepReadonly<ContractTerms>, appearances: number): number {
  return terms.kind === 'perAppearance' ? terms.perAppearanceFee * appearances : terms.monthlyWage;
}

/** True when `offerRole` is a different job from the one `contract` has. */
export function isJobChange(
  contract: Pick<Employment, 'role'> | null | undefined,
  offerRole: EmploymentRole,
): boolean {
  return contract !== null && contract !== undefined && contract.role !== offerRole;
}

export interface JobChangeInputs {
  readonly person: Person;
  /** The live contract the job change is offered on. */
  readonly contract: DeepReadonly<Employment>;
  readonly role: EmploymentRole;
  readonly push: Push;
  readonly terms: DeepReadonly<ContractTerms>;
  readonly date: GameDate;
}

export interface JobChangeAnswer {
  readonly from: EmploymentRole;
  readonly to: EmploymentRole;
  /** The score their answer is read from, every part traced. */
  readonly score: Traced<number>;
  /** True when they will take the job; the trace is the Why? of the answer. */
  readonly willing: Traced<boolean>;
  /** The answer in plain words: "Up for the manager job: happy here", "Doesn't want to wrestle: hurt right now". */
  readonly answer: string;
}

interface Part {
  readonly label: string;
  readonly amount: number;
}

function clampAbs(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** How a worker on your roster weighs an offer of a different job. Reads only. */
export function jobChangeAnswer(
  inputs: JobChangeInputs,
  deps: { tunables: EngineTunables },
): JobChangeAnswer {
  const { tunables } = deps;
  const { person, contract, role: to, push, terms, date } = inputs;
  const from = contract.role;
  const toRing = to === 'wrestler';
  const leavesRing = from === 'wrestler' && !toRing;
  const calc = startCalc(`How they feel about ${jobWords(to)}`, 0, {
    unit: 'points',
    docRef: JOB_CHANGE_DOC_REF,
    startLabel: 'No feeling either way',
  });
  const parts: Part[] = [];
  const add = (label: string, amount: number, reason?: string): void => {
    const rounded = round1(amount);
    if (rounded === 0) {
      return;
    }
    parts.push({ label, amount: rounded });
    calc.add(label, rounded, reason);
  };

  // Fit for the new job.
  const fit = overallOf(person, to, { tunables }).value;
  const pivot = calc.tunable(tunables, 'contracts.jobChange.fitPivot');
  const fitWeight = calc.tunable(tunables, 'contracts.jobChange.fitWeight');
  const fitWords =
    fit >= pivot
      ? `Good at ${jobWords(to)} (rated ${String(Math.round(fit))})`
      : `Not cut out for ${jobWords(to)} (rated ${String(Math.round(fit))})`;
  add(fitWords, (fit - pivot) * fitWeight, `Rating above or below ${String(pivot)}`);

  // Age.
  const age = ageInYears(person.birthDate, date);
  const oldFrom = calc.tunable(tunables, 'contracts.jobChange.oldFromAge');
  const yearsOver = Math.max(0, age - oldFrom);

  // A good wrestler still wants to wrestle; the pull fades as the years pass.
  if (leavesRing) {
    const line = calc.tunable(tunables, 'contracts.react.refuseCrewRoleRating');
    if (overallOf(person, 'wrestler', { tunables }).value >= line) {
      const pull = calc.tunable(tunables, 'contracts.jobChange.ringPull');
      const fade = calc.tunable(tunables, 'contracts.jobChange.ringPullFadeYears');
      const left = fade <= 0 ? 1 : Math.max(0, 1 - yearsOver / fade);
      add(
        'Still wants to wrestle',
        -pull * left,
        left < 1 ? `Fades with each year past ${String(oldFrom)}` : undefined,
      );
    }
  }

  if (yearsOver > 0 && (toRing || leavesRing)) {
    const perYear = calc.tunable(tunables, 'contracts.jobChange.perYearOld');
    const ageMax = calc.tunable(tunables, 'contracts.jobChange.ageMax');
    const amount = Math.min(ageMax, yearsOver * perYear);
    if (toRing) {
      add(`Feels too old to wrestle at ${String(age)}`, -amount);
    } else {
      add(`Ready to slow down at ${String(age)}`, amount);
    }
  }
  const youngUntil = calc.tunable(tunables, 'contracts.jobChange.youngUntil');
  if (age < youngUntil && (toRing || leavesRing)) {
    const young = calc.tunable(tunables, 'contracts.jobChange.young');
    if (toRing) {
      add(`Young enough to give the ring a go at ${String(age)}`, young);
    } else {
      add(`Too young to leave the ring at ${String(age)}`, -young);
    }
  }

  // Health.
  if (toRing || leavesRing) {
    if (person.injury !== null) {
      const injured = calc.tunable(tunables, 'contracts.jobChange.injured');
      if (toRing) {
        add('Hurt right now', -injured);
      } else {
        add('Hurt: a break from the ring appeals', injured / 2);
      }
    }
    const worst = Math.min(...Object.values(person.condition));
    const wornBelow = calc.tunable(tunables, 'contracts.jobChange.wornBelow');
    if (worst < wornBelow) {
      const perPoint = calc.tunable(tunables, 'contracts.jobChange.perPointWorn');
      const amount = (wornBelow - worst) * perPoint;
      if (toRing) {
        add('Body worn down', -amount);
      } else {
        add('Body worn down: glad to leave the ring', amount);
      }
    }
  }

  // Morale with you.
  const moraleWeight = calc.tunable(tunables, 'contracts.jobChange.moraleWeight');
  add(
    contract.morale >= 0 ? 'Happy here' : 'Unhappy here',
    contract.morale * moraleWeight,
    `Morale ${String(contract.morale)}`,
  );

  // Ambition.
  if (person.motivation === 'thrill' && (toRing || leavesRing)) {
    const thrill = calc.tunable(tunables, 'contracts.jobChange.thrill');
    if (toRing) {
      add('Loves the thrill of the ring', thrill);
    } else {
      add('Would miss the thrill of the ring', -thrill);
    }
  }
  const spotlightChange =
    spotlightOf(to, push) - spotlightOf(from, from === 'wrestler' ? contract.push : 'none');
  const trait = calc.tunable(tunables, 'contracts.jobChange.trait');
  if (person.traits.includes('selfless')) {
    add('Happy to help where needed', trait);
  }
  if (person.traits.includes('egotist') && spotlightChange < 0) {
    add('Wants to stay in the spotlight', -trait);
  }

  // Pay.
  const appearances = calc.tunable(tunables, 'contracts.jobChange.appearancesPerMonth');
  const nowPay = monthlyPay(contract.terms, appearances);
  if (nowPay > 0) {
    const share = monthlyPay(terms, appearances) / nowPay - 1;
    const payWeight = calc.tunable(tunables, 'contracts.jobChange.payWeight');
    const payMax = calc.tunable(tunables, 'contracts.jobChange.payMax');
    const money = person.motivation === 'money' ? 2 : 1;
    const words =
      share >= 0
        ? `Pays ${percentText(share)} more than now`
        : `Pays ${percentText(-share)} less than now`;
    add(
      words,
      clampAbs(share * payWeight * money, payMax * money),
      money > 1 ? 'Money matters most to them' : undefined,
    );
  }

  // Spotlight.
  if (spotlightChange !== 0) {
    const weight = calc.tunable(tunables, 'contracts.jobChange.prominenceWeight');
    const driven = person.motivation === 'legacy' || person.motivation === 'power' ? 2 : 1;
    add(
      spotlightChange > 0 ? 'More in the spotlight' : 'Less in the spotlight',
      spotlightChange * weight * driven,
      driven > 1 ? 'They care about their standing' : undefined,
    );
  }

  const score = calc.done();
  const decision = startDecision<boolean>(`Their answer to ${jobWords(to)}`, {
    docRef: JOB_CHANGE_DOC_REF,
  });
  decision.include('How they feel about it', score);
  const acceptAt = decision.tunable(tunables, 'contracts.jobChange.acceptAt');
  const willing = score.value >= acceptAt;
  decision.rule(`Score ${String(round1(score.value))} is at least ${String(acceptAt)}`, willing);
  const sorted = [...parts].sort((left, right) =>
    willing ? right.amount - left.amount : left.amount - right.amount,
  );
  const [top] = sorted;
  const because = top === undefined ? '' : `: ${lowerFirst(top.label)}`;
  const answer = willing
    ? `Up for ${jobWords(to)}${because}`
    : `${to === 'wrestler' ? "Doesn't want to wrestle" : `Doesn't want ${jobWords(to)}`}${because}`;
  return { from, to, score, willing: decision.choose(willing, answer), answer };
}

function lowerFirst(text: string): string {
  return text.length === 0 ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

/**
 * The ring style a non-wrestler gets when they take a wrestling job: a showman when character
 * leads, a high-flyer when athleticism does, else a technician.
 */
export function styleForNewWrestler(attributes: DeepReadonly<Attributes>): RingStyle {
  const character = attributes.charisma + attributes.presence;
  const craft = attributes.ringwork + attributes.psychology;
  if (character >= craft) {
    return 'showman';
  }
  return attributes.athleticism > attributes.ringwork ? 'highFlyer' : 'technician';
}
