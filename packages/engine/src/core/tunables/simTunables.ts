/**
 * The engine's own tunables: limits for traces, logs and the day loop. Game systems define their
 * balance numbers in `systems/<name>/tunables.ts`; these are the ones that belong to the simulation
 * core itself.
 */

import { defineTunables } from './define';

const SIM_CATEGORY = 'Simulation';
const SIM_DOC = 'tunables.md#engine-tunables';

export const simTunables = defineTunables({
  'sim.traceRetentionPerKind': {
    kind: 'integer',
    default: 200,
    min: 0,
    max: 5000,
    unit: 'count',
    category: SIM_CATEGORY,
    description:
      'How many full calculation traces are kept for each kind of result (match rating, attendance, and so on). Older ones are summarised.',
    docRef: SIM_DOC,
  },
  'sim.traceBytesPerKind': {
    kind: 'integer',
    default: 500_000,
    min: 0,
    max: 100_000_000,
    unit: 'count',
    category: SIM_CATEGORY,
    description:
      'How many characters of saved explanation each kind of result may keep in full. Past it, the oldest are summarised, so kinds with big breakdowns keep fewer of them.',
    docRef: SIM_DOC,
  },
  'sim.traceSummaryLimit': {
    kind: 'integer',
    default: 5000,
    min: 0,
    max: 100000,
    unit: 'count',
    category: SIM_CATEGORY,
    description:
      'How many trace summaries are kept in the save as history after their full traces are dropped.',
    docRef: SIM_DOC,
  },
  'sim.eventLogSize': {
    kind: 'integer',
    default: 500,
    min: 0,
    max: 10000,
    unit: 'count',
    category: SIM_CATEGORY,
    description:
      'How many recent domain events (title changes, signings, injuries) the save keeps.',
    docRef: SIM_DOC,
  },
  'sim.maxEventCascadeDepth': {
    kind: 'integer',
    default: 8,
    min: 1,
    max: 32,
    unit: 'count',
    category: SIM_CATEGORY,
    description:
      'How deep a chain of events can go (an event whose handler publishes another event) before the rest of the chain is stopped and reported.',
    docRef: SIM_DOC,
  },
  'sim.stopSkipAfterConsecutiveFailures': {
    kind: 'integer',
    default: 3,
    min: 1,
    max: 365,
    unit: 'days',
    category: SIM_CATEGORY,
    description:
      'A multi-day skip stops after the same day phase has failed this many days in a row.',
    docRef: SIM_DOC,
  },
  'sim.commandLogSize': {
    kind: 'integer',
    default: 1000,
    min: 0,
    max: 100000,
    unit: 'count',
    category: SIM_CATEGORY,
    description: 'How many recent player and computer commands the save keeps in its command log.',
    docRef: SIM_DOC,
  },
});
