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
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { askingContext, askingTermsWith, type AskingContext } from '../negotiation/asking';
import { negotiationEligibility } from '../negotiation/eligibility';
import { askTermsOf } from '../negotiation/evaluate';
import type { EngineTunables } from '../tunables';
import { boardWeights, DraftBoard, emptyRoster, countOnRoster } from './board';
import { draftCandidates, type DraftCandidate } from './candidates';
import { nextTurn, type Turn } from './order';

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

/** The first day after the season the draft starts in: when a contract signed at the pick ends. */
export function seasonContractEnd(read: GameWorldView, date: GameDate): GameDate {
  const season = read.tables.seasons.lookup('activeSeason', 'active')[0];
  if (season !== undefined && season.endDate >= date) {
    return addDays(season.endDate, 1);
  }
  return addDays(date, read.meta.settings.season.lengthDays);
}

/**
 * Signs a pick to a contract at their ask: the existing contract code prices it for this promotion
 * (kind, exclusivity, wage, fee, perks), for one season, with no signing bonus. Written directly,
 * like new-game setup, because nobody has worked a day yet.
 */
export function signAtAsk(
  ctx: Pick<PhaseContext, 'tx' | 'read' | 'date'>,
  tunables: EngineTunables,
  contexts: Map<PromotionId, AskingContext>,
  promotionId: PromotionId,
  candidate: Pick<DraftCandidate, 'personId' | 'role' | 'heel'>,
): EmploymentId {
  const { read, date } = ctx;
  let context = contexts.get(promotionId);
  if (context === undefined) {
    context = askingContext(read, tunables, promotionId, date);
    contexts.set(promotionId, context);
  }
  const eligibility = negotiationEligibility(read, tunables, candidate.personId, promotionId, date);
  const ask = askingTermsWith(context, { personId: candidate.personId }, eligibility);
  const terms = { ...askTermsOf(ask), signingBonus: cents(0) };
  const person = read.tables.people.require(candidate.personId);
  const employment = ctx.tx.create('employments', {
    personId: candidate.personId,
    promotionId,
    brandId: null,
    managerPersonId: null,
    status: 'active',
    offeredOn: date,
    startsOn: date,
    endsOn: seasonContractEnd(read, date),
    endedOn: null,
    role: candidate.role,
    ringName: person.defaultRingName,
    gimmickKey: null,
    alignment: candidate.heel ? 'heel' : 'face',
    push: candidate.role === 'wrestler' ? ask.expectedPush.value : 'none',
    terms,
    morale: 0,
    momentum: null,
    appearancesThisYear: 0,
    lastAppearanceOn: null,
    leave: null,
  });
  return employment.id;
}

/** A draft being worked on by one command. */
export class DraftRun {
  readonly #ctx: PhaseContext;
  readonly #tunables: EngineTunables;
  readonly #loaded: LoadedDraft;
  readonly #seed: string;
  readonly #orders = new Map<number, readonly PromotionId[]>();
  readonly #askContexts = new Map<PromotionId, AskingContext>();
  #turn: number;
  #picks: number;
  /** Picks made by this run, in order. */
  readonly made: DeepReadonly<DraftPick>[] = [];

  constructor(ctx: PhaseContext, loaded: LoadedDraft) {
    this.#ctx = ctx;
    this.#tunables = ctx.tunables;
    this.#loaded = loaded;
    this.#seed = ctx.read.meta.seed;
    this.#turn = loaded.draft.turn;
    this.#picks = loaded.draft.picks;
  }

  get board(): DraftBoard {
    return this.#loaded.board;
  }

  /** Who is on the clock, or null when the draft is complete. */
  turn(): Turn | null {
    return nextTurn(
      this.#loaded.draft,
      this.#turn,
      this.#seed,
      (id) => this.#loaded.board.needs(id),
      this.#orders,
    );
  }

  /** Makes the pick for the promotion on the clock. The caller checked the choice. */
  pick(turn: Turn, candidate: DraftCandidate, source: DraftPickSource): DeepReadonly<DraftPick> {
    const ctx = this.#ctx;
    const { draft } = this.#loaded;
    const signNow = !draft.settings.negotiateAfter;
    const employmentId = signNow
      ? signAtAsk(ctx, this.#tunables, this.#askContexts, turn.promotionId, candidate)
      : null;
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
      reservedUntil: signNow ? null : addDays(ctx.date, this.#tunables.get('draft.reserveDays')),
      pickedOn: ctx.date,
    });
    this.#loaded.board.take(turn.promotionId, candidate);
    this.#turn = turn.turn + 1;
    this.made.push(row);
    return row;
  }

  /** Passes a turn without a pick. */
  skip(turn: Turn): void {
    this.#turn = turn.turn + 1;
  }

  /** The computer's pick for whoever is on the clock. */
  autoPick(turn: Turn, source: DraftPickSource): DeepReadonly<DraftPick> | null {
    const choice = this.#loaded.board.bestFor(turn.promotionId);
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

  /** Writes the turn and pick count back, and the status when the draft is complete. */
  save(): DeepReadonly<Draft> {
    const complete = this.turn() === null;
    const { draft } = this.#loaded;
    return this.#ctx.tx.update('drafts', draft.id, {
      turn: this.#turn,
      picks: this.#picks,
      poolLeft: { wrestlers: this.board.wrestlersLeft, staff: this.board.staffLeft },
      status: complete ? 'complete' : 'running',
    });
  }
}

/** True when a human controls this promotion. */
export function isHumanPromotion(read: GameWorldView, promotionId: PromotionId): boolean {
  return read.tables.promotions.get(promotionId)?.controller.kind === 'human';
}
