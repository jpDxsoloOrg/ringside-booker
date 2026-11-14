/**
 * The titles system's stored traces. `titles.prestige` (keyed by title) explains a belt's current
 * prestige: where it started, and later (CRTV2) how it moved. It is the Why? behind the prestige
 * number on the Titles screen.
 *
 * Design: docs/design/titles.md#starting-prestige.
 */

import type { TitleId, TitleReignId } from '../../core/ids';
import { startCalc } from '../../core/trace/calc';
import { traced } from '../../core/trace/helpers';
import { tunableNode } from '../../core/trace/tunable-node';
import type { TraceRef } from '../../core/trace/store';
import type { Traced } from '../../core/trace/types';
import type { EngineTunables } from '../tunables';
import { STARTING_PRESTIGE_DOC_REF } from './formulas/startingPrestige';

export const TITLE_PRESTIGE_TRACE_KIND = 'titles.prestige';

/** Where a title's prestige Why? is stored. */
export function titlePrestigeTraceRef(titleId: TitleId): TraceRef {
  return { kind: TITLE_PRESTIGE_TRACE_KIND, id: titleId };
}

export const TITLE_VACANCY_TRACE_KIND = 'titles.vacancy';

/**
 * Where the Why? of a reign that ended `vacated` is stored (CRTV1-03): who vacated it, or the
 * orphaned-champion rule's lines. The lineage (CRTV1-02) shows it on "Vacated".
 */
export function titleVacancyTraceRef(reignId: TitleReignId): TraceRef {
  return { kind: TITLE_VACANCY_TRACE_KIND, id: reignId };
}

/**
 * The prestige of a founded promotion's starter title: just `newgame.found.titlePrestige`. A
 * founded promotion has no prestige of its own to scale by, so its first belt starts from the
 * new-game number rather than `startingPrestige`.
 */
export function founderTitlePrestige(tunables: EngineTunables): Traced<number> {
  const key = 'newgame.found.titlePrestige';
  return startCalc(
    'Starting prestige',
    traced(tunables.get(key), tunableNode(tunables, key, 'Starter title for a new promotion')),
    { unit: 'points', docRef: STARTING_PRESTIGE_DOC_REF },
  ).done();
}
