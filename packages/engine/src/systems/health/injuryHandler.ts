/**
 * `health.injure` as MTCH4's injury handler (WRK6-03): an injured worker from the in-match roll
 * becomes a real injury. Registered once, on import, as the built-in handler, so the show-night
 * applier finds it whenever the health system is loaded; tests of MTCH4's seam can clear it and
 * put it back (`clearInjuryHandler`, `restoreBuiltInInjuryHandler`).
 *
 * The match's body part hint narrows the kind roll to injuries on that part (any kind when the
 * catalog has none there). Someone already injured is not hurt again: the handler returns no trace
 * ref and the match reports them as already injured.
 *
 * Design: docs/design/health.md#injuries, docs/design/physical-toll.md#the-injury-roll.
 */

import { registerInjuryHandler, type InjuryHandler } from '../match/physical/injuries';
import { injure, injuryTraceRef } from './injure';

export const HEALTH_INJURY_HANDLER_ID = 'health.injure';

export const healthInjuryHandler: InjuryHandler = {
  id: HEALTH_INJURY_HANDLER_ID,
  apply: (ctx, request) => {
    const result = injure(ctx, request.personId, {
      source: 'segment',
      segmentId: request.segmentId,
      bodyPart: request.bodyPartHint,
      chanceTrace: request.chanceTrace,
    });
    return { injuryTraceRef: result.ok ? injuryTraceRef(result.injuryId) : null };
  },
};

registerInjuryHandler(healthInjuryHandler, { builtIn: true });
