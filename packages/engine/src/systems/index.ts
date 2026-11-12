/**
 * The system bundles a game runs with.
 *
 * `defaultSystems` is what the web app and the headless runner pass to `createEngine`. Each game
 * system adds its bundle here as it lands; `conditionSystem` is the reference system the others
 * copy. Order is the registration order: it decides the order gates are listed in and breaks ties
 * between subscriptions of equal priority. Phases run in group-and-order sequence whatever the
 * order here.
 */

import { simSystem } from '../core/api/builtins';
import type { SystemBundle } from '../core/api/system';
import { calendarSystem } from './calendar';
import { conditionSystem } from './condition';
import { matchSystem } from './match';
import { showsSystem } from './shows';
import { workersSystem } from './workers';

export { calendarSystem, conditionSystem, matchSystem, workersSystem };
export { showsSystem };

export const defaultSystems: readonly SystemBundle[] = Object.freeze([
  simSystem,
  conditionSystem,
  workersSystem,
  calendarSystem,
  matchSystem,
  showsSystem,
]);
