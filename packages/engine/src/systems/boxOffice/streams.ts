/**
 * The box office system's random streams. `boxoffice.crowd` rolls how far a show's real crowd lands
 * from its forecast and `boxoffice.merch` rolls live merchandise sales (both EVT6-04 formulas; the
 * EVT6-05 settlement passes the streams in). Stream names are lower case only, so the system id
 * `boxOffice` becomes `boxoffice` here. Design: docs/design/box-office.md#crowd-roll.
 */

declare module '../../core/rng/streams' {
  interface StreamNames {
    'boxoffice.crowd': true;
    'boxoffice.merch': true;
  }
}

/** The stream the show-day crowd roll draws from. */
export const BOX_OFFICE_CROWD_STREAM = 'boxoffice.crowd';
/** The stream live merchandise sales draw from. */
export const BOX_OFFICE_MERCH_STREAM = 'boxoffice.merch';
