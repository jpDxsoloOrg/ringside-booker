/**
 * The system bundles a game runs with.
 *
 * `defaultSystems` is what the web app and the headless runner pass to `createEngine`. Each game
 * system adds its bundle here as it lands (the reference system comes next, in SIM-11). Order is
 * the registration order: it decides the order gates are listed in and breaks ties between
 * subscriptions of equal priority. Phases run in group-and-order sequence whatever the order here.
 */

import { simSystem } from '../core/api/builtins';
import type { SystemBundle } from '../core/api/system';

export const defaultSystems: readonly SystemBundle[] = Object.freeze([simSystem]);
