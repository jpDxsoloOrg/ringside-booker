/**
 * The name generator's RNG streams. Legal names and ring names draw from separate streams, so
 * changing the ring name rules (or generating more ring names) never changes anyone's legal name.
 */

declare module '../../../core/rng/streams' {
  interface StreamNames {
    /** Legal names: culture, given name, surname, retries and middle initials. */
    'worldgen.names.person': true;
    /** Ring names: pattern, words and retries. */
    'worldgen.names.ring': true;
  }
}

export {};
