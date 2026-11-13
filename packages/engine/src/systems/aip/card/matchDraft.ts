/**
 * Turning planned sides into a planned match: EVT2's draft (competitors by side, teams, titles,
 * storylines; no stipulations, finish, crew or outcome yet) and the decision labelled with the
 * matchup.
 */

import type { StorylineId, TitleId } from '../../../core/ids';
import type { MatchTypeDef } from '../../../model/catalogs';
import type { GameWorldView } from '../../../model/tables';
import { emptyCrew, type ParticipantDraft } from '../../booking/draft';
import { matchFamilyOf } from './formulas/matchTypeWeight';
import type { BookerNotes } from './notes';
import type { MatchFamily } from './tunables';
import type { CardPool, PlannedSegment, PlannedSegmentSource, PlannedSide } from './types';

/** "Haruto Ise vs Daichi Kuroe", with a team's name for a team side. */
export function matchupLabel(
  pool: CardPool,
  read: GameWorldView,
  sides: readonly PlannedSide[],
): string {
  const names = new Map(
    pool.candidates.map((candidate) => [candidate.personId, candidate.ringName]),
  );
  return sides
    .map((side) => {
      if (side.teamId !== null) {
        const team =
          pool.teams.find((entry) => entry.teamId === side.teamId)?.name ??
          read.tables.teams.get(side.teamId)?.name;
        if (team !== undefined) {
          return team;
        }
      }
      return side.personIds.map((personId) => names.get(personId) ?? personId).join(' & ');
    })
    .join(' vs ');
}

/** The first non-hidden match type of `family`, by display order. */
export function firstTypeOfFamily(
  types: readonly MatchTypeDef[],
  family: MatchFamily,
): MatchTypeDef | undefined {
  return types.find((type) => matchFamilyOf(type) === family);
}

export interface MatchSegmentSpec {
  readonly key: string;
  readonly source: PlannedSegmentSource;
  readonly type: MatchTypeDef;
  readonly sides: readonly PlannedSide[];
  readonly titleIds?: readonly TitleId[];
  readonly storylineIds?: readonly StorylineId[];
  readonly notes: BookerNotes;
  /** The decision's reason: why this type. */
  readonly because: string;
  readonly docRef: string;
}

/** A planned match from its sides. */
export function matchSegment(
  pool: CardPool,
  read: GameWorldView,
  spec: MatchSegmentSpec,
): PlannedSegment {
  const participants: ParticipantDraft[] = spec.sides.flatMap((side, sideIndex) =>
    side.personIds.map((personId) => ({
      personId,
      side: sideIndex,
      role: 'competitor' as const,
      teamId: side.teamId,
    })),
  );
  return {
    key: spec.key,
    kind: 'match',
    draft: {
      kind: 'match',
      label: null,
      storylineIds: [...(spec.storylineIds ?? [])],
      crew: emptyCrew(),
      participants,
      match: {
        matchTypeKey: spec.type.key,
        stipulationKeys: [],
        titleIds: [...(spec.titleIds ?? [])],
        finishKey: null,
      },
      outcome: null,
    },
    source: spec.source,
    trace: spec.notes.decide(
      matchupLabel(pool, read, spec.sides),
      spec.type.name,
      spec.because,
      spec.docRef,
    ),
  };
}
