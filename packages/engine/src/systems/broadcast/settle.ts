/**
 * Airing settlement (ECO8-04): where TV pays. Each show a deal airs today is settled once, for
 * every promotion under the same rules:
 *
 * - **Aired:** the audience is worked out with the show's quality and the night-to-night swing, an
 *   `airings` row records the viewers against what the network expected, and the money moves
 *   only through `postMoney`: an income row (TV rights, Pay-per-view or Streaming, less the workers'
 *   broadcast shares) and an airtime row (Production). A deal whose airtime costs more than it
 *   pays loses money every airing; the Why? says so plainly rather than hiding it.
 * - **Missed:** a cancelled show pays nothing; the row says why, for deal health (ECO8-05).
 *
 * Deals are settled on their stored terms: what they would be worth today (ECO8-03's valuation)
 * only matters when one is signed or renegotiated.
 *
 * Design: docs/design/broadcast.md#settlement.
 */

import type { GameDate } from '../../core/date';
import { cents, negate } from '../../core/money';
import type { StepContext } from '../../core/pipeline/context';
import { constantOf, inputOf, startCalc, type Traced, type TraceNode } from '../../core/trace';
import { compactTrace } from '../../core/trace/compact';
import type { Airing, AiringMissReason, AiringQuality } from '../../model/entities/airing';
import { AIRING_SHOW_NAME_MAX } from '../../model/entities/airing';
import type { EventImportance } from '../../model/entities/event-definition';
import type { NetworkKind } from '../../model/entities/network';
import type { GameWorldView } from '../../model/tables';
import { cardWorkersOf } from '../boxOffice/cardWorkers';
import { computeWorkerShare, type WorkerShareSource } from '../boxOffice/formulas/workerShare';
import { postMoney } from '../finance/post';
import type { EngineTunables } from '../tunables';
import { formatNumber } from '../world/people/labels';
import { audienceInputsFor, benchmarkFor } from './audienceInputs';
import { AIRTIME_COST_CATEGORY, incomeCategoryFor, type DueAiring } from './coverage';
import { audience, formatViewers } from './formulas/audience';
import { BROADCAST_VIEWERS_STREAM } from './streams';
import { airingTraceRef, isHumanControlled } from './traces';

export const SETTLEMENT_DOC_REF = 'broadcast.md#settlement';

/** Shown wherever an airing with no show result is listed: only a world without the calendar. */
export const AIRED_WITHOUT_RESULT_NOTE = 'Aired without a show result';
/** The memo suffix for the same airing. */
export const AIRED_WITHOUT_RESULT_MEMO = ' (aired without a show result)';

/** Why a missed airing paid nothing, in plain words. */
export const MISSED_AIRING_NOTES: Readonly<Record<AiringMissReason, string>> = {
  showCancelled: 'Show cancelled: nothing aired',
  notRun: "The show didn't run: nothing aired",
};

/** Shown on an airing whose airtime cost more than the network paid. */
export const AIRING_LOSS_NOTE = 'This deal costs more in airtime than the network pays for a show';

/** Shown when no worker on the show has a share of its broadcast money. */
export const NO_BROADCAST_SHARES_NOTE = 'Nobody on the show has a share of this money';
/** Shown when the show has no card, so there is nobody to pay a share. */
export const NO_CARD_SHARES_NOTE = 'No card on file: nobody to pay a share';

/**
 * How deep the audience Why? is kept inside an airing's Why?: the player's airings keep most of
 * it, rivals' only the main factors (their money is private; their viewers are public).
 */
const AUDIENCE_DEPTH = { human: 8, rival: 3 } as const;
/** The benchmark keeps its headline and main factors; its own Why? is on the deal screens. */
const BENCHMARK_DEPTH = 2;

/** What an airing's money is called, by network kind (the ledger category's label). */
const INCOME_LABELS: Readonly<Record<NetworkKind, WorkerShareSource>> = {
  tv: 'TV rights',
  ppv: 'Pay-per-view',
  streaming: 'Streaming',
};

/** What one airing's audience is counted in. */
const AUDIENCE_NOUNS: Readonly<Record<NetworkKind, string>> = {
  tv: 'viewers',
  ppv: 'buys',
  streaming: 'viewers',
};

/** What happened to a due airing: it aired with this quality, or it was missed. */
export type AiringOutcome =
  | {
      readonly status: 'aired';
      readonly quality: AiringQuality;
      /** "Aired without a show result" when the quality is a stand-in, else null. */
      readonly note: string | null;
    }
  | { readonly status: 'missed'; readonly reason: AiringMissReason };

/**
 * The one rule from a show's state to its airing, so the ledger memo, the airing row and the
 * calendar line always agree:
 *
 * | Show                              | Airing                                   |
 * | --------------------------------- | ---------------------------------------- |
 * | completed                         | aired, the show's score                  |
 * | cancelled                         | missed, `showCancelled`                  |
 * | scheduled or booked on air date   | missed, `notRun` (ECO8-07)               |
 * | definition date (no calendar)     | aired, neutral quality, "without result" |
 *
 * EVT3 runs every show dated today in the `shows` group (and the player runs theirs before the
 * day's phases), so a show still open when its airings settle was not run: nothing aired. A
 * completed show with no result (only a hand-built world) counts as not run too. Only a world
 * without the calendar (a definition date) still airs at neutral quality.
 */
export function airingOutcomeOf(due: DueAiring, tunables: EngineTunables): AiringOutcome {
  const neutral: AiringOutcome = {
    status: 'aired',
    quality: {
      score: Math.round(tunables.get('broadcast.audience.neutralQuality')),
      source: 'neutral',
    },
    note: AIRED_WITHOUT_RESULT_NOTE,
  };
  if (due.source === 'definition') {
    return neutral;
  }
  const { instance } = due;
  switch (instance.status) {
    case 'completed':
      return instance.result === null
        ? { status: 'missed', reason: 'notRun' }
        : {
            status: 'aired',
            quality: { score: instance.result.score, source: 'show' },
            note: null,
          };
    case 'cancelled':
      return { status: 'missed', reason: 'showCancelled' };
    case 'scheduled':
    case 'booked':
      return { status: 'missed', reason: 'notRun' };
  }
}

/** The show a due airing is for: its name, importance and ids. */
interface DueShow {
  readonly name: string;
  readonly importance: EventImportance;
  readonly eventInstanceId: Airing['eventInstanceId'];
  readonly eventDefinitionId: Airing['eventDefinitionId'];
}

function dueShowOf(due: DueAiring): DueShow {
  if (due.source === 'definition') {
    return {
      name: due.definition.name,
      importance: due.definition.importance,
      eventInstanceId: null,
      eventDefinitionId: due.definition.id,
    };
  }
  return {
    name: due.instance.name,
    importance: due.instance.importance,
    eventInstanceId: due.instance.id,
    eventDefinitionId: due.instance.eventDefinitionId,
  };
}

/** Cuts `text` to `max` characters, ending in "…" when cut. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * True when the deal already has an airing row for this show on `airDate`, so a re-run (or the
 * phase after the show night reaction) never pays twice.
 */
export function alreadySettled(read: GameWorldView, due: DueAiring, airDate: GameDate): boolean {
  const show = dueShowOf(due);
  return read.tables.airings
    .lookup('byDeal', due.deal.id)
    .some(
      (row) =>
        row.airDate === airDate &&
        row.eventInstanceId === show.eventInstanceId &&
        row.eventDefinitionId === show.eventDefinitionId,
    );
}

/** The workers' shares of an airing's gross, or a note saying why there are none. */
function sharesOf(
  read: GameWorldView,
  tunables: EngineTunables,
  due: DueAiring,
  gross: number,
): { readonly shares: Traced<number> | null; readonly note: string | null } {
  if (due.source === 'definition') {
    return { shares: null, note: NO_CARD_SHARES_NOTE };
  }
  const workers = cardWorkersOf(read, due.instance).filter((worker) => worker.broadcastBp > 0);
  if (workers.length === 0) {
    const hasCard = read.tables.segments.lookup('byEventInstance', due.instance.id).length > 0;
    return { shares: null, note: hasCard ? NO_BROADCAST_SHARES_NOTE : NO_CARD_SHARES_NOTE };
  }
  const shares = computeWorkerShare(
    {
      gross,
      label: INCOME_LABELS[due.network.kind],
      shares: workers.map((worker) => ({ name: worker.name, bp: worker.broadcastBp })),
    },
    { tunables },
  );
  return { shares, note: null };
}

/**
 * The per-thousand money: the deal's rate × viewers ÷ 1,000, rounded down to whole cents. Multiplied
 * first, so the whole-number product is exact before the one division.
 */
function perThousandIncome(viewers: Traced<number>, rate: number, noun: string): Traced<number> {
  return startCalc(`Paid for ${noun}`, viewers, { unit: 'money', docRef: SETTLEMENT_DOC_REF })
    .multiply(`Paid per 1,000 ${noun}`, rate)
    .divide('Per 1,000', 1_000)
    .round('floor', 'Rounded down to whole cents')
    .done();
}

/** Puts a fact (a node that does not change the value) into a formula's steps, after `index`. */
function withFact(traced: Traced<number>, index: number, fact: TraceNode): Traced<number> {
  const children = traced.trace.children ?? [];
  return {
    value: traced.value,
    trace: {
      ...traced.trace,
      children: [...children.slice(0, index + 1), fact, ...children.slice(index + 1)],
    },
  };
}

/**
 * Settles one due airing on `ctx.date`: writes the airing row, posts its money and records its
 * Why?. Returns null (and logs) when the deal already has a row for this show today.
 */
export function settleAiring(ctx: StepContext, due: DueAiring): Airing | null {
  const { read, tunables } = ctx;
  const { deal, network } = due;
  const show = dueShowOf(due);
  if (alreadySettled(read, due, ctx.date)) {
    ctx.log(`${show.name} on ${network.name} (deal ${deal.id}) is already settled today`);
    return null;
  }
  const promotion = read.tables.promotions.require(deal.promotionId);
  const human = isHumanControlled(promotion);
  const outcome = airingOutcomeOf(due, tunables);
  const showName = clip(show.name, AIRING_SHOW_NAME_MAX);
  const importance = show.importance;
  const expected = benchmarkFor(read, tunables, {
    networkId: network.id,
    timeslot: deal.timeslot,
    importance,
  });
  const airingId = ctx.tx.mintId('airings');
  const traceRef = airingTraceRef({ id: airingId }, human);

  if (outcome.status === 'missed') {
    const airing = ctx.tx.insert('airings', {
      id: airingId,
      dealId: deal.id,
      networkId: network.id,
      promotionId: promotion.id,
      eventInstanceId: show.eventInstanceId,
      eventDefinitionId: show.eventDefinitionId,
      showName,
      airDate: ctx.date,
      status: 'missed',
      missReason: outcome.reason,
      quality: null,
      viewers: 0,
      expectedViewers: expected.value,
      income: cents(0),
      sharesPaid: cents(0),
      cost: cents(0),
      traceRef,
    });
    ctx.recordTrace(
      traceRef,
      ctx.date,
      constantOf('Nothing aired', 0, MISSED_AIRING_NOTES[outcome.reason]),
    );
    ctx.publish('broadcast.missed', {
      airingId,
      dealId: deal.id,
      promotionId: promotion.id,
      eventInstanceId: show.eventInstanceId,
      airDate: ctx.date,
      reason: outcome.reason,
    });
    return airing;
  }

  // (1) The audience: tonight's quality and the night-to-night swing.
  const viewers = audience(
    audienceInputsFor(read, tunables, {
      promotionId: promotion.id,
      networkId: network.id,
      timeslot: deal.timeslot,
      live: deal.live,
      importance,
      eventInstanceId: show.eventInstanceId,
      quality: {
        score: outcome.quality.score,
        source: outcome.quality.source,
        ...(outcome.note === null ? {} : { note: outcome.note }),
      },
      swing: true,
    }),
    { tunables, rng: ctx.rng(BROADCAST_VIEWERS_STREAM) },
  );
  const noun = AUDIENCE_NOUNS[network.kind];
  const keptViewers = compactTrace(viewers, human ? AUDIENCE_DEPTH.human : AUDIENCE_DEPTH.rival);

  // (2) The money, on the deal's stored terms: the fee plus the per-thousand rate.
  const dealRef = { kind: 'deal', id: deal.id } as const;
  const incomeLabel = INCOME_LABELS[network.kind];
  const grossCalc = startCalc(
    `${incomeLabel} for ${showName}`,
    inputOf('Fee per show', deal.terms.feePerShow, dealRef, 'money'),
    { unit: 'money', docRef: SETTLEMENT_DOC_REF },
  ).add(
    `Per 1,000 ${noun} × ${formatNumber(Math.floor(viewers.value / 100) / 10)} thousand`,
    perThousandIncome(keptViewers, deal.terms.perThousandViewers, noun),
  );
  const gross = grossCalc.current;
  const { shares, note: sharesNote } = sharesOf(read, tunables, due, gross);
  const sharesPaid = shares?.value ?? 0;
  if (shares === null) {
    grossCalc.note(sharesNote ?? NO_BROADCAST_SHARES_NOTE);
  } else {
    grossCalc.subtract("Workers' shares", shares);
  }
  if (outcome.note !== null) {
    grossCalc.note(outcome.note);
  }
  const incomeLine = grossCalc.done();
  const cost = deal.terms.costPerShow;
  const net = incomeLine.value - cost;

  // (3) The ledger: an income row and an airtime row, each only when not 0.
  const refs = { eventInstanceId: show.eventInstanceId, dealId: deal.id, personId: null };
  if (incomeLine.value > 0) {
    postMoney(ctx, {
      promotionId: promotion.id,
      category: incomeCategoryFor(network.kind),
      amount: cents(incomeLine.value),
      memo: clip(
        `Broadcast: ${showName} on ${network.name}${outcome.note === null ? '' : AIRED_WITHOUT_RESULT_MEMO}`,
        120,
      ),
      refs,
      ...(human ? { trace: incomeLine } : {}),
    });
  }
  if (cost > 0) {
    const costTrace = startCalc(
      `Airtime on ${network.name}`,
      inputOf('Airtime per show', cost, dealRef, 'money'),
      { unit: 'money', docRef: SETTLEMENT_DOC_REF },
    )
      .multiply('Cost', -1, 'Money paid out comes off the cash')
      .done();
    postMoney(ctx, {
      promotionId: promotion.id,
      category: AIRTIME_COST_CATEGORY,
      amount: negate(cost),
      memo: clip(`Airtime: ${network.name}`, 120),
      refs,
      ...(human ? { trace: costTrace } : {}),
    });
  }

  // (4) The airing's own Why?: income less airtime, with what the network expected beside it.
  const airingCalc = startCalc(`${showName} on ${network.name}`, incomeLine, {
    unit: 'money',
    docRef: SETTLEMENT_DOC_REF,
  }).subtract(
    'Airtime',
    inputOf(`Airtime on ${network.name}`, cost, dealRef, 'money'),
    'What the network charges for each show, from the deal',
  );
  if (net < 0) {
    airingCalc.note(AIRING_LOSS_NOTE);
  }
  const benchmark = compactTrace(expected, BENCHMARK_DEPTH);
  const airingTrace = withFact(airingCalc.done(), 0, {
    kind: 'input',
    label: `${network.name} expected ${formatViewers(expected.value)} ${noun}; ${formatViewers(viewers.value)} watched`,
    value: expected.value,
    unit: 'count',
    children: [benchmark.trace],
  });

  const airing = ctx.tx.insert('airings', {
    id: airingId,
    dealId: deal.id,
    networkId: network.id,
    promotionId: promotion.id,
    eventInstanceId: show.eventInstanceId,
    eventDefinitionId: show.eventDefinitionId,
    showName,
    airDate: ctx.date,
    status: 'aired',
    missReason: null,
    quality: outcome.quality,
    viewers: viewers.value,
    expectedViewers: expected.value,
    income: cents(gross),
    sharesPaid: cents(sharesPaid),
    cost: cents(cost),
    traceRef,
  });
  ctx.recordTrace(traceRef, ctx.date, airingTrace);

  // (5) The show's own viewers: several deals on one show add up. Only EVT3 creates a result.
  if (due.source === 'instance' && due.instance.status === 'completed') {
    ctx.tx.update('eventInstances', due.instance.id, (previous) =>
      previous.result === null
        ? previous
        : {
            ...previous,
            result: {
              ...previous.result,
              viewers: (previous.result.viewers ?? 0) + viewers.value,
            },
          },
    );
  }

  ctx.publish('broadcast.aired', {
    airingId,
    dealId: deal.id,
    promotionId: promotion.id,
    networkId: network.id,
    eventInstanceId: show.eventInstanceId,
    airDate: ctx.date,
    viewers: viewers.value,
  });
  return airing;
}
