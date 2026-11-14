/**
 * Storyline rows for screens (CRTV3-01), and who may see what of them.
 *
 * Viewer rules (docs/design/storylines.md#viewer-rules): a viewer who runs the storyline's
 * promotion, or the omniscient viewer, gets the full row. Anyone else gets the public row: name,
 * status, dates, brand and the members with their sides. Heat, the Hot flag, the heat trace, the
 * linked segment count and progress stay null, and the row is never editable.
 */

import { viewerPromotionIds, type Viewer } from '../../core/api/controller';
import type { TraceReader } from '../../core/api/query';
import type { GameDate } from '../../core/date';
import type { BrandId, PersonId, PromotionId, StorylineId } from '../../core/ids';
import type { TraceRef } from '../../core/trace/store';
import type { Alignment, Employment } from '../../model/entities/employment';
import type { Gender } from '../../model/entities/person';
import type { Storyline, StorylineSide, StorylineStatus } from '../../model/entities/storyline';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import type { EngineTunables } from '../tunables';
import { daysSinceProgress } from './context';
import { isHotHeat } from './formulas/hot';
import { storylineHeatTraceRef } from './traceKinds';

/** One member of a storyline, as a screen shows them. */
export interface StorylineMemberView {
  personId: PersonId;
  /** Their ring name at the storyline's promotion, else their default ring name. */
  name: string;
  /** Their side in this story (not their overall alignment). */
  side: StorylineSide;
  /** Their overall alignment at the storyline's promotion, or null when not employed there. */
  alignment: Alignment | null;
  gender: Gender;
  imageRef: string | null;
  /**
   * False when they no longer have an active employment at the storyline's promotion. Shown as a
   * warning; they are never removed automatically.
   */
  stillEmployed: boolean;
}

/** One storyline, as the Storylines desk lists it. */
export interface StorylineRow {
  id: StorylineId;
  promotionId: PromotionId;
  promotionName: string;
  brandId: BrandId | null;
  brandName: string | null;
  name: string;
  status: StorylineStatus;
  startedOn: GameDate;
  endedOn: GameDate | null;
  /** 0-100; null on a public row. */
  heat: number | null;
  /** Heat at or above `storylines.heat.hotFrom`; null on a public row. */
  isHot: boolean | null;
  /** The storyline's heat trace when one is kept; null on a public row. */
  heatTraceRef: TraceRef | null;
  faces: StorylineMemberView[];
  heels: StorylineMemberView[];
  neutrals: StorylineMemberView[];
  /** Kept segments that link the storyline; null on a public row. */
  linkedSegmentCount: number | null;
  /** Null on a public row, or when no segment has moved the story on yet. */
  lastProgressOn: GameDate | null;
  /** Days since the story last moved on (or started); null on a public row or once ended. */
  daysSinceProgress: number | null;
  /** True when the viewer runs the promotion and the storyline is still active. */
  editable: boolean;
}

export interface StorylineRowOptions {
  /** Full row (own promotion or omniscient viewer) or public row. */
  readonly full: boolean;
  /** True when the viewer runs the storyline's promotion and may change it. */
  readonly editable: boolean;
  readonly traces: TraceReader;
  readonly tunables: EngineTunables;
  readonly date: GameDate;
}

/** True when `viewer` sees the full rows of `promotionId`'s storylines. */
export function seesStorylinesOf(
  read: GameWorldView,
  viewer: Viewer,
  promotionId: PromotionId,
): boolean {
  return viewer.kind === 'omniscient' || viewerPromotionIds(read, viewer).includes(promotionId);
}

/**
 * True when `viewer` runs `promotionId` and so may change its storylines. The omniscient viewer
 * sees everything but runs nothing, so it edits nothing.
 */
export function editsStorylinesOf(
  read: GameWorldView,
  viewer: Viewer,
  promotionId: PromotionId,
): boolean {
  return viewerPromotionIds(read, viewer).includes(promotionId);
}

/** The person's active employment at `promotionId` (lowest id when there are several), or null. */
export function activeEmploymentAt(
  read: GameWorldView,
  personId: PersonId,
  promotionId: PromotionId,
): DeepReadonly<Employment> | null {
  let found: DeepReadonly<Employment> | null = null;
  for (const employment of read.tables.employments.lookup('byPerson', personId)) {
    if (
      employment.promotionId === promotionId &&
      employment.status === 'active' &&
      (found === null || compareIds(employment.id, found.id) < 0)
    ) {
      found = employment;
    }
  }
  return found;
}

function memberView(
  read: GameWorldView,
  promotionId: PromotionId,
  personId: PersonId,
  side: StorylineSide,
): StorylineMemberView {
  const person = read.tables.people.require(personId);
  const employment = activeEmploymentAt(read, personId, promotionId);
  return {
    personId,
    name: employment?.ringName ?? person.defaultRingName,
    side,
    alignment: employment?.alignment ?? null,
    gender: person.gender,
    imageRef: person.imageRef,
    stillEmployed: employment !== null,
  };
}

/** Builds one storyline's row, full or public as `options.full` says. */
export function buildStorylineRow(
  read: GameWorldView,
  storyline: DeepReadonly<Storyline>,
  options: StorylineRowOptions,
): StorylineRow {
  const members = storyline.members.map((member) =>
    memberView(read, storyline.promotionId, member.personId, member.side),
  );
  const brand = storyline.brandId === null ? undefined : read.tables.brands.get(storyline.brandId);
  const base = {
    id: storyline.id,
    promotionId: storyline.promotionId,
    promotionName: read.tables.promotions.get(storyline.promotionId)?.name ?? storyline.promotionId,
    brandId: storyline.brandId,
    brandName: brand?.name ?? null,
    name: storyline.name,
    status: storyline.status,
    startedOn: storyline.startedOn,
    endedOn: storyline.endedOn,
    faces: members.filter((member) => member.side === 'face'),
    heels: members.filter((member) => member.side === 'heel'),
    neutrals: members.filter((member) => member.side === 'neutral'),
  };
  if (!options.full) {
    return {
      ...base,
      heat: null,
      isHot: null,
      heatTraceRef: null,
      linkedSegmentCount: null,
      lastProgressOn: null,
      daysSinceProgress: null,
      editable: false,
    };
  }
  const heatRef = storylineHeatTraceRef(storyline.id);
  return {
    ...base,
    heat: storyline.heat,
    isHot: isHotHeat(storyline.heat, options.tunables.get('storylines.heat.hotFrom')),
    heatTraceRef: options.traces.has(heatRef) ? heatRef : null,
    linkedSegmentCount: read.tables.segments.lookup('byStoryline', storyline.id).length,
    lastProgressOn: storyline.lastProgressOn,
    daysSinceProgress:
      storyline.status === 'active' ? daysSinceProgress(storyline, options.date) : null,
    editable: options.editable && storyline.status === 'active',
  };
}

/**
 * List order: active storylines first, hottest first (public rows, with no heat, after) then by
 * name; then ended storylines, most recently ended first, then by name. Ties go by id.
 */
export function compareStorylineRows(left: StorylineRow, right: StorylineRow): number {
  if (left.status !== right.status) {
    return left.status === 'active' ? -1 : 1;
  }
  if (left.status === 'active') {
    const byHeat = (right.heat ?? -1) - (left.heat ?? -1);
    if (byHeat !== 0) return byHeat;
  } else {
    const byEnd = (right.endedOn ?? '').localeCompare(left.endedOn ?? '');
    if (byEnd !== 0) return byEnd;
  }
  return left.name.localeCompare(right.name, 'en') || compareIds(left.id, right.id);
}
