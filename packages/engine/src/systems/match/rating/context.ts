/**
 * The rating context: what every rater and rating modifier reads. Read-only.
 *
 * Preview mode (the Match lab) gets a detached stream that never touches the world's RNG; live mode
 * (EVT3, rating a show as it runs) gets the world's `match.rating` stream (`MATCH_RATING_STREAM`).
 * With no stream at all the variance rolls are skipped and the traces say so.
 *
 * Design: docs/design/match-rating.md#pipeline-and-seams.
 */

import type { GameDate } from '../../../core/date';
import type { RngStream } from '../../../core/rng/registry';
import type { AngleTypeDef, MatchTypeDef } from '../../../model/catalogs';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import type { DurationClass, SlotRole } from '../slots';
import type { RatingPolicy } from './policy';
import type { SegmentKind, SegmentRatingInput, SlotDerivation } from './types';

/** Preview: the lab, nothing is written. Live: a show being run (EVT3). */
export type RatingMode = 'preview' | 'live';

export interface RatingContext {
  readonly mode: RatingMode;
  /** The seed a preview's detached stream was made from; carried for the lab's "Run x100". */
  readonly seed: string;
  readonly read: GameWorldView;
  /** The show's date (`input.event.date`): injuries are judged on it. */
  readonly date: GameDate;
  readonly tunables: EngineTunables;
  readonly input: SegmentRatingInput;
  readonly segmentKind: SegmentKind;
  /** Set for a match. */
  readonly matchType?: MatchTypeDef;
  /** Set for a talking segment. */
  readonly angleType?: AngleTypeDef;
  readonly durationClass: DurationClass;
  readonly role: SlotRole;
  /** The role, class and weight with their traces. */
  readonly slot: SlotDerivation;
  readonly policy: RatingPolicy;
  /** The stream the variance rolls draw from, or null to skip them. */
  readonly rng: RngStream | null;
}
