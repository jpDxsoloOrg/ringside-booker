/**
 * The broadcast system's random streams (ECO8-01). Declared now so later ECO8 tickets draw from
 * fixed names: `broadcast.viewers` rolls the spread of an airing's viewers (ECO8-03) and
 * `broadcast.health` the network's verdict on a struggling deal (ECO8-05).
 */

declare module '../../core/rng/streams' {
  interface StreamNames {
    'broadcast.viewers': true;
    'broadcast.health': true;
  }
}

/** The stream an airing's viewers roll draws from. */
export const BROADCAST_VIEWERS_STREAM = 'broadcast.viewers';

/** The stream a deal's health verdict draws from. */
export const BROADCAST_HEALTH_STREAM = 'broadcast.health';
