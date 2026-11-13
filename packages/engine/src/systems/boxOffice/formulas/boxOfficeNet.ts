/**
 * A show's net box office, in cents: ticket money and merch money, less the workers' shares of each
 * and the venue rent, each on its own line so the Net figure has its own Why?. Wages, travel,
 * catering and production are ECO1's per-show costs and are not here.
 * Design: docs/design/box-office.md#box-office-net.
 */

import { inputOf, startCalc, type Traced } from '../../../core/trace';

export const BOX_OFFICE_NET_DOC_REF = 'box-office.md#box-office-net';

/** Each amount is whole cents, either plain or with its own Why? to nest. */
export interface BoxOfficeNetInputs {
  readonly grossGate: number | Traced<number>;
  readonly gateShare: number | Traced<number>;
  readonly rent: number | Traced<number>;
  readonly grossMerch: number | Traced<number>;
  readonly merchShare: number | Traced<number>;
  /** Notes added at the end of the Why?, such as "No tickets sold" (EVT6-05's settlement). */
  readonly notes?: readonly string[];
}

/** Net box office takings in cents; negative when rent is more than the show took. */
export function computeBoxOfficeNet(inputs: BoxOfficeNetInputs): Traced<number> {
  const start =
    typeof inputs.grossGate === 'number'
      ? inputOf('Ticket sales', inputs.grossGate, undefined, 'money')
      : inputs.grossGate;
  const calc = startCalc('Box office net', start, {
    unit: 'money',
    docRef: BOX_OFFICE_NET_DOC_REF,
  });
  calc.subtract("Workers' share of the gate", inputs.gateShare);
  calc.subtract('Venue rent', inputs.rent);
  calc.add('Merch sales', inputs.grossMerch);
  calc.subtract("Workers' share of the merch", inputs.merchShare);
  for (const note of inputs.notes ?? []) {
    calc.note(note);
  }
  return calc.done();
}
