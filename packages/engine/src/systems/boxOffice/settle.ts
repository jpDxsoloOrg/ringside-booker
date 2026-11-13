/**
 * Settling a completed show (EVT6-05): the crowd on the night, the ticket money, the venue rent and
 * the live merch, with the money moved only through ECO1's `postMoney`.
 *
 * For each show, in order: give it a venue if it still has none (the automatic pick), roll the
 * crowd from the forecast (recent form never counts the show itself), price a ticket from the
 * company's reach and the show's size, charge the venue's rent, roll the merch from the crowd and
 * the show score, take off the workers' shares and add up the net. Then write `result.attendance`
 * and `result.gate` (with the ticket price and gross merch, so the Box office section can show the
 * shares later), post up to three ledger rows (Tickets, Venue rent, Live merch) and publish
 * `show.settled`.
 *
 * The inputs are checked before anything is written, so a show with bad data is logged and skipped
 * and the settlement never throws on data. A show is settled once: one with an attendance is never
 * touched again.
 *
 * Traces: the player's shows store every line under its own `boxOffice.*` kind; a rival's show
 * stores only a short attendance Why? (its money is private and nobody can open it), and its
 * ledger rows get `postMoney`'s one-line Why?. Design: docs/design/box-office.md#settlement.
 */

import type { EventInstanceId, PromotionId } from '../../core/ids';
import { cents, type Cents } from '../../core/money';
import type { StepContext } from '../../core/pipeline/context';
import { inputOf, startCalc, type Traced } from '../../core/trace';
import type { EventInstance } from '../../model/entities/event-instance';
import type { LedgerCategory } from '../../model/entities/ledger-entry';
import type { DeepReadonly } from '../../model/world';
import { postMoney } from '../finance/post';
import { reachOf } from '../finance/reach';
import { formatNumber } from '../world/people/labels';
import { cardWorkersOf } from './cardWorkers';
import { forecastAttendance } from './forecast';
import { computeActualAttendance } from './formulas/actualAttendance';
import { computeBoxOfficeNet } from './formulas/boxOfficeNet';
import { computeLiveMerch } from './formulas/liveMerch';
import { computeTicketPrice } from './formulas/ticketPrice';
import { computeVenueRent } from './formulas/venueRent';
import { computeWorkerShare } from './formulas/workerShare';
import { showVenueOf, type ShowVenue } from './showVenue';
import { BOX_OFFICE_CROWD_STREAM, BOX_OFFICE_MERCH_STREAM } from './streams';
import { settlementTraceRef, type SettlementTraceKind } from './traceKinds';
import { autoPickVenue, hasVenue } from './venueChoice';

type Show = DeepReadonly<EventInstance>;

/** The ledger categories the box office posts under, in the order it posts them. */
export const BOX_OFFICE_CATEGORIES = ['tickets', 'venueRent', 'liveMerch'] as const;
export type BoxOfficeCategory = (typeof BOX_OFFICE_CATEGORIES)[number];

/** What the ledger memo says after the show's name: "Harbour Brawl: tickets". */
export const BOX_OFFICE_MEMOS: Readonly<Record<BoxOfficeCategory, string>> = Object.freeze({
  tickets: 'tickets',
  venueRent: 'venue rent',
  liveMerch: 'live merch',
});

/** Every number one settlement worked out, in whole cents (rent as a positive cost). */
export interface ShowSettlement {
  readonly eventInstanceId: EventInstanceId;
  readonly promotionId: PromotionId;
  readonly attendance: number;
  readonly capacity: number;
  readonly ticketPrice: Cents;
  readonly grossGate: Cents;
  readonly gateShare: Cents;
  /** Ticket money kept: the gross gate less the workers' share. */
  readonly tickets: Cents;
  readonly rent: Cents;
  readonly grossMerch: Cents;
  readonly merchShare: Cents;
  /** Merch money kept: the gross merch less the workers' share. */
  readonly liveMerch: Cents;
  readonly net: Cents;
}

/** True when `show` has run and the box office has not settled it yet. */
export function awaitsSettlement(show: Show): boolean {
  return show.status === 'completed' && show.result !== null && show.result.attendance === null;
}

/** Why the show cannot be settled from its data, or null when it can. Writes nothing. */
function problemWith(ctx: StepContext, show: Show, venue: ShowVenue | null): string | null {
  const promotion = ctx.read.tables.promotions.get(show.promotionId);
  if (promotion === undefined) {
    return `its promotion ${show.promotionId} does not exist`;
  }
  if (promotion.status === 'closed') {
    return `${promotion.name} is closed`;
  }
  if (venue === null) {
    return 'its venue cannot be found';
  }
  if (venue.capacity <= 0) {
    return `${venue.name} holds nobody`;
  }
  return null;
}

/** Gives a show that still has no venue the automatic pick. False when the pick fails. */
function ensureVenue(ctx: StepContext, show: Show, detailed: boolean): Show | null {
  if (hasVenue(show)) {
    return show;
  }
  try {
    autoPickVenue(ctx, show, { storeTrace: detailed });
  } catch (error) {
    ctx.log(
      `${show.name} (${show.id}): no venue could be picked to settle it: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
  return ctx.read.tables.eventInstances.require(show.id);
}

/** Money kept from a gross after the workers' shares, as a short Why?. */
function keptAfterShares(
  label: string,
  gross: Traced<number> | number,
  shareLabel: string,
  share: Traced<number> | number,
): Traced<number> {
  return startCalc(label, gross, { unit: 'money' }).subtract(shareLabel, share).done();
}

/**
 * Settles one completed show: rolls its crowd, posts its tickets, venue rent and live merch, writes
 * its attendance and gate and publishes `show.settled`. Returns what it worked out, or null when
 * the show needs no settling (not run, or settled already) or its data is bad (logged, nothing
 * written apart from a venue pick).
 */
export function settleShow(
  ctx: StepContext,
  eventInstanceId: EventInstanceId,
): ShowSettlement | null {
  const found = ctx.read.tables.eventInstances.get(eventInstanceId);
  if (found === undefined || !awaitsSettlement(found) || found.result === null) {
    return null;
  }
  const promotion = ctx.read.tables.promotions.get(found.promotionId);
  // The player's shows keep every Why?; rivals keep a short attendance one.
  const detailed = promotion?.controller.kind === 'human';
  const show = ensureVenue(ctx, found, detailed);
  if (show?.result == null) {
    return null;
  }
  const venue = showVenueOf(ctx.read, show);
  const problem = problemWith(ctx, show, venue);
  if (problem !== null || venue === null) {
    ctx.log(`${show.name} (${show.id}) was not settled: ${problem ?? 'no venue'}`);
    return null;
  }

  const { tunables } = ctx;
  const record = (kind: SettlementTraceKind, traced: Traced<number>): void => {
    ctx.recordTrace(settlementTraceRef(kind, show.id), ctx.date, traced);
  };

  // (2) The crowd on the night, from the forecast (recent form leaves this show out).
  const forecast = forecastAttendance(ctx.read, tunables, show);
  const expected = detailed
    ? forecast.expected
    : inputOf('Expected crowd', forecast.expected.value, undefined, 'count');
  const crowd = computeActualAttendance(
    { expected, capacity: venue.capacity, venueName: venue.name },
    { tunables, rng: ctx.rng(BOX_OFFICE_CROWD_STREAM) },
  );
  const attendance = crowd.value;

  // (3) Tickets: the price from reach and the show's size, times the crowd.
  // Reach goes in as one line: its full Why? (a roll-up over the map) is on the Finances page and
  // would make every stored ticket price many times bigger.
  const reach = reachOf(ctx.read, show.promotionId, tunables).reach.value;
  const ticket = computeTicketPrice(
    {
      reach: inputOf(
        `Reach: ${formatNumber(reach)}`,
        reach,
        { kind: 'promotion', id: show.promotionId },
        'points',
      ),
      importance: show.importance,
    },
    { tunables },
  );
  const grossGate = ticket.value * attendance;

  // (4) Rent, on capacity; a venue of the company's own is cheaper.
  const rent = computeVenueRent(
    {
      capacity: venue.capacity,
      venueKind: venue.venueKind,
      venueName: venue.name,
      ownVenue: venue.kind === 'venue' && venue.exclusivePromotionId === show.promotionId,
    },
    { tunables },
  );

  // (5) Merch, from the crowd and the show score.
  const merch = computeLiveMerch(
    { attendance, showScore: show.result.score },
    { tunables, rng: ctx.rng(BOX_OFFICE_MERCH_STREAM) },
  );

  // (6) The workers' shares of each.
  const workers = cardWorkersOf(ctx.read, show);
  const gateShare = computeWorkerShare(
    {
      gross: grossGate,
      label: 'Gate',
      shares: workers.map((worker) => ({ name: worker.name, bp: worker.gateBp })),
    },
    { tunables },
  );
  const merchShare = computeWorkerShare(
    {
      gross: merch.value,
      label: 'Merch',
      shares: workers.map((worker) => ({ name: worker.name, bp: worker.merchBp })),
    },
    { tunables },
  );
  const tickets = grossGate - gateShare.value;
  // A share of 0 (nobody on the card has one) is one plain line rather than a check per worker.
  const shareLine = (share: Traced<number>): Traced<number> | number =>
    share.value > 0 ? share : 0;
  const liveMerch = merch.value - merchShare.value;

  // (7) The net, with a note for every line that posts nothing.
  const notes: string[] = [];
  if (tickets === 0) notes.push('No tickets sold');
  if (rent.value === 0) notes.push('No rent to pay');
  if (liveMerch === 0) notes.push('No merch sold');
  const net = computeBoxOfficeNet({
    grossGate,
    gateShare: gateShare.value,
    rent: rent.value,
    grossMerch: merch.value,
    merchShare: merchShare.value,
    notes,
  });

  // The show's result: the rest of it is left as show night wrote it.
  ctx.tx.update('eventInstances', show.id, (previous) => ({
    ...previous,
    result:
      previous.result === null
        ? null
        : {
            ...previous.result,
            attendance,
            gate: cents(grossGate),
            ticketPrice: cents(ticket.value),
            merch: cents(merch.value),
          },
  }));

  // The money, through ECO1 only. A line that comes to 0 is not posted (postMoney refuses 0).
  const gateTrace = startCalc(
    'Tickets',
    inputOf('Ticket price', ticket.value, undefined, 'money'),
    {
      unit: 'money',
    },
  )
    .multiply(`Crowd: ${formatNumber(attendance)}`, attendance)
    .subtract("Workers' share of the gate", shareLine(gateShare))
    .done();
  const merchTrace = keptAfterShares(
    'Live merch',
    merch,
    "Workers' share of the merch",
    shareLine(merchShare),
  );
  const rows: Record<BoxOfficeCategory, { amount: number; trace: Traced<number> }> = {
    tickets: {
      amount: tickets,
      trace: keptAfterShares('Tickets', grossGate, "Workers' share of the gate", gateShare.value),
    },
    venueRent: {
      amount: -rent.value,
      trace: startCalc('Venue rent', inputOf(`Rent for ${venue.name}`, rent.value), {
        unit: 'money',
      })
        .multiply('Cost', -1, 'Money paid out comes off the cash')
        .done(),
    },
    liveMerch: {
      amount: liveMerch,
      trace: keptAfterShares(
        'Live merch',
        merch.value,
        "Workers' share of the merch",
        merchShare.value,
      ),
    },
  };
  for (const category of BOX_OFFICE_CATEGORIES) {
    const row = rows[category];
    if (row.amount === 0) {
      continue;
    }
    postMoney(ctx, {
      promotionId: show.promotionId,
      category: category satisfies LedgerCategory,
      amount: cents(row.amount),
      memo: `${show.name}: ${BOX_OFFICE_MEMOS[category]}`,
      refs: { eventInstanceId: show.id, personId: null, dealId: null },
      ...(detailed ? { trace: row.trace } : {}),
    });
  }

  if (detailed) {
    record('boxOffice.attendance', crowd);
    record('boxOffice.ticketPrice', ticket);
    record('boxOffice.gate', gateTrace);
    record('boxOffice.venueRent', rent);
    record('boxOffice.liveMerch', merchTrace);
    record('boxOffice.net', net);
  } else {
    record('boxOffice.rivalAttendance', crowd);
  }

  ctx.publish('show.settled', {
    eventInstanceId: show.id,
    promotionId: show.promotionId,
    attendance,
    capacity: venue.capacity,
    gate: grossGate,
    net: net.value,
  });

  return {
    eventInstanceId: show.id,
    promotionId: show.promotionId,
    attendance,
    capacity: venue.capacity,
    ticketPrice: cents(ticket.value),
    grossGate: cents(grossGate),
    gateShare: cents(gateShare.value),
    tickets: cents(tickets),
    rent: cents(rent.value),
    grossMerch: cents(merch.value),
    merchShare: cents(merchShare.value),
    liveMerch: cents(liveMerch),
    net: cents(net.value),
  };
}
