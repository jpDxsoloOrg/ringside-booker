/**
 * Small pieces the health formulas share.
 */

import { traced } from '../../../core/trace/helpers';
import { tunableNode } from '../../../core/trace/tunable-node';
import type { Traced } from '../../../core/trace/types';
import type { EngineTunables, NumberTunableKey } from '../../tunables';

/** The design doc every health formula points at. */
export const HEALTH_DOC = 'docs/design/health.md';

/** A tunable's value as a traced number, to start a calculation from. */
export function tunableStart(
  tunables: EngineTunables,
  key: NumberTunableKey,
  label: string,
): Traced<number> {
  return traced(tunables.get(key), tunableNode(tunables, key, label));
}

/** Branch labels used when the world's aging setting is off (WLD-13). */
export const AGING_OFF = 'Aging is off in this world';
