/**
 * The negotiation registries (ECO5-01): the seams later features plug into without editing this
 * system.
 *
 * - Offer kinds (`registerOfferKind`): which contract kinds a promotion may offer and what each
 *   adds. Built in: `written` (needs a reach of `contracts.kind.writtenMinReach`) and
 *   `perAppearance` (always). ECO11 (development deals) and ECO12 (tours) add theirs, with their own
 *   fields in the offer's `extra`.
 * - Enforced terms (`registerEnforcedTerm`): which perks and revenue shares the game actually
 *   honours, so the offer screen can say when a term is only words on paper. Built in:
 *   `perk.travelCovered` (show costs) and `perk.ironClad` (severance and walk-outs).
 * - Ask and patience modifiers (`registerAskModifier`, `registerPatienceModifier`): extra lines on
 *   a worker's asking terms and patience. SOC4's rapport is the first user.
 *
 * Module-level, like `registerSetupStep` (`systems/newgame/steps.ts`): a system registers at module
 * load and tests remove what they added. Each registry has a `clear…ForTests()` that empties it and
 * returns a function putting everything back.
 *
 * Design: docs/design/negotiation.md#offer-kinds and #enforced-terms.
 */

import type { ZodType } from 'zod';
import type { Reason } from '../../core/api/result';
import type { GameDate } from '../../core/date';
import { RegistryError } from '../../core/errors';
import type { EmploymentId, PersonId, PromotionId } from '../../core/ids';
import { PHASE_ID_PATTERN } from '../../core/pipeline/phase';
import type { Traced } from '../../core/trace/types';
import { CONTRACT_KINDS, type ContractKind } from '../../model/entities/employment';
import type { GameWorldView } from '../../model/tables';
import type { DoorContext } from '../workers/doors';
import type { EngineTunables } from '../tunables';
import type { OfferExtra } from './offer';

// ---------------------------------------------------------------------------------------------
// Shared registry plumbing
// ---------------------------------------------------------------------------------------------

/** Compares two entries by `order`, then by their key. */
function byOrderThenKey<Entry>(
  orderOf: (entry: Entry) => number,
  keyOf: (entry: Entry) => string,
): (left: Entry, right: Entry) => number {
  return (left, right) => {
    const order = orderOf(left) - orderOf(right);
    if (order !== 0) {
      return order;
    }
    const leftKey = keyOf(left);
    const rightKey = keyOf(right);
    return leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1;
  };
}

/** A keyed registry: add (refusing a taken key), list in order, clear for a test. */
class Registry<Entry> {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly name: string,
    private readonly keyOf: (entry: Entry) => string,
    private readonly compare: (left: Entry, right: Entry) => number,
  ) {}

  register(entry: Entry): () => void {
    const key = this.keyOf(entry);
    if (this.entries.has(key)) {
      throw new RegistryError(`${this.name} "${key}": one with this key is already registered`, {
        key,
      });
    }
    const stored = { ...entry };
    this.entries.set(key, stored);
    return () => {
      if (this.entries.get(key) === stored) {
        this.entries.delete(key);
      }
    };
  }

  list(): Entry[] {
    return [...this.entries.values()].sort(this.compare);
  }

  get(key: string): Entry | undefined {
    return this.entries.get(key);
  }

  clearForTests(): () => void {
    const saved = [...this.entries];
    this.entries.clear();
    return () => {
      this.entries.clear();
      for (const [key, entry] of saved) {
        this.entries.set(key, entry);
      }
    };
  }
}

function assertOrder(what: string, key: string, order: number): void {
  if (!Number.isFinite(order)) {
    throw new RegistryError(`${what} "${key}": the order must be a finite number`, { key });
  }
}

// ---------------------------------------------------------------------------------------------
// Offer kinds
// ---------------------------------------------------------------------------------------------

/** A contract kind a promotion can offer, and what it needs and adds. */
export interface OfferKindSpec {
  readonly key: ContractKind;
  /** Shown to the player, for example "Written contract". */
  readonly label: string;
  /** Lower is listed first; equal orders by key. */
  readonly order: number;
  /**
   * Why this promotion may not offer this kind to this person today; an empty list means it may.
   * Messages are shown to the player as they are.
   */
  readonly available: (
    read: GameWorldView,
    promotionId: PromotionId,
    personId: PersonId,
    date: GameDate,
    tunables: EngineTunables,
  ) => Reason[];
  /**
   * True when `available` depends only on the promotion and the date, never on the person, so a
   * list of many workers asks it once (ECO5-02's `contracts.freeAgents`). Left out: false.
   */
  readonly samePerWorker?: boolean;
  /** Scales the worker's asking terms for this kind (ECO5-02). Left out: 1. */
  readonly askMultiplier?: (
    read: GameWorldView,
    promotionId: PromotionId,
    personId: PersonId,
    tunables: EngineTunables,
  ) => Traced<number>;
  /** Checks the kind's own fields in the offer's `extra`. Left out: `extra` must be empty. */
  readonly extraSchema?: ZodType;
  /** Runs inside the signing step after the employment is signed (ECO5-04). */
  readonly onSigned?: (ctx: DoorContext, employmentId: EmploymentId, extra: OfferExtra) => void;
}

const offerKinds = new Registry<OfferKindSpec>(
  'Offer kind',
  (kind) => kind.key,
  byOrderThenKey(
    (kind) => kind.order,
    (kind) => kind.key,
  ),
);

/**
 * Adds an offer kind. Returns a function that removes it again (for tests).
 *
 * @throws RegistryError for a key that is not a contract kind, an order that is not a finite
 *   number, or a key that is already registered.
 */
export function registerOfferKind(spec: OfferKindSpec): () => void {
  if (!CONTRACT_KINDS.includes(spec.key)) {
    throw new RegistryError(`Offer kind "${spec.key}": the key must be a contract kind`, {
      key: spec.key,
    });
  }
  assertOrder('Offer kind', spec.key, spec.order);
  return offerKinds.register(spec);
}

/** Every registered offer kind, by `order` then key. */
export function listOfferKinds(): OfferKindSpec[] {
  return offerKinds.list();
}

/** The registered offer kind with this key, or undefined. */
export function offerKind(key: ContractKind): OfferKindSpec | undefined {
  return offerKinds.get(key);
}

/** Empties the offer kinds, built-ins included; the returned function puts them back. */
export function clearOfferKindsForTests(): () => void {
  return offerKinds.clearForTests();
}

// ---------------------------------------------------------------------------------------------
// Enforced terms
// ---------------------------------------------------------------------------------------------

/** The perks and revenue shares a contract can carry, as enforced-term keys. */
export const ENFORCEABLE_TERMS = [
  'perk.ironClad',
  'perk.travelCovered',
  'perk.noHouseShows',
  'perk.creativeControl',
  'share.gateBp',
  'share.merchBp',
  'share.broadcastBp',
] as const;
export type EnforceableTerm = (typeof ENFORCEABLE_TERMS)[number];

/** A term the game honours, and where. */
export interface EnforcedTermSpec {
  readonly term: EnforceableTerm;
  /** Shown to the player, for example "Travel covered". */
  readonly label: string;
  /** Where the game honours it, in plain words, for example "Show costs". */
  readonly enforcedBy: string;
}

const enforcedTerms = new Registry<EnforcedTermSpec>(
  'Enforced term',
  (spec) => spec.term,
  byOrderThenKey(
    (spec) => ENFORCEABLE_TERMS.indexOf(spec.term),
    (spec) => spec.term,
  ),
);

/**
 * Records that the game honours a term. Returns a function that removes it again (for tests).
 *
 * @throws RegistryError for an unknown term or one that is already registered.
 */
export function registerEnforcedTerm(spec: EnforcedTermSpec): () => void {
  if (!ENFORCEABLE_TERMS.includes(spec.term)) {
    throw new RegistryError(`Enforced term "${spec.term}": not a perk or share of a contract`, {
      key: spec.term,
    });
  }
  return enforcedTerms.register(spec);
}

/** Every enforced term, in the order of {@link ENFORCEABLE_TERMS}. */
export function listEnforcedTerms(): EnforcedTermSpec[] {
  return enforcedTerms.list();
}

/** True when the game honours this term somewhere. */
export function isTermEnforced(term: EnforceableTerm): boolean {
  return enforcedTerms.get(term) !== undefined;
}

/** Empties the enforced terms, built-ins included; the returned function puts them back. */
export function clearEnforcedTermsForTests(): () => void {
  return enforcedTerms.clearForTests();
}

// ---------------------------------------------------------------------------------------------
// Ask and patience modifiers
// ---------------------------------------------------------------------------------------------

/** An extra line on a worker's asking terms or patience. */
export interface NegotiationModifier {
  /** `system.camelName`, for example `social.rapport`. */
  readonly id: string;
  /** Lower applies first; equal orders by id. */
  readonly order: number;
  /** Shown in the Why?, for example "Rapport with your booker". */
  readonly label: string;
  /** The modifier for this worker and promotion today, or null when it does not apply. */
  readonly compute: (
    read: GameWorldView,
    personId: PersonId,
    promotionId: PromotionId,
    date: GameDate,
    tunables: EngineTunables,
  ) => Traced<number> | null;
}

function modifierRegistry(name: string): Registry<NegotiationModifier> {
  return new Registry<NegotiationModifier>(
    name,
    (modifier) => modifier.id,
    byOrderThenKey(
      (modifier) => modifier.order,
      (modifier) => modifier.id,
    ),
  );
}

function checkModifier(what: string, modifier: NegotiationModifier): void {
  if (!PHASE_ID_PATTERN.test(modifier.id)) {
    throw new RegistryError(
      `${what} "${modifier.id}": the id must look like "system.camelName", for example "social.rapport"`,
      { key: modifier.id },
    );
  }
  assertOrder(what, modifier.id, modifier.order);
}

const askModifiers = modifierRegistry('Ask modifier');
const patienceModifiers = modifierRegistry('Patience modifier');

/**
 * Adds a modifier to every worker's asking terms (ECO5-02 applies them). Returns a function that
 * removes it again.
 *
 * @throws RegistryError for a malformed id, an order that is not finite, or a taken id.
 */
export function registerAskModifier(modifier: NegotiationModifier): () => void {
  checkModifier('Ask modifier', modifier);
  return askModifiers.register(modifier);
}

/** Every ask modifier, by `order` then id. */
export function listAskModifiers(): NegotiationModifier[] {
  return askModifiers.list();
}

/** Empties the ask modifiers; the returned function puts them back. */
export function clearAskModifiersForTests(): () => void {
  return askModifiers.clearForTests();
}

/**
 * Adds a modifier to every worker's patience (ECO5-03 applies them). Returns a function that
 * removes it again.
 *
 * @throws RegistryError for a malformed id, an order that is not finite, or a taken id.
 */
export function registerPatienceModifier(modifier: NegotiationModifier): () => void {
  checkModifier('Patience modifier', modifier);
  return patienceModifiers.register(modifier);
}

/** Every patience modifier, by `order` then id. */
export function listPatienceModifiers(): NegotiationModifier[] {
  return patienceModifiers.list();
}

/** Empties the patience modifiers; the returned function puts them back. */
export function clearPatienceModifiersForTests(): () => void {
  return patienceModifiers.clearForTests();
}
