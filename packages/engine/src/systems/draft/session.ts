/**
 * A draft at work inside one command: the board loaded from the saved rows, picks made through
 * it, and the draft row written back once at the end.
 *
 * Every command loads the board fresh from the world (the pool is everyone the draft could still
 * take, the rosters are the picks so far), so a save made mid-draft resumes exactly: nothing lives
 * outside the `drafts` and `draftPicks` rows and the contracts the picks signed.
 *
 * Design: docs/design/draft.md#commands.
 */

import { addDays, type GameDate } from '../../core/date';
import { cents } from '../../core/money';
import type { EmploymentId, PersonId, PromotionId } from '../../core/ids';
import type { PhaseContext } from '../../core/pipeline/context';
import type { Draft, DraftPick, DraftPickSource } from '../../model/entities/draft';
import { promotionStatusKey, type ContractTerms, type Push } from '../../model/entities/employment';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { asCost } from '../finance/phases';
import { postMoney } from '../finance/post';
import type { EngineTunables } from '../tunables';
import { boardWeights, DraftBoard, emptyRoster, countOnRoster, type PickChoice } from './board';
import { draftCandidates, type DraftCandidate } from './candidates';
import { nextTurn, type Turn } from './order';
import { DraftPricer, seasonContractEnd, type PickPrice } from './pricing';
import { draftReserve } from './reserve';
import { seasonCostTrace } from './seasonCost';

export { seasonContractEnd } from './pricing';

/** The draft that is not finished yet (there is at most one), or null. */
export function openDraft(read: GameWorldView): DeepReadonly<Draft> | null {
  const running = read.tables.drafts.lookup('byStatus', 'running')[0];
  if (running !== undefined) {
    return running;
  }
  return read.tables.drafts.lookup('byStatus', 'complete')[0] ?? null;
}

/** The newest draft of any status, or null in a game without one. */
export function latestDraft(read: GameWorldView): DeepReadonly<Draft> | null {
  let latest: DeepReadonly<Draft> | null = null;
  for (const draft of read.tables.drafts.values()) {
    if (latest === null || draft.createdOn >= latest.createdOn) {
      latest = draft;
    }
  }
  return latest;
}

/** Every pick of a draft, in pick order. */
export function picksOf(read: GameWorldView, draftId: Draft['id']): DeepReadonly<DraftPick>[] {
  return [...read.tables.draftPicks.lookup('byDraft', draftId)].sort(
    (left, right) => left.number - right.number,
  );
}

/** True when the person was drafted and not released: on a roster, signed or reserved. */
function isHeld(pick: DeepReadonly<DraftPick>): boolean {
  return pick.status !== 'released';
}

/** The board of a draft as it stands: pool, rosters and targets. */
export interface LoadedDraft {
  readonly draft: DeepReadonly<Draft>;
  readonly board: DraftBoard;
  readonly picks: DeepReadonly<DraftPick>[];
  /** Candidate rows of everyone drafted and held, for roster views. */
  readonly drafted: ReadonlyMap<PersonId, DraftCandidate>;
}

export function loadDraft(
  read: GameWorldView,
  tunables: EngineTunables,
  draft: DeepReadonly<Draft>,
  date: GameDate,
): LoadedDraft {
  const picks = picksOf(read, draft.id);
  const held = new Set<string>(picks.filter(isHeld).map((pick) => pick.personId));
  const sitOut = new Set<string>(draft.sitOut);
  const pool = draftCandidates(read, tunables, {
    date,
    draftStaff: draft.settings.draftStaff,
    onlyUnsigned: true,
  }).filter((candidate) => !held.has(candidate.personId) && !sitOut.has(candidate.personId));
  const board = new DraftBoard(
    pool,
    { rosterTarget: draft.settings.rosterTarget, staffTarget: draft.settings.staffTarget },
    boardWeights(tunables),
  );
  for (const promotionId of draft.order) {
    board.addRoster(emptyRoster(read, promotionId));
  }
  for (const promotionId of draft.outOfMoney) {
    board.close(promotionId);
  }
  const heldPicks = picks.filter(isHeld);
  const drafted = new Map<PersonId, DraftCandidate>();
  if (heldPicks.length > 0) {
    const rows = draftCandidates(read, tunables, {
      date,
      draftStaff: true,
      onlyUnsigned: false,
      only: new Set(heldPicks.map((pick) => pick.personId)),
    });
    for (const row of rows) {
      drafted.set(row.personId, row);
    }
    for (const pick of heldPicks) {
      const row = drafted.get(pick.personId);
      const roster = board.roster(pick.promotionId);
      if (row !== undefined && roster !== undefined) {
        // Count them in the category they were drafted for.
        countOnRoster(roster, { ...row, category: pick.category, role: pick.role });
      }
    }
  }
  return { draft, board, picks, drafted };
}

/** The draft's next turn, or null when it is complete. */
export function currentTurn(
  loaded: LoadedDraft,
  seed: string,
  orders?: Map<number, readonly PromotionId[]>,
): Turn | null {
  return nextTurn(loaded.draft, loaded.draft.turn, seed, (id) => loaded.board.needs(id), orders);
}

/** The contract a pick signs: its terms and push, and whether its season is paid up front. */
export interface PickTerms {
  readonly terms: ContractTerms;
  readonly expectedPush: Push;
  /** True when the season was paid at the pick: payroll and show costs skip it until it ends. */
  readonly prepaid: boolean;
}

/**
 * Signs a pick to a one-season contract on `contract`'s terms (the existing contract code priced
 * them for this promotion: kind, exclusivity, wage, fee, perks; no signing bonus). Written
 * directly, like new-game setup, because nobody has worked a day yet.
 */
export function signAtAsk(
  ctx: Pick<PhaseContext, 'tx' | 'read' | 'date'>,
  promotionId: PromotionId,
  candidate: Pick<DraftCandidate, 'personId' | 'role' | 'heel'>,
  contract: PickTerms,
): EmploymentId {
  const { read, date } = ctx;
  const person = read.tables.people.require(candidate.personId);
  const endsOn = seasonContractEnd(read, date);
  const employment = ctx.tx.create('employments', {
    personId: candidate.personId,
    promotionId,
    brandId: null,
    managerPersonId: null,
    status: 'active',
    offeredOn: date,
    startsOn: date,
    endsOn,
    endedOn: null,
    role: candidate.role,
    ringName: person.defaultRingName,
    gimmickKey: null,
    alignment: candidate.heel ? 'heel' : 'face',
    push: candidate.role === 'wrestler' ? contract.expectedPush : 'none',
    terms: { ...contract.terms },
    morale: 0,
    momentum: null,
    appearancesThisYear: 0,
    lastAppearanceOn: null,
    leave: null,
    prepaidUntil: contract.prepaid ? endsOn : null,
  });
  return employment.id;
}

/**
 * Pays a pick's season up front (DRF-10): one Wages row through `postMoney`, with the season
 * cost's Why?. Nothing is posted for a free contract.
 */
export function paySeason(
  ctx: PhaseContext,
  promotionId: PromotionId,
  personId: PersonId,
  price: PickPrice,
): void {
  if (price.cost.total <= 0) {
    return;
  }
  const name = ctx.read.tables.people.require(personId).defaultRingName;
  const memo = `Season contract: ${name}`.slice(0, 120);
  const trace = asCost(memo, seasonCostTrace('Season contract cost', price.inputs, price.cost));
  postMoney(ctx, {
    promotionId,
    category: 'wages',
    amount: cents(trace.value),
    memo,
    refs: { personId },
    trace,
  });
}

/** A draft being worked on by one command. */
export class DraftRun {
  readonly #ctx: PhaseContext;
  readonly #loaded: LoadedDraft;
  readonly #seed: string;
  readonly #orders = new Map<number, readonly PromotionId[]>();
  readonly #pricer: DraftPricer;
  /** Picks are paid up front (the default): nobody may pick what they cannot pay for. */
  readonly #payUpFront: boolean;
  readonly #cash = new Map<PromotionId, number>();
  readonly #reserves = new Map<PromotionId, number>();
  readonly #outOfMoney: Set<PromotionId>;
  #turn: number;
  #picks: number;
  /** The last affordable choice worked out, for whoever was on the clock at `#version`. */
  #choice: { promotionId: PromotionId; version: number; choice: PickChoice | null } | null = null;
  #version = 0;
  /** Picks made by this run, in order. */
  readonly made: DeepReadonly<DraftPick>[] = [];

  constructor(ctx: PhaseContext, loaded: LoadedDraft) {
    this.#ctx = ctx;
    this.#loaded = loaded;
    this.#seed = ctx.read.meta.seed;
    this.#turn = loaded.draft.turn;
    this.#picks = loaded.draft.picks;
    this.#pricer = new DraftPricer(ctx.read, ctx.tunables, ctx.date);
    this.#payUpFront = !loaded.draft.settings.negotiateAfter;
    this.#outOfMoney = new Set(loaded.draft.outOfMoney);
  }

  get board(): DraftBoard {
    return this.#loaded.board;
  }

  get pricer(): DraftPricer {
    return this.#pricer;
  }

  /** The promotion's cash as this run has spent it. */
  cashOf(promotionId: PromotionId): number {
    let cash = this.#cash.get(promotionId);
    if (cash === undefined) {
      cash = this.#ctx.read.tables.promotions.require(promotionId).cash;
      this.#cash.set(promotionId, cash);
    }
    return cash;
  }

  /**
   * The cash a rival keeps while drafting (DRF-11): `draft.ai.reserveMonths` of its running costs
   * for a full roster. 0 for a player, who is only kept from going below zero.
   */
  reserveOf(promotionId: PromotionId): number {
    let reserve = this.#reserves.get(promotionId);
    if (reserve === undefined) {
      const read = this.#ctx.read;
      if (isHumanPromotion(read, promotionId)) {
        reserve = 0;
      } else {
        const { settings } = this.#loaded.draft;
        const roster = this.board.roster(promotionId);
        const kept = read.tables.employments.lookup(
          'byPromotionStatus',
          promotionStatusKey(promotionId, 'active'),
        ).length;
        const toCome =
          Math.max(0, settings.rosterTarget - (roster?.wrestlers ?? 0)) +
          Math.max(0, settings.staffTarget - (roster?.staff ?? 0));
        reserve = draftReserve(
          read,
          this.#ctx.tunables,
          promotionId,
          this.#ctx.date,
          kept + toCome,
        );
      }
      this.#reserves.set(promotionId, reserve);
    }
    return reserve;
  }

  /**
   * True when the promotion can pay for this pick now: always when nothing is paid up front; else
   * a player while it leaves them at zero or more, a rival while it leaves its reserve.
   */
  canAfford(promotionId: PromotionId, candidate: Pick<DraftCandidate, 'personId'>): boolean {
    return (
      !this.#payUpFront ||
      this.#pricer.price(promotionId, candidate.personId).cost.total <=
        this.cashOf(promotionId) - this.reserveOf(promotionId)
    );
  }

  /** The best pick the promotion can afford, or null when there is none. */
  #choiceFor(promotionId: PromotionId): PickChoice | null {
    const known = this.#choice;
    if (known !== null && known.promotionId === promotionId && known.version === this.#version) {
      return known.choice;
    }
    const choice = this.#payUpFront
      ? this.board.bestFor(promotionId, (candidate) => this.canAfford(promotionId, candidate))
      : this.board.bestFor(promotionId);
    this.#choice = { promotionId, version: this.#version, choice };
    return choice;
  }

  /** Ends a promotion's turns: it cannot afford anyone left in the pool. */
  #markOutOfMoney(promotionId: PromotionId): void {
    this.board.close(promotionId);
    this.#outOfMoney.add(promotionId);
    this.#version += 1;
    this.#ctx.log(`Draft: ${promotionId} cannot afford anyone left, its turns end`);
  }

  /**
   * Who is on the clock, or null when the draft is complete. A promotion that cannot afford
   * anyone it still wants is passed over for good.
   */
  turn(): Turn | null {
    for (;;) {
      const turn = nextTurn(
        this.#loaded.draft,
        this.#turn,
        this.#seed,
        (id) => this.#loaded.board.needs(id),
        this.#orders,
      );
      if (turn === null || !this.#payUpFront || this.#choiceFor(turn.promotionId) !== null) {
        return turn;
      }
      this.#markOutOfMoney(turn.promotionId);
    }
  }

  /** Makes the pick for the promotion on the clock. The caller checked the choice. */
  pick(turn: Turn, candidate: DraftCandidate, source: DraftPickSource): DeepReadonly<DraftPick> {
    const ctx = this.#ctx;
    const { draft } = this.#loaded;
    const signNow = !draft.settings.negotiateAfter;
    let employmentId: EmploymentId | null = null;
    let paid: number | null = null;
    if (signNow) {
      const price = this.#pricer.price(turn.promotionId, candidate.personId);
      const cashBefore = this.cashOf(turn.promotionId);
      employmentId = signAtAsk(ctx, turn.promotionId, candidate, {
        terms: price.terms,
        expectedPush: price.expectedPush,
        prepaid: true,
      });
      paySeason(ctx, turn.promotionId, candidate.personId, price);
      paid = price.cost.total;
      this.#cash.set(turn.promotionId, cashBefore - price.cost.total);
    }
    this.#picks += 1;
    const row = ctx.tx.create('draftPicks', {
      draftId: draft.id,
      number: this.#picks,
      round: turn.round + 1,
      promotionId: turn.promotionId,
      personId: candidate.personId,
      category: candidate.category,
      role: candidate.role,
      source,
      value: Math.round(candidate.value * 10) / 10,
      status: signNow ? 'signed' : 'reserved',
      employmentId,
      reservedUntil: signNow ? null : addDays(ctx.date, ctx.tunables.get('draft.reserveDays')),
      pickedOn: ctx.date,
      cost: paid === null ? null : cents(paid),
    });
    this.#loaded.board.take(turn.promotionId, candidate);
    this.#version += 1;
    this.#turn = turn.turn + 1;
    this.made.push(row);
    return row;
  }

  /** Passes a turn without a pick. */
  skip(turn: Turn): void {
    this.#turn = turn.turn + 1;
  }

  /** The computer's pick for whoever is on the clock: the best they can afford. */
  autoPick(turn: Turn, source: DraftPickSource): DeepReadonly<DraftPick> | null {
    const choice = this.#choiceFor(turn.promotionId);
    if (choice === null) {
      return null;
    }
    return this.pick(turn, choice.candidate, source);
  }

  /**
   * Picks for the computer until `stop` says to stop at a turn, or the draft is complete. Players'
   * turns are picked too when `pickForPlayers` is true (marked `auto`).
   */
  runUntil(stop: (turn: Turn) => boolean, pickForPlayers: boolean): Turn | null {
    for (;;) {
      const turn = this.turn();
      if (turn === null || stop(turn)) {
        return turn;
      }
      const human = isHumanPromotion(this.#ctx.read, turn.promotionId);
      if (human && !pickForPlayers) {
        return turn;
      }
      if (this.autoPick(turn, human ? 'auto' : 'computer') === null) {
        // Nothing left this promotion can use: move on.
        this.skip(turn);
      }
    }
  }

  /**
   * Ends the turns of every player's promotion that can no longer afford anyone it wants, so the
   * draft room shows them done at once (a rival's are ended when its turn comes round).
   */
  #closeBrokePlayers(): void {
    if (!this.#payUpFront) {
      return;
    }
    for (const promotionId of this.#loaded.draft.order) {
      if (
        !this.#outOfMoney.has(promotionId) &&
        isHumanPromotion(this.#ctx.read, promotionId) &&
        this.board.needs(promotionId) &&
        this.#choiceFor(promotionId) === null
      ) {
        this.#markOutOfMoney(promotionId);
      }
    }
  }

  /** Writes the turn and pick count back, and the status when the draft is complete. */
  save(): DeepReadonly<Draft> {
    this.#closeBrokePlayers();
    const complete = this.turn() === null;
    const { draft } = this.#loaded;
    return this.#ctx.tx.update('drafts', draft.id, {
      turn: this.#turn,
      picks: this.#picks,
      poolLeft: { wrestlers: this.board.wrestlersLeft, staff: this.board.staffLeft },
      status: complete ? 'complete' : 'running',
      outOfMoney: draft.order.filter((id) => this.#outOfMoney.has(id)),
    });
  }
}

/** True when a human controls this promotion. */
export function isHumanPromotion(read: GameWorldView, promotionId: PromotionId): boolean {
  return read.tables.promotions.get(promotionId)?.controller.kind === 'human';
}
