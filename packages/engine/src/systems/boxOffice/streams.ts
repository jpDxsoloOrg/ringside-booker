/**
 * The box office system's random streams. `boxOffice.crowd` rolls how far a show's real crowd lands
 * from its forecast (EVT6-04); `boxOffice.merch` rolls live merchandise sales (EVT6-05). Nothing
 * draws from either yet. Design: docs/design/box-office.md#crowd-roll.
 */

declare module '../../core/rng/streams' {
  interface StreamNames {
    'boxOffice.crowd': true;
    'boxOffice.merch': true;
  }
}

/** The stream the show-day crowd roll draws from. */
export const BOX_OFFICE_CROWD_STREAM = 'boxOffice.crowd';
/** The stream live merchandise sales draw from. */
export const BOX_OFFICE_MERCH_STREAM = 'boxOffice.merch';
