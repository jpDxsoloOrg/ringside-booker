/**
 * The new-game setup steps' random streams. Each step draws from its own stream, so turning one
 * option on never changes what another option rolls.
 */

declare module '../../core/rng/streams' {
  interface StreamNames {
    /** New end dates for contracts that would have ended on or before the first day. */
    'newgame.contracts': true;
    /** New end dates for running contracts when "Shuffle contract lengths" is on. */
    'newgame.contract-lengths': true;
    /** The fresh potential rolls when "Re-roll potential" is on. */
    'newgame.potential': true;
  }
}

/** Contract expiry fix-up. */
export const CONTRACT_FIXUP_STREAM = 'newgame.contracts';
/** "Shuffle contract lengths". */
export const CONTRACT_LENGTH_STREAM = 'newgame.contract-lengths';
/** "Re-roll potential". */
export const POTENTIAL_STREAM = 'newgame.potential';
