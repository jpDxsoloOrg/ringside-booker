import {
  cents,
  computeActualAttendance,
  computeBoxOfficeNet,
  computeLiveMerch,
  computeTicketPrice,
  computeVenueRent,
  computeWorkerShare,
  createEngineTunables,
  inputOf,
  RngRegistry,
  startCalc,
} from '@ringside/engine';
import type { EventImportance, Traced, VenueKind } from '@ringside/engine';
import type { BoxOfficeKpisProps } from '@/screens/box-office/BoxOfficeSection';

/**
 * Box office sections for the gallery and the section's tests, worked out with the engine's own
 * show-day formulas from invented inputs, so every Why? opens a real breakdown. No engine is asked.
 */

interface GalleryBoxOfficeInputs {
  readonly showName: string;
  readonly expected: number;
  readonly venueName: string;
  readonly capacity: number;
  readonly venueKind: VenueKind;
  readonly reach: number;
  readonly importance: EventImportance;
  readonly showScore: number;
  /** Ring names with their gate share in basis points. */
  readonly gateShares: readonly { readonly name: string; readonly bp: number }[];
  readonly seed: string;
  readonly mine: boolean;
}

const tunables = createEngineTunables();

function kept(
  label: string,
  gross: Traced<number>,
  shareLabel: string,
  share: Traced<number>,
): Traced<number> {
  return startCalc(label, gross, { unit: 'money' })
    .subtract(shareLabel, share.value > 0 ? share : 0)
    .done();
}

function build(inputs: GalleryBoxOfficeInputs): BoxOfficeKpisProps {
  const rng = new RngRegistry(inputs.seed);
  const crowd = computeActualAttendance(
    {
      expected: inputOf('Expected crowd', inputs.expected, undefined, 'count'),
      capacity: inputs.capacity,
      venueName: inputs.venueName,
    },
    { tunables, rng: rng.stream('boxoffice.crowd') },
  );
  const ticket = computeTicketPrice(
    { reach: inputOf('Reach', inputs.reach, undefined, 'points'), importance: inputs.importance },
    { tunables },
  );
  const grossGate = startCalc('Ticket sales', ticket, { unit: 'money' })
    .multiply('Crowd', crowd.value)
    .done();
  const rent = computeVenueRent(
    {
      capacity: inputs.capacity,
      venueKind: inputs.venueKind,
      venueName: inputs.venueName,
      ownVenue: false,
    },
    { tunables },
  );
  const merch = computeLiveMerch(
    { attendance: crowd.value, showScore: inputs.showScore },
    { tunables, rng: rng.stream('boxoffice.merch') },
  );
  const gateShare = computeWorkerShare(
    { gross: grossGate.value, label: 'Gate', shares: inputs.gateShares },
    { tunables },
  );
  const merchShare = computeWorkerShare(
    { gross: merch.value, label: 'Merch', shares: [] },
    { tunables },
  );
  const tickets = kept('Gate', grossGate, "Workers' share of the gate", gateShare);
  const liveMerch = kept('Live merch', merch, "Workers' share of the merch", merchShare);
  const net = computeBoxOfficeNet({
    grossGate: grossGate.value,
    gateShare: gateShare.value,
    rent: rent.value,
    grossMerch: merch.value,
    merchShare: merchShare.value,
  });
  const rentRow = startCalc('Venue rent', rent, { unit: 'money' })
    .multiply('Cost', -1, 'Money paid out comes off the cash')
    .done();
  return {
    showName: inputs.showName,
    crowd: {
      attendance: crowd.value,
      capacity: inputs.capacity,
      percentFull: Math.round((crowd.value / inputs.capacity) * 100),
      venueName: inputs.venueName,
      why: { trace: crowd.trace },
    },
    money: inputs.mine
      ? {
          ticketPrice: cents(ticket.value),
          gateShare: cents(gateShare.value),
          grossMerch: cents(merch.value),
          merchShare: cents(merchShare.value),
          tickets: { amount: cents(tickets.value), why: { trace: tickets.trace } },
          venueRent: { amount: cents(rentRow.value), why: { trace: rentRow.trace } },
          liveMerch: { amount: cents(liveMerch.value), why: { trace: liveMerch.trace } },
          net: { amount: cents(net.value), why: { trace: net.trace } },
        }
      : null,
  };
}

/** The player's regular show at a well-sized arena, with one worker on a gate share. */
export const galleryOwnBoxOffice: BoxOfficeKpisProps = build({
  showName: 'Friday Night Fury',
  expected: 14_600,
  venueName: 'Harrowmere Arena',
  capacity: 17_500,
  venueKind: 'arena',
  reach: 54,
  importance: 'regular',
  showScore: 64,
  gateShares: [
    { name: 'Rex Vance', bp: 250 },
    { name: 'Mara Quinn', bp: 0 },
  ],
  seed: 'gallery-own',
  mine: true,
});

/** A rival's show: the crowd only. */
export const galleryRivalBoxOffice: BoxOfficeKpisProps = build({
  showName: 'Tessen Iron Hour',
  expected: 9_900,
  venueName: 'Kurogane Hall',
  capacity: 11_000,
  venueKind: 'arena',
  reach: 48,
  importance: 'regular',
  showScore: 58,
  gateShares: [],
  seed: 'gallery-rival',
  mine: false,
});

/** More wanted in than the building holds. */
export const gallerySoldOutBoxOffice: BoxOfficeKpisProps = build({
  showName: 'Altitude',
  expected: 34_000,
  venueName: 'Harrowmere Arena',
  capacity: 17_500,
  venueKind: 'arena',
  reach: 54,
  importance: 'flagship',
  showScore: 78,
  gateShares: [],
  seed: 'gallery-sold-out',
  mine: true,
});

/** A small crowd in a stadium: the rent is more than the night took. */
export const galleryLossBoxOffice: BoxOfficeKpisProps = build({
  showName: 'Altura Mainstage',
  expected: 14_700,
  venueName: 'Kestlewood Stadium',
  capacity: 68_000,
  venueKind: 'stadium',
  reach: 54,
  importance: 'regular',
  showScore: 50,
  gateShares: [],
  seed: 'gallery-loss',
  mine: true,
});
