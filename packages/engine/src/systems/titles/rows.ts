/**
 * The title card row every titles screen shows (CRTV1-02), and the small labels it is built from:
 * the division in words, why a reign ended, and the Why? behind a title's prestige.
 *
 * Titles and lineages are public in the game world, so a row looks the same to every viewer except
 * for `editable`, which only the promotion's own controller gets.
 *
 * Design: docs/design/titles.md#queries.
 */

import type { Viewer } from '../../core/api/controller';
import { controlsPromotion } from '../../core/api/controller';
import type { TraceReader } from '../../core/api/query';
import { compareDates, type GameDate } from '../../core/date';
import type { BrandId, PersonId, PromotionId, TeamId, TitleId, TitleReignId } from '../../core/ids';
import { startCalc } from '../../core/trace/calc';
import { inputOf } from '../../core/trace/helpers';
import type { TraceRef } from '../../core/trace/store';
import type { TraceNode } from '../../core/trace/types';
import type {
  Title,
  TitleDivision,
  TitleHolderCount,
  TitleStatus,
} from '../../model/entities/title';
import type { TitleReign } from '../../model/entities/title-reign';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import type { EngineTunables } from '../tunables';
import { WEIGHT_CLASS_LABELS, weightClass } from '../workers/formulas/weightClass';
import { reignDays } from './formulas/reignDays';
import { ringNameForTitle } from './helpers/employment';
import { currentReign, reignLabel } from './helpers/holders';
import { titlePrestigeTraceRef } from './traces';

/** What the row builders read. A `QueryContext` fits. */
export interface TitleRowContext {
  readonly read: GameWorldView;
  readonly viewer: Viewer;
  readonly tunables: EngineTunables;
  readonly traces: Pick<TraceReader, 'has'>;
}

/** One current champion on a card. */
export interface TitleCardHolder {
  personId: PersonId;
  /** Their ring name with the title's promotion today. */
  ringName: string;
  imageRef: string | null;
}

/** The current reign on a card. */
export interface TitleCardChampion {
  reignId: TitleReignId;
  holders: TitleCardHolder[];
  teamId: TeamId | null;
  /** `reignLabel`: the team's name, or the names they won it under. */
  label: string;
  wonOn: GameDate;
  /** 0 = won today. */
  daysHeld: number;
  defences: number;
}

/** One title as a card. Plain JSON. */
export interface TitleCardRow {
  titleId: TitleId;
  name: string;
  promotionId: PromotionId;
  promotionName: string;
  brandId: BrandId | null;
  /** Null for a promotion-wide title. */
  brandName: string | null;
  holderCount: TitleHolderCount;
  division: TitleDivision;
  /** "Women's", "Open", "Cruiserweight: up to 93 kg". */
  divisionLabel: string;
  prestige: number;
  /** The stored Why? for the prestige; exactly one of this and `prestigeTrace` is set. */
  prestigeTraceRef: TraceRef | null;
  /** A short inline Why? when nothing is stored. */
  prestigeTrace: TraceNode | null;
  status: TitleStatus;
  introducedOn: GameDate;
  retiredOn: GameDate | null;
  imageRef: string | null;
  color: string;
  /** True only for the promotion's own controller; screens show every action only then. */
  editable: boolean;
  /** Null = vacant. */
  champion: TitleCardChampion | null;
}

export const PRESTIGE_WORLD_FILE_LABEL = 'Prestige set by the world file';
export const PRESTIGE_TODAY_LABEL = 'Prestige today';
export const PRESTIGE_NOT_KEPT_NOTE = 'The full breakdown is only kept for recent changes';

/**
 * The Why? behind a title's prestige. The stored `titles.prestige` trace when there is one;
 * otherwise a short inline trace: "set by the world file" for a title that was there when the game
 * began, or "prestige today" with a note that the breakdown is no longer kept. Never both null.
 */
export function prestigeExplanation(
  ctx: Pick<TitleRowContext, 'read' | 'traces'>,
  title: DeepReadonly<Title>,
): { prestigeTraceRef: TraceRef | null; prestigeTrace: TraceNode | null } {
  const ref = titlePrestigeTraceRef(title.id);
  if (ctx.traces.has(ref)) {
    return { prestigeTraceRef: ref, prestigeTrace: null };
  }
  const subject = { kind: 'title', id: title.id } as const;
  if (compareDates(title.introducedOn, ctx.read.meta.startDate) <= 0) {
    return {
      prestigeTraceRef: null,
      prestigeTrace: inputOf(PRESTIGE_WORLD_FILE_LABEL, title.prestige, subject, 'points').trace,
    };
  }
  const today = inputOf(PRESTIGE_TODAY_LABEL, title.prestige, subject, 'points');
  return {
    prestigeTraceRef: null,
    prestigeTrace: startCalc('Prestige', today, { unit: 'points' })
      .note(PRESTIGE_NOT_KEPT_NOTE)
      .done().trace,
  };
}

/** Name order for lists: English, numbers by value ("Title 2" before "Title 10"). */
export function compareNames(left: string, right: string): number {
  return left.localeCompare(right, 'en', { numeric: true });
}

const GENDER_LABELS = { open: 'Open', male: "Men's", female: "Women's" } as const;

function formatKg(weightKg: number): string {
  return `${String(weightKg)} kg`;
}

/**
 * Who may hold the title, in words. The gender part ("Open", "Men's", "Women's"), and for a weight
 * limit the weight class of the top limit and the limits: "Cruiserweight: up to 93 kg",
 * "Women's, Lightweight: up to 70 kg", "Heavyweight: 100 kg and over", "Heavyweight: 100 to 130 kg".
 * An open division with a weight limit shows only the weight part.
 */
export function divisionLabel(
  division: DeepReadonly<TitleDivision>,
  tunables: EngineTunables,
): string {
  const { gender, minWeightKg, maxWeightKg } = division;
  if (minWeightKg === null && maxWeightKg === null) {
    return GENDER_LABELS[gender];
  }
  const classWeight = maxWeightKg ?? minWeightKg ?? 0;
  const className = WEIGHT_CLASS_LABELS[weightClass({ weightKg: classWeight }, { tunables }).value];
  let limits: string;
  if (minWeightKg !== null && maxWeightKg !== null) {
    limits = `${String(minWeightKg)} to ${formatKg(maxWeightKg)}`;
  } else if (maxWeightKg !== null) {
    limits = `up to ${formatKg(maxWeightKg)}`;
  } else {
    limits = `${formatKg(classWeight)} and over`;
  }
  const weightPart = `${className}: ${limits}`;
  return gender === 'open' ? weightPart : `${GENDER_LABELS[gender]}, ${weightPart}`;
}

/**
 * Why a reign ended, in words. `retired` covers a retired title and a retired champion: the
 * reign that ended on the title's `retiredOn` went with the title.
 */
export function endReasonLabel(
  reign: Pick<DeepReadonly<TitleReign>, 'lostOn' | 'endReason'>,
  title: Pick<DeepReadonly<Title>, 'retiredOn'>,
): string {
  if (reign.lostOn === null || reign.endReason === null) {
    return 'Current champion';
  }
  switch (reign.endReason) {
    case 'lost':
      return 'Lost the title';
    case 'vacated':
      return 'Vacated';
    case 'stripped':
      return 'Stripped';
    case 'unified':
      return 'Unified';
    case 'retired':
      return reign.lostOn === title.retiredOn ? 'Title retired' : 'Champion retired';
  }
}

/** True when the viewer may change titles of `promotionId`. Omniscient is read-only. */
export function viewerEditsTitlesOf(
  read: GameWorldView,
  viewer: Viewer,
  promotionId: PromotionId,
): boolean {
  return viewer.kind === 'controller' && controlsPromotion(read, promotionId, viewer.controller);
}

function championOf(ctx: TitleRowContext, title: DeepReadonly<Title>): TitleCardChampion | null {
  const reign = currentReign(ctx.read, title.id);
  if (reign === null) {
    return null;
  }
  const today = ctx.read.meta.currentDate;
  return {
    reignId: reign.id,
    holders: reign.holderIds.map((personId) => ({
      personId,
      ringName: ringNameForTitle(ctx.read, personId, title.promotionId, today),
      imageRef: ctx.read.tables.people.get(personId)?.imageRef ?? null,
    })),
    teamId: reign.teamId,
    label: reignLabel(ctx.read, reign),
    wonOn: reign.wonOn,
    daysHeld: reignDays({ wonOn: reign.wonOn, lostOn: null, today }).value,
    defences: reign.defences,
  };
}

/** One title as a card for this viewer. */
export function buildTitleCardRow(ctx: TitleRowContext, title: DeepReadonly<Title>): TitleCardRow {
  const { read } = ctx;
  const brand = title.brandId === null ? undefined : read.tables.brands.get(title.brandId);
  return {
    titleId: title.id,
    name: title.name,
    promotionId: title.promotionId,
    promotionName: read.tables.promotions.get(title.promotionId)?.name ?? title.promotionId,
    brandId: title.brandId,
    brandName: brand?.name ?? null,
    holderCount: title.holderCount,
    division: { ...title.division },
    divisionLabel: divisionLabel(title.division, ctx.tunables),
    prestige: title.prestige,
    ...prestigeExplanation(ctx, title),
    status: title.status,
    introducedOn: title.introducedOn,
    retiredOn: title.retiredOn,
    imageRef: title.imageRef,
    color: title.color,
    editable: viewerEditsTitlesOf(read, ctx.viewer, title.promotionId),
    champion: championOf(ctx, title),
  };
}
