/**
 * The doors: the only code that changes a worker's push, alignment or role, a person's or a
 * promotion's regional popularity, and a worker's momentum or morale once the world exists.
 *
 * Every door does the same five things: checks its arguments, keeps the new value inside its
 * range, writes through the step's transaction, records one trace and publishes one event. A
 * change that changes nothing writes, records and publishes nothing.
 *
 * A door never decides why. The caller brings the reason and the size of the change; the door
 * only applies it. In particular the morale door applies the delta it is given: whether a loss
 * should upset anyone is worked out before it gets here.
 *
 * Design: docs/design/workers.md#doors.
 */

import type { Reason } from '../../core/api/result';
import { InvalidArgumentError } from '../../core/errors';
import type { EmploymentId, PersonId, PromotionId, RegionId } from '../../core/ids';
import type { StepContext } from '../../core/pipeline/context';
import {
  startCalc,
  startDecision,
  traced,
  type Calc,
  type Traced,
  type TraceNode,
} from '../../core/trace';
import type { TraceRef } from '../../core/trace/store';
import {
  ALIGNMENTS,
  EMPLOYMENT_ROLES,
  ENDED_EMPLOYMENT_STATUSES,
  PUSH_LEVELS,
  type Alignment,
  type Employment,
  type EmploymentRole,
  type Push,
} from '../../model/entities/employment';
import type { Region } from '../../model/entities/geography';
import type { Person, PersonRole } from '../../model/entities/person';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import { geographyOf } from '../world/geography';
import {
  createPopularityRoller,
  type RegionalPopularity,
} from '../world/formulas/popularityRollup';
import type { DoorSource } from './events';
import { CREW_ROLES } from './formulas/expectedPush';
import { popularityAnchor, POPULARITY_DOC_REF } from './formulas/popularityAnchor';
import { popularityChange } from './formulas/popularityChange';
import type { EngineTunables } from '../tunables';

export type { DoorSource } from './events';

// ---------------------------------------------------------------------------------------------
// Shared shapes

/**
 * What a door needs from the step it runs in. Phases, reactions and a command's `apply` all have
 * these, so any of them can call a door.
 */
export type DoorContext = Pick<
  StepContext,
  'date' | 'tx' | 'read' | 'tunables' | 'publish' | 'recordTrace'
>;

/** Why a change is being made. The door records it and never judges it. */
export interface DoorReason {
  /** A stable key for listeners, such as `match.win`. Goes into the event as `reasonKey`. */
  key: string;
  /** The same reason written for the player. Goes into the trace. */
  label: string;
}

/** What a door did. `traceRef` is where the trace was stored, or null when nothing changed. */
export interface DoorResult<T> {
  changed: boolean;
  before: T;
  after: T;
  traceRef: TraceRef | null;
}

/** The trace kinds the doors store under. The id is the employment, person or promotion ID. */
export const DOOR_TRACE_KINDS = {
  push: 'workers.push',
  alignment: 'workers.alignment',
  role: 'workers.role',
  personPopularity: 'workers.popularity',
  promotionPopularity: 'promotions.popularity',
  momentum: 'workers.momentum',
  morale: 'workers.morale',
} as const;

export const DOORS_DOC_REF = 'workers.md#doors';
const MOMENTUM_DOC_REF = 'workers.md#momentum-door';
const MORALE_DOC_REF = 'workers.md#morale-door';

/** The ends of the momentum and morale scales. Fixed by the employment schema, not tunable. */
export const SIGNED_SCALE_MIN = -100;
export const SIGNED_SCALE_MAX = 100;

/** The reason key the role door gives the push door when a move to a crew job ends a push. */
export const ROLE_CHANGED_REASON_KEY = 'role.changed';

const PUSH_LABELS: Readonly<Record<Push, string>> = {
  mainEvent: 'Main event',
  upperCard: 'Upper card',
  midCard: 'Mid card',
  lowerCard: 'Lower card',
  enhancement: 'Enhancement',
  none: 'Not pushed',
};

const ALIGNMENT_LABELS: Readonly<Record<Alignment, string>> = {
  face: 'Face',
  heel: 'Heel',
  tweener: 'Tweener',
};

const ROLE_LABELS: Readonly<Record<EmploymentRole, string>> = {
  wrestler: 'Wrestler',
  manager: 'Manager',
  presenter: 'Presenter',
  announcer: 'Announcer',
  referee: 'Referee',
  producer: 'Producer',
  booker: 'Booker',
};

// ---------------------------------------------------------------------------------------------
// Argument checks

function isOneOf<Value extends string>(options: readonly Value[], value: unknown): value is Value {
  return options.some((option) => option === value);
}

function isEnded(employment: Employment): boolean {
  return isOneOf(ENDED_EMPLOYMENT_STATUSES, employment.status);
}

/** The employment a door is asked to change. Unknown and ended employments are caller bugs. */
function requireOpenEmployment(
  read: GameWorldView,
  door: string,
  employmentId: EmploymentId,
): Employment {
  const employment = read.tables.employments.get(employmentId);
  if (employment === undefined) {
    throw new InvalidArgumentError(door, 'employmentId', employmentId, 'an existing employment');
  }
  if (isEnded(employment)) {
    throw new InvalidArgumentError(
      door,
      'employmentId',
      employmentId,
      `an employment that has not ended (it is ${employment.status})`,
    );
  }
  return employment;
}

function requirePerson(read: GameWorldView, door: string, personId: PersonId): Person {
  const person = read.tables.people.get(personId);
  if (person === undefined) {
    throw new InvalidArgumentError(door, 'personId', personId, 'an existing person');
  }
  return person;
}

function requireReason(door: string, reason: DoorReason): void {
  if (reason.key === '') {
    throw new InvalidArgumentError(door, 'reason.key', reason.key, 'a reason key');
  }
  if (reason.label === '') {
    throw new InvalidArgumentError(door, 'reason.label', reason.label, 'a reason for the player');
  }
}

function employmentChange(employment: Employment, source: DoorSource, reason: DoorReason) {
  return {
    employmentId: employment.id,
    personId: employment.personId,
    promotionId: employment.promotionId,
    source,
    reasonKey: reason.key,
  };
}

function unchanged<T>(value: T): DoorResult<T> {
  return { changed: false, before: value, after: value, traceRef: null };
}

// ---------------------------------------------------------------------------------------------
// Push

export interface SetPushArgs {
  employmentId: EmploymentId;
  push: Push;
  source: DoorSource;
  reason: DoorReason;
}

/** Changes a worker's card position. */
export function setPush(ctx: DoorContext, args: SetPushArgs): DoorResult<Push> {
  const employment = requireOpenEmployment(ctx.read, 'setPush', args.employmentId);
  if (!isOneOf(PUSH_LEVELS, args.push)) {
    throw new InvalidArgumentError('setPush', 'push', args.push, 'a push level');
  }
  requireReason('setPush', args.reason);
  const before = employment.push;
  if (before === args.push) {
    return unchanged(before);
  }
  ctx.tx.update('employments', employment.id, { push: args.push });
  const traceRef: TraceRef = { kind: DOOR_TRACE_KINDS.push, id: employment.id };
  ctx.recordTrace(
    traceRef,
    ctx.date,
    startDecision<Push>('Push', { docRef: DOORS_DOC_REF })
      .rule(`Was ${PUSH_LABELS[before]}`, true)
      .choose(args.push, args.reason.label),
  );
  ctx.publish('employment.pushChanged', {
    ...employmentChange(employment, args.source, args.reason),
    from: before,
    to: args.push,
  });
  return { changed: true, before, after: args.push, traceRef };
}

// ---------------------------------------------------------------------------------------------
// Alignment

export interface SetAlignmentArgs {
  employmentId: EmploymentId;
  alignment: Alignment;
  source: DoorSource;
  reason: DoorReason;
}

/** Turns a worker face, heel or tweener. */
export function setAlignment(ctx: DoorContext, args: SetAlignmentArgs): DoorResult<Alignment> {
  const employment = requireOpenEmployment(ctx.read, 'setAlignment', args.employmentId);
  if (!isOneOf(ALIGNMENTS, args.alignment)) {
    throw new InvalidArgumentError('setAlignment', 'alignment', args.alignment, 'an alignment');
  }
  requireReason('setAlignment', args.reason);
  const before = employment.alignment;
  if (before === args.alignment) {
    return unchanged(before);
  }
  ctx.tx.update('employments', employment.id, { alignment: args.alignment });
  const traceRef: TraceRef = { kind: DOOR_TRACE_KINDS.alignment, id: employment.id };
  ctx.recordTrace(
    traceRef,
    ctx.date,
    startDecision<Alignment>('Alignment', { docRef: DOORS_DOC_REF })
      .rule(`Was ${ALIGNMENT_LABELS[before]}`, true)
      .choose(args.alignment, args.reason.label),
  );
  ctx.publish('employment.alignmentChanged', {
    ...employmentChange(employment, args.source, args.reason),
    from: before,
    to: args.alignment,
  });
  return { changed: true, before, after: args.alignment, traceRef };
}

// ---------------------------------------------------------------------------------------------
// Role

/** The codes {@link setRoleProblems} can return. */
export const SET_ROLE_PROBLEM_CODES = [
  'unknownEmployment',
  'employmentEnded',
  'styleForbidsWrestling',
  'cannotBook',
] as const;
export type SetRoleProblemCode = (typeof SET_ROLE_PROBLEM_CODES)[number];

/**
 * The person role each job needs. A booker needs no person role: who may book is the
 * `career.canBook` flag.
 */
const PERSON_ROLE_FOR: Readonly<Record<EmploymentRole, PersonRole | null>> = {
  wrestler: 'wrestler',
  manager: 'manager',
  presenter: 'presenter',
  announcer: 'announcer',
  referee: 'referee',
  producer: 'producer',
  booker: null,
};

/** True when the person already holds what the job needs. A part-timer counts as a wrestler. */
function holdsPersonRole(person: Pick<Person, 'roles'>, needed: PersonRole): boolean {
  return person.roles.some(
    (role) => role === needed || (needed === 'wrestler' && role === 'occasionalWrestler'),
  );
}

/**
 * Every rule that stops this employment's worker from taking `role`, written for the player. An
 * empty list means the role door will accept the change. Commands check with this before they
 * call {@link setRole}, so the player hears the same rules the door enforces.
 */
export function setRoleProblems(
  read: GameWorldView,
  employmentId: EmploymentId,
  role: EmploymentRole,
): Reason[] {
  const employment = read.tables.employments.get(employmentId);
  if (employment === undefined) {
    return [
      { code: 'unknownEmployment', message: 'That contract does not exist', field: 'employmentId' },
    ];
  }
  const subject = { kind: 'person', id: employment.personId } as const;
  if (isEnded(employment)) {
    return [
      {
        code: 'employmentEnded',
        message: `${employment.ringName}'s contract has ended`,
        field: 'employmentId',
        subject,
      },
    ];
  }
  const person = read.tables.people.get(employment.personId);
  if (person === undefined) {
    return [
      { code: 'unknownEmployment', message: 'That contract has no worker', field: 'employmentId' },
    ];
  }
  const problems: Reason[] = [];
  if (role === 'wrestler' && person.style === 'nonWrestler') {
    problems.push({
      code: 'styleForbidsWrestling',
      message: `${employment.ringName} is not a wrestler and cannot be given a wrestling role`,
      field: 'role',
      subject,
    });
  }
  if (role === 'booker' && !person.career.canBook) {
    problems.push({
      code: 'cannotBook',
      message: `${employment.ringName} cannot work as a booker`,
      field: 'role',
      subject,
    });
  }
  return problems;
}

export interface SetRoleArgs {
  employmentId: EmploymentId;
  role: EmploymentRole;
  source: DoorSource;
  reason: DoorReason;
}

/**
 * Changes a worker's job with the promotion. The person gains the matching person role when they
 * do not hold it yet, and a move into a crew job ends their push through {@link setPush}.
 */
export function setRole(ctx: DoorContext, args: SetRoleArgs): DoorResult<EmploymentRole> {
  const employment = requireOpenEmployment(ctx.read, 'setRole', args.employmentId);
  if (!isOneOf(EMPLOYMENT_ROLES, args.role)) {
    throw new InvalidArgumentError('setRole', 'role', args.role, 'an employment role');
  }
  requireReason('setRole', args.reason);
  const before = employment.role;
  if (before === args.role) {
    return unchanged(before);
  }
  const [problem] = setRoleProblems(ctx.read, employment.id, args.role);
  if (problem !== undefined) {
    throw new InvalidArgumentError(
      'setRole',
      'role',
      args.role,
      `a role this worker can take (${problem.message})`,
    );
  }
  const person = requirePerson(ctx.read, 'setRole', employment.personId);

  const decision = startDecision<EmploymentRole>('Role', { docRef: DOORS_DOC_REF }).rule(
    `Was ${ROLE_LABELS[before]}`,
    true,
  );
  const neededRole = PERSON_ROLE_FOR[args.role];
  if (neededRole !== null && !holdsPersonRole(person, neededRole)) {
    ctx.tx.update('people', person.id, { roles: [...person.roles, neededRole] });
    decision.note(`Gains the ${ROLE_LABELS[args.role].toLowerCase()} role`);
  }
  ctx.tx.update('employments', employment.id, { role: args.role });
  if (isOneOf(CREW_ROLES, args.role) && employment.push !== 'none') {
    decision.note(
      `The ${ROLE_LABELS[args.role].toLowerCase()} job is not pushed, so the push ends`,
    );
    setPush(ctx, {
      employmentId: employment.id,
      push: 'none',
      source: args.source,
      reason: {
        key: ROLE_CHANGED_REASON_KEY,
        label: `Role changed to ${ROLE_LABELS[args.role].toLowerCase()}`,
      },
    });
  }

  const traceRef: TraceRef = { kind: DOOR_TRACE_KINDS.role, id: employment.id };
  ctx.recordTrace(traceRef, ctx.date, decision.choose(args.role, args.reason.label));
  ctx.publish('employment.roleChanged', {
    ...employmentChange(employment, args.source, args.reason),
    from: before,
    to: args.role,
  });
  return { changed: true, before, after: args.role, traceRef };
}

// ---------------------------------------------------------------------------------------------
// Popularity

/** Whose popularity a change is for. */
export type PopularitySubject =
  { kind: 'person'; id: PersonId } | { kind: 'promotion'; id: PromotionId };

/** What every popularity change says: whose popularity, who asked and why. */
interface PopularityChangeBase {
  subject: PopularitySubject;
  source: DoorSource;
  reason: DoorReason;
}

/** One change spread over several regions by weight. */
export interface WeightedPopularityChangeArgs extends PopularityChangeBase {
  /** How much of the change each region gets, 0 to 1. Regions left out are untouched. */
  regionWeights: Readonly<Partial<Record<RegionId, number>>>;
  /** The size of the change in points, before the weights. A traced delta is kept in the trace. */
  delta: number | Traced<number>;
  regionDeltas?: never;
}

/**
 * A different change in each region (EVT5-02: one show moves each region it reached by its own
 * amount). Each region's delta lands at weight 1; a traced delta is kept in that region's trace.
 */
export interface RegionDeltasPopularityChangeArgs extends PopularityChangeBase {
  /** The change in points for each region. Regions left out are untouched. */
  regionDeltas: Readonly<Partial<Record<RegionId, number | Traced<number>>>>;
  regionWeights?: never;
  delta?: never;
}

/** Either one change spread by weight, or each region's own change. Never both. */
export type ApplyPopularityChangeArgs =
  WeightedPopularityChangeArgs | RegionDeltasPopularityChangeArgs;

/** One region's stored popularity before and after a door call (0 when nothing is stored). */
export interface RegionPopularityChange {
  before: number;
  after: number;
}

/** What the popularity door did: the stored maps, and the worldwide figure each rolls up to. */
export interface PopularityDoorResult extends DoorResult<RegionalPopularity> {
  worldBefore: number;
  worldAfter: number;
  /** The regions whose stored value changed, most populous first. */
  regionsChanged: RegionId[];
  /** Every region the call named, changed or not, with its value before and after. */
  byRegion: Partial<Record<RegionId, RegionPopularityChange>>;
}

/** One region the door is asked to change: how much of which change it gets. */
interface RegionRequest {
  region: Region;
  weight: number;
  delta: number | Traced<number>;
}

/** Throws unless every key of `byRegion` is a region on the map. */
function requireKnownRegions(
  read: GameWorldView,
  field: string,
  byRegion: Readonly<Partial<Record<RegionId, unknown>>>,
): void {
  const knownIds = new Set<string>(read.tables.regions.ids());
  for (const regionId of Object.keys(byRegion)) {
    if (!knownIds.has(regionId)) {
      throw new InvalidArgumentError(
        'applyPopularityChange',
        field,
        regionId,
        'the ID of a region on the map',
      );
    }
  }
}

function requireFinite(field: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new InvalidArgumentError('applyPopularityChange', field, value, 'a finite number');
  }
}

/**
 * The regions the call names, most populous first (ties by ID), each with its weight and delta.
 * Throws when the call mixes the two forms, names an unknown region or gives a number that is
 * not finite.
 */
function requestedRegions(read: GameWorldView, args: ApplyPopularityChangeArgs): RegionRequest[] {
  const requests: RegionRequest[] = [];
  if (args.regionDeltas !== undefined) {
    // The types already refuse the mix; this catches callers the types cannot see.
    if (Object.hasOwn(args, 'regionWeights') || Object.hasOwn(args, 'delta')) {
      throw new InvalidArgumentError(
        'applyPopularityChange',
        'regionDeltas',
        'regionDeltas with regionWeights or delta',
        'either regionDeltas, or regionWeights with delta, never both',
      );
    }
    const { regionDeltas } = args;
    requireKnownRegions(read, 'regionDeltas', regionDeltas);
    for (const region of read.tables.regions.values()) {
      const delta = regionDeltas[region.id];
      if (delta === undefined) {
        continue;
      }
      requireFinite(`regionDeltas.${region.id}`, typeof delta === 'number' ? delta : delta.value);
      requests.push({ region, weight: 1, delta });
    }
  } else {
    requireKnownRegions(read, 'regionWeights', args.regionWeights);
    const deltaValue = typeof args.delta === 'number' ? args.delta : args.delta.value;
    for (const region of read.tables.regions.values()) {
      const weight = args.regionWeights[region.id];
      if (weight === undefined) {
        continue;
      }
      requireFinite(`regionWeights.${region.id}`, weight);
      requests.push({ region, weight, delta: deltaValue });
    }
  }
  return requests.sort(
    (left, right) =>
      right.region.population - left.region.population ||
      compareIds(left.region.id, right.region.id),
  );
}

/** What the door needs to know about the person or promotion whose popularity is changing. */
interface PopularityTarget {
  regionalPop: RegionalPopularity;
  /** The person's anchor; null for a promotion, which has none. */
  anchor: Traced<number> | null;
}

function popularityTarget(ctx: DoorContext, subject: PopularitySubject): PopularityTarget {
  if (subject.kind === 'person') {
    const person = requirePerson(ctx.read, 'applyPopularityChange', subject.id);
    return {
      regionalPop: person.regionalPop,
      anchor: popularityAnchor(
        { charisma: person.attributes.charisma },
        { tunables: ctx.tunables },
      ),
    };
  }
  const promotion = ctx.read.tables.promotions.get(subject.id);
  if (promotion === undefined) {
    throw new InvalidArgumentError(
      'applyPopularityChange',
      'subject.id',
      subject.id,
      'an existing promotion',
    );
  }
  return { regionalPop: promotion.regionalPop, anchor: null };
}

/** The parent trace with the caller's own working for the delta shown once, right after the start. */
function withDeltaTrace(result: Traced<number>, delta: Traced<number>): Traced<number> {
  if (result.trace.kind !== 'formula') {
    return result;
  }
  const [start, ...steps] = result.trace.children;
  if (start === undefined) {
    return result;
  }
  const asked: TraceNode = {
    kind: 'input',
    label: 'Change asked for',
    value: delta.value,
    unit: 'points',
    children: [delta.trace],
  };
  return traced(result.value, { ...result.trace, children: [start, asked, ...steps] });
}

/**
 * Changes a person's or a promotion's popularity in the weighted regions. Each region gets
 * `delta × weight` (or, with `regionDeltas`, its own delta), a person's gains taper above their
 * anchor, and every result stays between 0 and 100. The stored map stays sparse: a region that
 * ends at 0, or below `workers.popularity.dropBelow`, is removed. One call records one trace and
 * publishes one `popularity.changed`, however many regions it names.
 */
export function applyPopularityChange(
  ctx: DoorContext,
  args: ApplyPopularityChangeArgs,
): PopularityDoorResult {
  requireReason('applyPopularityChange', args.reason);
  const target = popularityTarget(ctx, args.subject);
  const regions = requestedRegions(ctx.read, args);
  const dropBelow = ctx.tunables.get('workers.popularity.dropBelow');

  const before = target.regionalPop;
  const stored = new Map<RegionId, number>();
  for (const region of ctx.read.tables.regions.values()) {
    const value = before[region.id];
    if (value !== undefined) {
      stored.set(region.id, value);
    }
  }
  const regionsChanged: RegionId[] = [];
  const byRegion: Partial<Record<RegionId, RegionPopularityChange>> = {};
  const total = startCalc(`Popularity change: ${args.reason.label}`, 0, {
    unit: 'points',
    docRef: POPULARITY_DOC_REF,
    startLabel: 'Points moved so far',
  });
  for (const { region, weight, delta } of regions) {
    const regionBefore = before[region.id] ?? 0;
    const changed = popularityChange(
      {
        subjectKind: args.subject.kind,
        regionName: region.name,
        before: regionBefore,
        delta,
        weight,
        anchor: target.anchor,
      },
      { tunables: ctx.tunables },
    );
    // The schemas refuse a stored 0, so a region that ends with nothing is left out of the map.
    const tooSmall = changed.value !== 0 && changed.value < dropBelow;
    const regionAfter = tooSmall ? 0 : changed.value;
    const moved = startCalc(`Change in ${region.name}`, changed, { unit: 'points' });
    if (tooSmall) {
      moved.multiply(
        'Too small to keep',
        0,
        `Below the drop threshold of ${String(dropBelow)}, so the region is removed`,
      );
    }
    total.add(region.name, moved.subtract('Popularity before', regionBefore).done());
    byRegion[region.id] = { before: regionBefore, after: regionAfter };
    if (regionAfter !== regionBefore) {
      regionsChanged.push(region.id);
    }
    if (regionAfter === 0) {
      stored.delete(region.id);
    } else {
      stored.set(region.id, regionAfter);
    }
  }
  // The cast names the key type `Object.fromEntries` widens to string.
  const after = Object.fromEntries(stored) as Record<RegionId, number>;

  const roller = createPopularityRoller(geographyOf(ctx.read));
  const worldBefore = roller.rollValues(before).world;
  if (regionsChanged.length === 0) {
    return {
      ...unchanged(before),
      worldBefore,
      worldAfter: worldBefore,
      regionsChanged,
      byRegion,
    };
  }
  const worldAfter = roller.rollValues(after).world;
  if (args.subject.kind === 'person') {
    ctx.tx.update('people', args.subject.id, { regionalPop: after });
  } else {
    ctx.tx.update('promotions', args.subject.id, { regionalPop: after });
  }

  const traceRef: TraceRef = {
    kind:
      args.subject.kind === 'person'
        ? DOOR_TRACE_KINDS.personPopularity
        : DOOR_TRACE_KINDS.promotionPopularity,
    id: args.subject.id,
  };
  const summed = total.done();
  ctx.recordTrace(
    traceRef,
    ctx.date,
    args.delta === undefined || typeof args.delta === 'number'
      ? summed
      : withDeltaTrace(summed, args.delta),
  );
  ctx.publish('popularity.changed', {
    subjectKind: args.subject.kind,
    subjectId: args.subject.id,
    worldBefore,
    worldAfter,
    regionsChanged: regionsChanged.length,
    source: args.source,
    reasonKey: args.reason.key,
  });
  return {
    changed: true,
    before,
    after,
    traceRef,
    worldBefore,
    worldAfter,
    regionsChanged,
    byRegion,
  };
}

// ---------------------------------------------------------------------------------------------
// Momentum

export interface ApplyMomentumChangeArgs {
  employmentId: EmploymentId;
  /** Points to add; negative to take away. A traced delta is kept in the trace. */
  delta: number | Traced<number>;
  source: DoorSource;
  reason: DoorReason;
}

const MOMENTUM_CALC_OPTIONS = { unit: 'points', docRef: MOMENTUM_DOC_REF } as const;

/**
 * Starts the calculation of a first momentum: the person's popularity in the home region of the
 * employing promotion times `workers.momentum.initialPopFactor`. The door continues it with the
 * delta; {@link initialMomentum} finishes it on its own.
 */
function startInitialMomentum(
  read: GameWorldView,
  employment: Pick<Employment, 'personId' | 'promotionId'>,
  tunables: EngineTunables,
  label: string,
  door: string,
): Calc {
  const person = requirePerson(read, door, employment.personId);
  const promotion = read.tables.promotions.require(employment.promotionId);
  const homeRegion = read.tables.regions.require(promotion.homeRegionId);
  const calc = startCalc(label, person.regionalPop[homeRegion.id] ?? 0, {
    ...MOMENTUM_CALC_OPTIONS,
    startLabel: `Popularity in ${homeRegion.name}`,
  });
  return calc
    .multiply(
      'Starting share of home popularity',
      calc.tunable(
        tunables,
        'workers.momentum.initialPopFactor',
        'Starting share of home popularity',
      ),
    )
    .note('First appearance: starts from home-region popularity');
}

/**
 * The momentum an employment with no momentum yet starts from, exactly as
 * {@link applyMomentumChange} will initialise it before adding its first delta (not clamped: the
 * door clamps after adding). Callers that judge a change before making it (the match aftermath)
 * use it so their "before" matches the door's.
 */
export function initialMomentum(
  read: GameWorldView,
  employment: Pick<Employment, 'personId' | 'promotionId'>,
  tunables: EngineTunables,
): Traced<number> {
  return startInitialMomentum(
    read,
    employment,
    tunables,
    'Starting momentum',
    'initialMomentum',
  ).done();
}

/**
 * Adds to a worker's momentum and keeps it between -100 and 100. Momentum is empty until the first
 * appearance under a contract: the first change starts it from the person's popularity in the
 * promotion's home region times `workers.momentum.initialPopFactor` ({@link initialMomentum}),
 * then adds the delta.
 */
export function applyMomentumChange(
  ctx: DoorContext,
  args: ApplyMomentumChangeArgs,
): DoorResult<number | null> {
  const employment = requireOpenEmployment(ctx.read, 'applyMomentumChange', args.employmentId);
  requireReason('applyMomentumChange', args.reason);
  const before = employment.momentum;
  const calc =
    before === null
      ? startInitialMomentum(ctx.read, employment, ctx.tunables, 'Momentum', 'applyMomentumChange')
      : startCalc('Momentum', before, { ...MOMENTUM_CALC_OPTIONS, startLabel: 'Momentum before' });
  const result = calc
    .add(args.reason.label, args.delta)
    .clamp(SIGNED_SCALE_MIN, SIGNED_SCALE_MAX)
    .done();
  if (before === result.value) {
    return unchanged(before);
  }
  ctx.tx.update('employments', employment.id, { momentum: result.value });
  const traceRef: TraceRef = { kind: DOOR_TRACE_KINDS.momentum, id: employment.id };
  ctx.recordTrace(traceRef, ctx.date, result);
  ctx.publish('momentum.changed', {
    ...employmentChange(employment, args.source, args.reason),
    before,
    after: result.value,
  });
  return { changed: true, before, after: result.value, traceRef };
}

// ---------------------------------------------------------------------------------------------
// Morale

export interface ApplyMoraleChangeArgs {
  employmentId: EmploymentId;
  /** Points to add; negative to take away. A traced delta is kept in the trace. */
  delta: number | Traced<number>;
  source: DoorSource;
  reason: DoorReason;
}

/**
 * Adds to a worker's morale and keeps it between -100 and 100. The door applies the delta it is
 * given and nothing else: it never works out how a result should feel.
 */
export function applyMoraleChange(
  ctx: DoorContext,
  args: ApplyMoraleChangeArgs,
): DoorResult<number> {
  const employment = requireOpenEmployment(ctx.read, 'applyMoraleChange', args.employmentId);
  requireReason('applyMoraleChange', args.reason);
  const before = employment.morale;
  const result = startCalc('Morale', before, {
    unit: 'points',
    docRef: MORALE_DOC_REF,
    startLabel: 'Morale before',
  })
    .add(args.reason.label, args.delta)
    .clamp(SIGNED_SCALE_MIN, SIGNED_SCALE_MAX)
    .done();
  if (before === result.value) {
    return unchanged(before);
  }
  ctx.tx.update('employments', employment.id, { morale: result.value });
  const traceRef: TraceRef = { kind: DOOR_TRACE_KINDS.morale, id: employment.id };
  ctx.recordTrace(traceRef, ctx.date, result);
  ctx.publish('morale.changed', {
    ...employmentChange(employment, args.source, args.reason),
    before,
    after: result.value,
  });
  return { changed: true, before, after: result.value, traceRef };
}
