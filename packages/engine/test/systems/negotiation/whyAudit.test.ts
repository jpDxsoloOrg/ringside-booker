// ECO5-08's Why? review, kept as a test: every Why? the negotiation feature adds, on a fresh
// default-world game played as Altura, names its tunables, reads in plain words and replays to
// the number the screens show. Slow suite (it builds the default world).
// Design: docs/design/negotiation.md
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState, type Engine } from '../../../src/core/api';
import type { Controller } from '../../../src/core/api/controller';
import { cents } from '../../../src/core/money';
import type { EmploymentId, NegotiationId, PersonId, PromotionId } from '../../../src/core/ids';
import { findTraceNodes, walkTrace } from '../../../src/core/trace';
import { isFullTrace, type StoredTraceEntry, type TraceRef } from '../../../src/core/trace/store';
import type { Traced, TraceNode } from '../../../src/core/trace/types';
import { TABLES } from '../../../src/model/tables';
import { documentToWorld } from '../../../src/persistence/world-document';
import { defaultSystems } from '../../../src/systems';
import {
  askTermsOf,
  counterTraceRef,
  reactionTraceRef,
  reviewTraceRef,
  signingBonusTraceRef,
  type AskingTermsView,
  type Offer,
} from '../../../src/systems/negotiation';
import { anOffer } from '../../support';
import { withMyShowsRun } from '../../support/run-my-shows';
import { SLOW_TESTS } from '../../support/slow';
import { expectTraceReplays } from '../../support/trace';
import { startDefaultGame } from '../calendar/default-game';
import { setMorale } from './negotiation-world';

/** The player of `startDefaultGame` (Altura, the flagship). */
const PLAYER: Controller = { kind: 'human', playerId: 'local-player' };
const VIEW = { kind: 'controller', controller: PLAYER } as const;

/** Words a player should never meet in a Why?: code names and broken numbers. */
const NOT_PLAIN = /\bundefined\b|\bNaN\b|\bnull\b|\b[a-z]+[A-Z][A-Za-z]*\b|minute/u;

const NO_TRACE: TraceNode = { kind: 'note', label: '', value: null };

function done<T>(result: { ok: true; data: T } | { ok: false; reasons: unknown }): T {
  if (!result.ok) {
    throw new Error(`refused: ${JSON.stringify(result.reasons)}`);
  }
  return result.data;
}

function tunableKeys(trace: TraceNode): string[] {
  return findTraceNodes(trace, 'tunable').map((node) => node.key);
}

/** Every label (and decision reason) in the trace, which is what the Why? panel prints. */
function wordsOf(trace: TraceNode): string[] {
  const words: string[] = [];
  walkTrace(trace, (node) => {
    // A tunable's label is its description; its key is shown apart, in code style.
    words.push(node.label);
    if (node.kind === 'decision') {
      words.push(node.reason, ...node.considered.map((option) => option.reason ?? ''));
    }
    if (node.kind === 'arithmetic' || 'reason' in node) {
      const reason = (node as { reason?: unknown }).reason;
      if (typeof reason === 'string') words.push(reason);
    }
  });
  return words.filter((word) => word !== '');
}

/** A Why? that names at least one tunable matching `keys` and reads in plain words. */
function expectExplains(what: string, trace: TraceNode | null | undefined, keys: RegExp): void {
  expect(trace, `${what} has a Why?`).toBeTruthy();
  if (trace === null || trace === undefined) return;
  const named = tunableKeys(trace);
  expect(
    named.some((key) => keys.test(key)),
    `${what} names a ${String(keys)} tunable (has ${named.join(', ') || 'none'})`,
  ).toBe(true);
  const unplain = wordsOf(trace).filter((word) => NOT_PLAIN.test(word));
  expect(unplain, `${what} reads in plain words`).toEqual([]);
}

/** A numeric Why? that also replays to the number shown. */
function expectNumberExplains(what: string, traced: Traced<number>, keys: RegExp): void {
  expectTraceReplays(traced);
  expectExplains(what, traced.trace, keys);
}

function traceOf(engine: Engine, ref: TraceRef): TraceNode | null {
  const entry: StoredTraceEntry | null = done(engine.query('trace.get', { ref }, VIEW));
  // The player's own talks keep full traces, never summaries.
  return entry !== null && isFullTrace(entry) ? entry.trace : null;
}

/** Their ask as an offer, the wage scaled by `share` (and the bonus by `bonusShare`). */
function offerAt(ask: AskingTermsView, share: number, bonusShare = 1): Offer {
  const terms = askTermsOf(ask);
  return anOffer({
    lengthMonths: ask.preferredLengthMonths.value,
    push: ask.expectedPush.value === 'none' ? 'midCard' : ask.expectedPush.value,
    role: ask.role,
    terms: {
      ...terms,
      monthlyWage: cents(Math.round((terms.monthlyWage * share) / 100) * 100),
      signingBonus: cents(Math.round((terms.signingBonus * bonusShare) / 100) * 100),
    },
  });
}

interface Game {
  readonly engine: Engine;
  readonly altura: PromotionId;
  /** Altura's written contracts ending soonest: morale 0, −30 (unhappy) and −60 (won't renew). */
  readonly renewals: readonly [EmploymentId, EmploymentId, EmploymentId];
}

function freshGame(): Game {
  const state = startDefaultGame({ seasonPreset: '12m' });
  const world = documentToWorld({ state: { world: state.world } }, TABLES);
  const altura = world.tables.promotions
    .values()
    .find((promotion) => promotion.controller.kind === 'human')?.id;
  if (altura === undefined) throw new Error('no player promotion');
  const ending = world.tables.employments
    .values()
    .filter(
      (row) =>
        row.promotionId === altura &&
        row.status === 'active' &&
        row.terms.kind === 'written' &&
        row.endsOn !== null,
    )
    .sort(
      (left, right) =>
        (left.endsOn ?? '').localeCompare(right.endsOn ?? '') || left.id.localeCompare(right.id),
    );
  const [calm, unhappy, refusing] = ending;
  if (calm === undefined || unhappy === undefined || refusing === undefined) {
    throw new Error('Altura has fewer than three written contracts');
  }
  setMorale(world, unhappy.id, -30);
  setMorale(world, refusing.id, -60);
  const engine = createEngine({
    state: { ...state, world: initialEngineState(world).world },
    systems: withMyShowsRun(defaultSystems),
  });
  return { engine, altura, renewals: [calm.id, unhappy.id, refusing.id] };
}

function askOf(game: Game, personId: PersonId, renewalOf?: EmploymentId): AskingTermsView {
  return done(
    game.engine.query(
      'contracts.askingTerms',
      {
        promotionId: game.altura,
        personId,
        kind: 'written',
        ...(renewalOf === undefined ? {} : { renewalOf }),
      },
      VIEW,
    ),
  );
}

function negotiation(engine: Engine, id: NegotiationId) {
  const row = engine.exportState().world.tables.negotiations.find((entry) => entry.id === id);
  if (row === undefined) throw new Error(`missing ${id}`);
  return row;
}

async function advanceUntil(engine: Engine, id: NegotiationId, status: string): Promise<void> {
  for (let day = 0; day < 6 && negotiation(engine, id).status !== status; day += 1) {
    await engine.advanceDays({ maxDays: 1 });
  }
  expect(negotiation(engine, id).status).toBe(status);
}

describe.runIf(SLOW_TESTS)('the negotiation Why? panels on a fresh default-world game', () => {
  it('name their tunables, read plainly and replay to the numbers shown', async () => {
    const game = freshGame();
    const { engine, altura } = game;
    const free = done(engine.query('contracts.freeAgents', { promotionId: altura }, VIEW)).filter(
      (row) => row.askMonthly !== null && row.situation === 'freeAgent',
    );
    const [first, second] = free;
    if (first === undefined || second === undefined) throw new Error('too few free agents');

    // The ask: market value, wage, fee, bonus and patience.
    const ask = askOf(game, first.personId);
    expect(first.askMonthly).toBe(ask.monthlyWage.value);
    expectNumberExplains('Market value', ask.marketValue, /^contracts\.value\./u);
    expectNumberExplains('Monthly wage ask', ask.monthlyWage, /^contracts\.(ask|value)\./u);
    expectNumberExplains('Fee ask', ask.perAppearanceFee, /^contracts\.ask\./u);
    expectNumberExplains('Signing bonus ask', ask.signingBonus, /^contracts\.ask\.signingBonus/u);
    expectNumberExplains('Patience', ask.startPatience, /^contracts\.patience\./u);

    // Contract value and the reaction, at 60% of the wage.
    const lowOffer = offerAt(ask, 0.6);
    const preview = done(
      engine.query(
        'contracts.offerPreview',
        { promotionId: altura, personId: first.personId, offer: lowOffer },
        VIEW,
      ),
    );
    expect(preview.band).toBe('counter');
    expect(preview.thresholds).toEqual({ walkAway: 0.45, counter: 0.55, accept: 0.95 });
    expectExplains('Your offer is worth', preview.valueTrace, /^contracts\.value\./u);
    expectExplains('Their ask is worth', preview.askValueTrace, /^contracts\.value\./u);
    expect(preview.valueTrace.value).toBe(preview.offerValue);
    expect(preview.askValueTrace.value).toBe(preview.askValue);
    expectExplains('Their reaction', preview.reactionTrace, /^contracts\.react\.counterRatio$/u);

    // The counter, the review and the signing bonus.
    const id = done(
      engine.command(
        'contracts.makeOffer',
        { promotionId: altura, personId: first.personId, offer: lowOffer },
        PLAYER,
      ),
    ).negotiationId;
    await advanceUntil(engine, id, 'countered');
    expectExplains(
      'The stored reaction',
      traceOf(engine, reactionTraceRef(id, 1)),
      /^contracts\.react\./u,
    );
    expectExplains(
      'Their counter-offer',
      traceOf(engine, counterTraceRef(id, 1)),
      /^contracts\.counter\./u,
    );
    const counter = negotiation(engine, id).lastCounter;
    if (counter === null) throw new Error('no counter');
    done(
      engine.command(
        'contracts.respondToCounter',
        { negotiationId: id, response: 'accept' },
        PLAYER,
      ),
    );
    await advanceUntil(engine, id, 'signed');
    const review = traceOf(engine, reviewTraceRef(id));
    expect(review?.kind).toBe('decision');
    expect(wordsOf(review ?? NO_TRACE).filter((word) => NOT_PLAIN.test(word))).toEqual([]);
    const bonusTrace = traceOf(engine, signingBonusTraceRef(id));
    expect(bonusTrace).not.toBeNull();
    const ledger = engine
      .exportState()
      .world.tables.ledgerEntries.filter(
        (row) => row.promotionId === altura && row.category === 'signingBonuses',
      );
    expect(ledger.map((row) => Math.abs(row.amount))).toEqual([counter.terms.signingBonus]);
    // The agreed amount, paid as agreed: no tunable is involved, so none is named.
    expect(wordsOf(bonusTrace ?? NO_TRACE).filter((word) => NOT_PLAIN.test(word))).toEqual([]);
    const paid = bonusTrace?.value;
    if (typeof paid !== 'number' || bonusTrace === null) throw new Error('no bonus number');
    expectTraceReplays({ value: paid, trace: bonusTrace });
    expect(Math.abs(paid)).toBe(counter.terms.signingBonus);

    // A walk-away at 40% of the wage and no bonus.
    const walkOffer = offerAt(askOf(game, second.personId), 0.4, 0);
    const walk = done(
      engine.query(
        'contracts.offerPreview',
        { promotionId: altura, personId: second.personId, offer: walkOffer },
        VIEW,
      ),
    );
    expect(walk.band).toBe('walkAway');
    expectExplains('A walk-away', walk.reactionTrace, /^contracts\.react\.walkAwayRatio$/u);

    // Renewals: the current-deal floor, the Morale line (not applied at 0, applied at −30), and
    // the refusal at −60.
    const [calm, unhappy, refusing] = game.renewals.map((employmentId) => {
      const row = engine
        .exportState()
        .world.tables.employments.find((entry) => entry.id === employmentId);
      if (row === undefined) throw new Error(`missing ${employmentId}`);
      return { row, ask: askOf(game, row.personId, employmentId) };
    });
    if (calm === undefined || unhappy === undefined || refusing === undefined) {
      throw new Error('missing renewals');
    }
    expect(calm.ask.monthlyWage.value).toBeGreaterThanOrEqual(calm.row.terms.monthlyWage);
    expectNumberExplains('A renewal ask', calm.ask.monthlyWage, /^contracts\.(ask|value)\./u);
    const calmMorale = findTraceNodes(calm.ask.monthlyWage.trace, 'branch').find((node) =>
      node.label.startsWith('Morale 0'),
    );
    expect(calmMorale?.taken, 'the Morale check shows, not applied').toBe(false);
    expectNumberExplains(
      'An unhappy renewal ask',
      unhappy.ask.monthlyWage,
      /^contracts\.renewal\.unhappyMorale$/u,
    );
    expect(JSON.stringify(unhappy.ask.monthlyWage.trace)).toContain('Morale −30: unhappy here');
    expect(refusing.ask.refusal?.message).toBe("Won't renew while unhappy here");
    expectExplains(
      'A refused renewal',
      refusing.ask.renewalDecision?.trace,
      /^contracts\.renewal\.refuseMorale$/u,
    );
  }, 180_000);
});
