/**
 * The RNG streams the roster build draws from, besides the people generator's own. Each build step
 * has its own stream, so changing how teams are formed never moves a contract date or anyone's
 * push.
 */

declare module '@ringside/engine' {
  interface StreamNames {
    /** Gender and career stage order inside a promotion, home country or neighbour, style. */
    'worldgen.roster.people': true;
    /** The face/heel swap per pair down the push order. */
    'worldgen.roster.alignment': true;
    /** The ±noise on each fitted popularity value. */
    'worldgen.roster.popularity': true;
    /** Contract start and end dates. */
    'worldgen.roster.contracts': true;
    /** Team pairing order, formation dates, names and experience. */
    'worldgen.roster.teams': true;
    /** Title history: reign dates, defences and past holders. */
    'worldgen.roster.reigns': true;
  }
}

export {};
