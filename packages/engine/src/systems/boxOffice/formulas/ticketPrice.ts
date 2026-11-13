/**
 * The ticket price for one show, in cents: a base price plus a little for every point of the
 * company's reach, times the show's size. Reach is ECO1's smooth 0..100 figure, so prices rise
 * gradually as a company grows rather than jumping between size labels.
 * Design: docs/design/box-office.md#ticket-price.
 */

import type { EventImportance } from '../../../model/entities/event-definition';
import { constantOf, startCalc, type Traced } from '../../../core/trace';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { showSizeLabel } from './labels';

export const TICKET_PRICE_DOC_REF = 'box-office.md#ticket-price';

export interface TicketPriceInputs {
  /** The promotion's reach, 0..100, from ECO1's `reachOf`, kept as a nested Why?. */
  readonly reach: Traced<number>;
  readonly importance: EventImportance;
}

const TICKET_IMPORTANCE_KEYS = {
  house: 'boxOffice.ticket.importance.house',
  minor: 'boxOffice.ticket.importance.minor',
  regular: 'boxOffice.ticket.importance.regular',
  major: 'boxOffice.ticket.importance.major',
  flagship: 'boxOffice.ticket.importance.flagship',
} as const satisfies Readonly<Record<EventImportance, NumberTunableKey>>;

/** One ticket's price in whole cents, 0 or more. Deterministic: no rolls. */
export function computeTicketPrice(
  inputs: TicketPriceInputs,
  deps: { readonly tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc('Ticket price', inputs.reach, {
    unit: 'money',
    docRef: TICKET_PRICE_DOC_REF,
  });
  calc.multiply(
    'Price per point of reach',
    calc.tunable(tunables, 'boxOffice.ticket.perReachPoint', 'Price per point of reach'),
  );
  calc.add('Base price', calc.tunable(tunables, 'boxOffice.ticket.base', 'Base price'));
  calc.multiply(
    showSizeLabel(inputs.importance),
    calc.tunable(tunables, TICKET_IMPORTANCE_KEYS[inputs.importance], 'Show size'),
  );
  calc.round('round', 'Rounded to whole cents');
  calc.max('Never below 0', constantOf('Free', 0, 'A ticket cannot cost less than nothing'));
  return calc.done();
}
