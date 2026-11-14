/**
 * The system bundles a game runs with.
 *
 * `defaultSystems` is what the web app and the headless runner pass to `createEngine`. Each game
 * system adds its bundle here as it lands; `healthSystem` is the reference system the others
 * copy. Order is the registration order: it decides the order gates are listed in and breaks ties
 * between subscriptions of equal priority. Phases run in group-and-order sequence whatever the
 * order here.
 */

import { simSystem } from '../core/api/builtins';
import type { SystemBundle } from '../core/api/system';
import { bookingSystem } from './booking';
import { calendarSystem } from './calendar';
import { healthSystem } from './health';
import { matchSystem } from './match';
import { showsSystem } from './shows';
import { workersSystem } from './workers';
import { financeSystem } from './finance';
import { promoPopSystem } from './promoPop';
import { boxOfficeSystem } from './boxOffice';
import { officeSystem } from './office';
import { rosterSystem } from './roster';
import { aipSystem } from './aip';
import { historySystem } from './history';
import { cardFlowSystem } from './cardFlow';
import { productionSystem } from './production';
import { contractsSystem } from './contracts';
import { negotiationSystem } from './negotiation';
import { titlesSystem } from './titles';
import { storylinesSystem } from './storylines';
import { newsSystem } from './news';

export { calendarSystem, healthSystem, matchSystem, workersSystem };
export { bookingSystem };
export { showsSystem };
export { financeSystem };
export { promoPopSystem };
export { boxOfficeSystem };
export { officeSystem };
export { rosterSystem };
export { aipSystem };
export { historySystem };
export { cardFlowSystem };
export { productionSystem };
export { contractsSystem };
export { negotiationSystem };
export { titlesSystem };
export { storylinesSystem };
export { newsSystem };

export const defaultSystems: readonly SystemBundle[] = Object.freeze([
  simSystem,
  healthSystem,
  workersSystem,
  titlesSystem,
  calendarSystem,
  matchSystem,
  bookingSystem,
  showsSystem,
  financeSystem,
  promoPopSystem,
  boxOfficeSystem,
  officeSystem,
  rosterSystem,
  aipSystem,
  historySystem,
  cardFlowSystem,
  productionSystem,
  contractsSystem,
  negotiationSystem,
  storylinesSystem,
  newsSystem,
]);
