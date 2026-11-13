/**
 * The hype line of the crowd forecast. ECO3 tracks hype; until it is on main the line is a
 * constant 1 so the forecast's Why? still shows it. EVT6-07 swaps in ECO3's hype multiplier here,
 * without touching the formula. Design: docs/design/box-office.md#hype.
 */

import { constantOf, type Traced } from '../../core/trace';
import type { EventInstance } from '../../model/entities/event-instance';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import type { EngineTunables } from '../tunables';

/** Reads the hype multiplier on a show's crowd. */
export type HypeLine = (
  read: GameWorldView,
  instance: DeepReadonly<EventInstance>,
  tunables: EngineTunables,
) => Traced<number>;

/** The hype multiplier on a show's crowd: 1 until ECO3 tracks hype. */
export const hypeLineFor: HypeLine = () => constantOf('Hype', 1, 'Hype is not tracked yet');
