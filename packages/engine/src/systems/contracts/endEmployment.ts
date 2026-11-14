/**
 * `endEmployment`: the one door every contract ending goes through.
 *
 * Contracts that run out (`contracts.lifecycle`), releases (ECO4-02), quits and walk-outs (ECO4-03),
 * and later budget cuts and closures (ECO9) and conduct releases (SOC6) all end a contract here, so
 * every ending does the same things:
 *
 * 1. checks the move is a legal lifecycle transition (`canTransition`), and throws
 *    `InvalidArgumentError` otherwise, which rolls the caller's step back;
 * 2. writes the new status and `endedOn` = the step's date;
 * 3. clears the manager link on every other signed or active contract of the same promotion that
 *    names this person as its manager;
 * 4. clears the contract's expiry notice, unhappy clock and release request, and writes how it
 *    ended on its `contractConcerns` row (creating the row when needed);
 * 5. when severance rounds to more than 0 cents, records its trace at `contracts.severance` / the
 *    employment and pays it through `postMoney` (category `severance`);
 * 6. publishes exactly one event: `contract.expired`, `contract.released` (also for a withdrawn
 *    future deal, with `mutual: false`) or `contract.quit`.
 *
 * Contract dates: `startsOn` is the first day under contract and `endsOn` is the first day not
 * under contract. A contract ending today is not on today's show and is not paid today.
 *
 * Titles, teams and storylines react to the events in their own features. Design:
 * docs/design/contracts.md#end-employment.
 */

import { isAfter } from '../../core/date';
import { InvalidArgumentError } from '../../core/errors';
import type { EmploymentId, LedgerEntryId } from '../../core/ids';
import { cents, type Cents } from '../../core/money';
import { startCalc } from '../../core/trace/calc';
import type { Traced } from '../../core/trace/types';
import type { TraceRef } from '../../core/trace/store';
import type { ContractEndingHow } from '../../model/entities/contract-concern';
import {
  canTransition,
  promotionStatusKey,
  type EmploymentStatus,
} from '../../model/entities/employment';
import { postMoney } from '../finance/post';
import { closeTalksOnEndedContract } from '../negotiation/endedTalks';
import type { DoorContext } from '../workers/doors';
import type { DoorSource } from '../workers/events';
import type { ContractQuitHow } from './events';
import { severanceTraceRef } from './traceKinds';

const DOOR = 'endEmployment';

export const END_EMPLOYMENT_DOC_REF = 'contracts.md#end-employment';
export const SEVERANCE_DOC_REF = 'contracts.md#severance';

/** The statuses a contract can end in through this door. */
export type EndEmploymentTo = 'expired' | 'released' | 'quit' | 'withdrawn';

const END_TO: readonly EndEmploymentTo[] = ['expired', 'released', 'quit', 'withdrawn'];
const QUIT_HOWS: readonly ContractQuitHow[] = ['granted', 'walkedOut', 'exclusiveDeal'];

export interface EndEmploymentArgs {
  readonly employmentId: EmploymentId;
  readonly to: EndEmploymentTo;
  /** A stable key for listeners and news, such as `contracts.endDate`. */
  readonly reasonKey: string;
  readonly source: DoorSource;
  /** How a worker quit. Required when `to` is `quit`, ignored otherwise. */
  readonly how?: ContractQuitHow;
  /** True for a release both sides agreed to. Only read for `released`. */
  readonly mutual?: boolean;
  /** The severance owed, in cents, with how it was worked out. Null or left out: none. */
  readonly severance?: Traced<number> | null;
  /** The ledger memo for the severance row. Defaults to "Severance: <ring name>". */
  readonly memo?: string;
}

export interface EndEmploymentResult {
  /** The severance paid, in whole cents (0 when none). */
  readonly severance: number;
  /** Where the severance trace is stored, or null when nothing was paid. */
  readonly traceRef: TraceRef | null;
  /** The severance's ledger row, or null when nothing was paid (ECO4-02). */
  readonly ledgerEntryId: LedgerEntryId | null;
  /** Where that ledger row's Why? is stored, or null when nothing was paid (ECO4-02). */
  readonly ledgerTraceRef: TraceRef | null;
}

function endingHow(args: EndEmploymentArgs): ContractEndingHow {
  if (args.to !== 'quit') {
    return args.to;
  }
  if (args.how === undefined || !QUIT_HOWS.includes(args.how)) {
    throw new InvalidArgumentError(DOOR, 'how', args.how, 'granted, walkedOut or exclusiveDeal');
  }
  return args.how;
}

/** The severance in whole cents, as a calculation that ends on that number. */
function roundedSeverance(severance: Traced<number> | null | undefined): Traced<number> | null {
  if (severance === null || severance === undefined) {
    return null;
  }
  if (!Number.isFinite(severance.value) || severance.value < 0) {
    throw new InvalidArgumentError(DOOR, 'severance', severance.value, 'zero or more cents');
  }
  const rounded = startCalc('Severance', severance, {
    unit: 'money',
    docRef: SEVERANCE_DOC_REF,
  })
    .round('round', 'To whole cents')
    .done();
  return rounded.value > 0 ? rounded : null;
}

/**
 * Ends a contract. See the module comment for everything it does. Throws `InvalidArgumentError`
 * for an unknown employment, an illegal move, an expiry before the end date, a missing `how` on a
 * quit, or negative severance; a throw rolls the caller's step back.
 */
export function endEmployment(ctx: DoorContext, args: EndEmploymentArgs): EndEmploymentResult {
  const employment = ctx.read.tables.employments.get(args.employmentId);
  if (employment === undefined) {
    throw new InvalidArgumentError(
      DOOR,
      'employmentId',
      args.employmentId,
      'an existing employment',
    );
  }
  if (!END_TO.includes(args.to) || !canTransition(employment.status, args.to)) {
    throw new InvalidArgumentError(
      DOOR,
      'to',
      args.to,
      `a legal move from ${employment.status} (${describeMoves(employment.status)})`,
    );
  }
  if (args.reasonKey === '') {
    throw new InvalidArgumentError(DOOR, 'reasonKey', args.reasonKey, 'a reason key');
  }
  if (
    args.to === 'expired' &&
    (employment.endsOn === null || isAfter(employment.endsOn, ctx.date))
  ) {
    throw new InvalidArgumentError(
      DOOR,
      'to',
      args.to,
      `a contract whose end date has come (it ends on ${employment.endsOn ?? 'no date'})`,
    );
  }
  const how = endingHow(args);
  const severance = roundedSeverance(args.severance);
  const severanceCents: Cents = cents(severance?.value ?? 0);
  const { tx } = ctx;

  // (2) The contract itself.
  tx.update('employments', employment.id, { status: args.to, endedOn: ctx.date });
  // ECO5-05: open talks about it (a renewal, or the signing of a withdrawn offer) close too.
  closeTalksOnEndedContract(ctx, employment.id);

  // (3) Manager links to the leaver on the promotion's live contracts.
  for (const status of ['signed', 'active'] as const) {
    const key = promotionStatusKey(employment.promotionId, status);
    for (const other of ctx.read.tables.employments.lookup('byPromotionStatus', key)) {
      if (other.id !== employment.id && other.managerPersonId === employment.personId) {
        tx.update('employments', other.id, { managerPersonId: null });
      }
    }
  }

  // (5) Severance, before the concern row so the row can name the trace.
  let traceRef: TraceRef | null = null;
  let ledgerEntryId: LedgerEntryId | null = null;
  let ledgerTraceRef: TraceRef | null = null;
  if (severance !== null) {
    traceRef = severanceTraceRef(employment.id);
    const promotion = ctx.read.tables.promotions.get(employment.promotionId);
    const human = promotion?.controller.kind === 'human';
    ctx.recordTrace(traceRef, ctx.date, severance, { summaryOnly: !human });
    const cost = startCalc('Severance paid', 0, {
      unit: 'money',
      docRef: SEVERANCE_DOC_REF,
      startLabel: 'Nothing paid yet',
    })
      .subtract(`Severance for ${employment.ringName}`, severance)
      .done();
    const row = postMoney(ctx, {
      promotionId: employment.promotionId,
      category: 'severance',
      amount: cents(cost.value),
      memo: args.memo ?? `Severance: ${employment.ringName}`,
      refs: { personId: employment.personId },
      trace: cost,
    });
    ledgerEntryId = row.id;
    ledgerTraceRef = row.traceRef;
  }

  // (4) The concern row: only how it ended is left.
  const ending = { how, severance: severanceCents, traceRef };
  const concern = ctx.read.tables.contractConcerns.lookupOne('byEmployment', employment.id);
  if (concern === undefined) {
    tx.insert('contractConcerns', {
      id: tx.mintId('contractConcerns'),
      employmentId: employment.id,
      personId: employment.personId,
      promotionId: employment.promotionId,
      expiryNotice: null,
      unhappy: null,
      request: null,
      ending,
    });
  } else {
    tx.update('contractConcerns', concern.id, {
      expiryNotice: null,
      unhappy: null,
      request: null,
      ending,
    });
  }

  // (6) One event.
  const ref = {
    employmentId: employment.id,
    personId: employment.personId,
    promotionId: employment.promotionId,
  };
  switch (args.to) {
    case 'expired':
      ctx.publish('contract.expired', { ...ref, reasonKey: args.reasonKey });
      break;
    case 'released':
    case 'withdrawn':
      ctx.publish('contract.released', {
        ...ref,
        severance: severanceCents,
        source: args.source,
        mutual: args.to === 'released' && args.mutual === true,
      });
      break;
    case 'quit':
      ctx.publish('contract.quit', {
        ...ref,
        how: how === 'granted' || how === 'walkedOut' ? how : 'exclusiveDeal',
        severance: severanceCents,
      });
      break;
  }
  return { severance: severanceCents, traceRef, ledgerEntryId, ledgerTraceRef };
}

function describeMoves(status: EmploymentStatus): string {
  const moves = END_TO.filter((to) => canTransition(status, to));
  return moves.length === 0 ? 'none' : `allowed: ${moves.join(', ')}`;
}
