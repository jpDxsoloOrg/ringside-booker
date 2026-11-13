/**
 * Injury severity: how bad an injury is, rolled from its kind's severity weights or set by the
 * caller (a match that knows how bad the injury was).
 *
 * Design: docs/design/health.md#injuries.
 */

import type { RngStream } from '../../../core/rng/registry';
import { rollWeighted } from '../../../core/rng/rolls';
import { startDecision } from '../../../core/trace/decision';
import type { Traced } from '../../../core/trace/types';
import { INJURY_SEVERITIES, type InjurySeverity } from '../../../model/catalogs';
import { HEALTH_DOC } from './shared';

export const INJURY_DOC_REF = `${HEALTH_DOC}#injuries`;

/** The rule line when the caller set the severity. */
export const SEVERITY_SET_BY_MATCH = 'Set by the match';

/** "Minor", "Moderate", "Severe". */
export function severityLabel(severity: InjurySeverity): string {
  return `${severity.charAt(0).toUpperCase()}${severity.slice(1)}`;
}

export interface InjurySeverityInputs {
  /** The injury kind's `severityWeights`. Not all 0 (the catalog schema checks it). */
  weights: Readonly<Record<InjurySeverity, number>>;
  /** A severity the caller has already decided; nothing is rolled. */
  forced?: InjurySeverity;
}

/**
 * The injury's severity. A forced severity is a rule ("Set by the match") and draws nothing;
 * otherwise one weighted roll over minor, moderate and severe draws once from `deps.rng`.
 */
export function decideInjurySeverity(
  inputs: InjurySeverityInputs,
  deps: { rng: RngStream },
): Traced<InjurySeverity> {
  const decision = startDecision<InjurySeverity>('Severity', { docRef: INJURY_DOC_REF });
  for (const severity of INJURY_SEVERITIES) {
    decision.consider(severity, inputs.weights[severity], 'Weight in the injury catalog');
  }
  if (inputs.forced !== undefined) {
    return decision.rule(SEVERITY_SET_BY_MATCH, true).choose(inputs.forced, SEVERITY_SET_BY_MATCH);
  }
  const rolled = rollWeighted(
    deps.rng,
    INJURY_SEVERITIES.map((severity) => ({ item: severity, weight: inputs.weights[severity] })),
    'Severity roll',
    severityLabel,
  );
  return decision.roll(rolled.roll).choose(rolled.value, 'The severity roll');
}
