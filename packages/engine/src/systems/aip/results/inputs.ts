/**
 * What AIP5's winner and title formulas read about one planned rival match.
 *
 * `rivalSegmentInputsOf` turns a segment on a rival card into plain inputs: the show, each side
 * (card values, top push, alignment, featured role), the storylines it belongs to and, for a title
 * match, each title's reign, prestige, contract days and challengers. Pure reads, ids sorted, so
 * two calls on the same world give the same answer and the result is plain JSON.
 *
 * Title eligibility comes only from WRK1's helpers (`isEligibleForTitle`, `availabilityOf`): no
 * local gender or weight checks. Contract days use real dates, `diffDays(date, endsOn)`.
 * See docs/design/rival-booking.md#inputs.
 */

import type { Reason } from '../../../core/api/result';
import { diffDays, type GameDate } from '../../../core/date';
import type {
  BrandId,
  EmploymentId,
  PersonId,
  PromotionId,
  RegionId,
  SegmentId,
  StorylineId,
  TitleId,
  TitleReignId,
} from '../../../core/ids';
import { constantOf, startCalc, type Traced } from '../../../core/trace';
import type { EventImportance } from '../../../model/entities/event-definition';
import type { Alignment, Employment, Push } from '../../../model/entities/employment';
import type { Featured } from '../../../model/entities/ai-profile';
import type { Participant } from '../../../model/entities/participant';
import type { Title } from '../../../model/entities/title';
import { compareIds } from '../../../model/table';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import type { EngineTunables } from '../../tunables';
import { geographyOf } from '../../world/geography';
import { formatNumber } from '../../world/people/labels';
import { availabilityOf } from '../../workers/helpers/availability';
import { isEligibleForTitle } from '../../workers/helpers/eligibility';
import { cardValue, marketPopularity, type CardValueInputs } from '../formulas/cardValue';
import type { TracedTaste } from '../formulas/defaultTaste';
import { cardValueInputsFor, deciderBrandOf, employmentAt, openReignOf } from '../inputs';
import { profileOf } from '../profiles';
import { tasteOf } from '../taste';
import { TITLE_CHANGES_DOC_REF } from './tunables';

/** A side's top push as a number: main event 5 down to none 0. */
export const PUSH_INDEX: Readonly<Record<Push, number>> = {
  mainEvent: 5,
  upperCard: 4,
  midCard: 3,
  lowerCard: 2,
  enhancement: 1,
  none: 0,
};

export type FeaturedRole = 'ace' | 'prospect';

/** One side of a rival match. */
export interface RivalSide {
  /** The participants' `side`. */
  readonly side: number;
  /** Ring names joined with " & ". */
  readonly label: string;
  /** Competitors on the side, by id. */
  readonly personIds: PersonId[];
  /** Each competitor's card value at the promotion, in `personIds` order. */
  readonly cardValues: Traced<number>[];
  /** The side's top push: main event 5, upper card 4, midcard 3, lower card 2, enhancement 1, none 0. */
  readonly pushIndex: number;
  /** The majority alignment, else tweener. */
  readonly alignment: Alignment;
  /** The side's featured role; prospect when it has both a prospect and the ace. */
  readonly featured: FeaturedRole | null;
}

/** A storyline the match belongs to. */
export interface RivalStorylineContext {
  readonly storylineId: StorylineId;
  readonly name: string;
  /** Days since the storyline started. */
  readonly ageDays: number;
  /**
   * True when the storyline names this segment as its finale, false when it names another, null
   * when it names none (or the save has no finale field yet).
   */
  readonly finaleFlag: boolean | null;
  /** Sides holding a member on the face side of the story. */
  readonly faceSides: number[];
  /** Sides holding a member on the heel side of the story. */
  readonly heelSides: number[];
}

/** The title's current reign. */
export interface RivalOpenReign {
  readonly reignId: TitleReignId;
  readonly wonOn: GameDate;
  readonly reignDays: number;
  readonly holderIds: PersonId[];
}

/** A side that could take the title. */
export interface RivalChallengerSide {
  readonly side: number;
  /** Mean of each competitor's popularity in the promotion's markets. */
  readonly marketPopularity: Traced<number>;
  /** Why someone on the side may not hold the title or cannot work; empty when nothing stops it. */
  readonly eligibility: Reason[];
  /** The fewest contract days left on the side; null when every contract is open-ended. */
  readonly contractDaysLeft: number | null;
}

/** One title on the line. */
export interface RivalTitleContext {
  readonly titleId: TitleId;
  readonly name: string;
  readonly prestige: number;
  readonly holderCount: number;
  readonly openReign: RivalOpenReign | null;
  /** The side holding every champion, or null (vacant, or the champions are not on one side). */
  readonly championSide: number | null;
  /** The fewest contract days the champions have left; null when every contract is open-ended. */
  readonly championContractDaysLeft: number | null;
  /** Every side but the champions'. */
  readonly challengerSides: RivalChallengerSide[];
}

/** Everything AIP5's formulas read about one rival match. */
export interface RivalSegmentInputs {
  readonly segmentId: SegmentId;
  readonly date: GameDate;
  readonly importance: EventImportance;
  readonly promotionId: PromotionId;
  readonly brandId: BrandId | null;
  readonly regionId: RegionId;
  /** The booker's title tempo: the `titleFocus` taste axis. */
  readonly titleTaste: Traced<number>;
  readonly sides: RivalSide[];
  readonly storylines: RivalStorylineContext[];
  /** By prestige, highest first, then id. */
  readonly titles: RivalTitleContext[];
}

/** The trace label of the booker's title tempo. */
export const STORED_TITLE_TASTE_LABEL = "Booker's title taste";
export const STYLE_TITLE_TASTE_LABEL = 'Title taste (style default)';

/** The booker's title tempo: AIP1's `titleFocus` axis, labelled by where the taste came from. */
export function titleTasteOf(taste: TracedTaste): Traced<number> {
  const label = taste.source === 'stored' ? STORED_TITLE_TASTE_LABEL : STYLE_TITLE_TASTE_LABEL;
  return startCalc(
    label,
    { value: taste.values.titleFocus, trace: taste.traces.titleFocus },
    { unit: 'points', docRef: TITLE_CHANGES_DOC_REF },
  ).done();
}

/** The featured role of each employment, or an empty map before AIP3 names anyone. */
function featuredRoles(featured: DeepReadonly<Featured> | null): Map<EmploymentId, FeaturedRole> {
  const roles = new Map<EmploymentId, FeaturedRole>();
  if (featured === null) {
    return roles;
  }
  if (featured.ace !== null) {
    roles.set(featured.ace.employmentId, 'ace');
  }
  for (const prospect of featured.prospects) {
    roles.set(prospect.employmentId, 'prospect');
  }
  return roles;
}

function majorityAlignment(alignments: readonly Alignment[]): Alignment {
  for (const alignment of ['face', 'heel'] as const) {
    const count = alignments.filter((entry) => entry === alignment).length;
    if (count * 2 > alignments.length) {
      return alignment;
    }
  }
  return 'tweener';
}

/** The smallest `diffDays(date, endsOn)` over the contracts with an end; null when none has one. */
function fewestDaysLeft(
  employments: readonly (DeepReadonly<Employment> | null)[],
  date: GameDate,
): number | null {
  let fewest: number | null = null;
  for (const employment of employments) {
    if (employment?.endsOn === null || employment?.endsOn === undefined) {
      continue;
    }
    const days = diffDays(date, employment.endsOn);
    if (fewest === null || days < fewest) {
      fewest = days;
    }
  }
  return fewest;
}

/** A person row as the world hands it out. */
type PersonRow = ReturnType<GameWorldView['tables']['people']['require']>;
/** A storyline row as the world hands it out. */
type StorylineRow = ReturnType<GameWorldView['tables']['storylines']['require']>;

/** One competitor with their contract at the promotion (null when they have none). */
interface Competitor {
  readonly person: PersonRow;
  readonly employment: DeepReadonly<Employment> | null;
  readonly name: string;
}

interface SideDraft {
  readonly side: number;
  readonly competitors: Competitor[];
}

function sidesOf(
  read: GameWorldView,
  participants: readonly DeepReadonly<Participant>[],
  promotionId: PromotionId,
  date: GameDate,
): SideDraft[] {
  const bySide = new Map<number, PersonId[]>();
  for (const participant of participants) {
    if (participant.role !== 'competitor') {
      continue;
    }
    const list = bySide.get(participant.side) ?? [];
    list.push(participant.personId);
    bySide.set(participant.side, list);
  }
  return [...bySide.entries()]
    .sort(([left], [right]) => left - right)
    .map(([side, personIds]) => ({
      side,
      competitors: [...personIds].sort(compareIds).map((personId) => {
        const person = read.tables.people.require(personId);
        const employment = employmentAt(read, personId, promotionId, date);
        return { person, employment, name: employment?.ringName ?? person.defaultRingName };
      }),
    }));
}

/**
 * The storyline's finale segment, read without assuming the field exists: CRTV3 adds
 * `finaleSegmentId`; before it, every storyline answers null.
 */
function finaleSegmentOf(storyline: StorylineRow): string | null {
  const fields: Readonly<Record<string, unknown>> = storyline;
  const value = fields['finaleSegmentId'];
  return typeof value === 'string' ? value : null;
}

function storylineContextOf(
  storyline: StorylineRow,
  segmentId: SegmentId,
  sides: readonly SideDraft[],
  date: GameDate,
): RivalStorylineContext {
  const finale = finaleSegmentOf(storyline);
  const sidesOn = (storySide: 'face' | 'heel'): number[] =>
    sides
      .filter((side) =>
        side.competitors.some((competitor) =>
          storyline.members.some(
            (member) => member.personId === competitor.person.id && member.side === storySide,
          ),
        ),
      )
      .map((side) => side.side);
  return {
    storylineId: storyline.id,
    name: storyline.name,
    ageDays: diffDays(storyline.startedOn, date),
    finaleFlag: finale === null ? null : finale === segmentId,
    faceSides: sidesOn('face'),
    heelSides: sidesOn('heel'),
  };
}

/** Everything that stops a side holding the title or working tonight, as WRK1 words it. */
function eligibilityOf(side: SideDraft, title: DeepReadonly<Title>, date: GameDate): Reason[] {
  const reasons: Reason[] = [];
  for (const competitor of side.competitors) {
    reasons.push(...isEligibleForTitle(competitor.person, title));
    const availability = availabilityOf(competitor.person, competitor.employment, date);
    if (availability.status !== 'available') {
      reasons.push({
        code: availability.status,
        message: availability.reason,
        subject: { kind: 'person', id: competitor.person.id },
      });
    }
  }
  return reasons;
}

/** The side's mean popularity in the promotion's markets. */
function sideMarketPopularity(
  side: SideDraft,
  label: string,
  market: Pick<CardValueInputs, 'promotionName' | 'promotionPop' | 'regions'>,
  tunables: EngineTunables,
): Traced<number> {
  const calc = startCalc(`Market popularity of ${label}`, 0, {
    unit: 'points',
    docRef: TITLE_CHANGES_DOC_REF,
    startLabel: 'Nothing counted yet',
  });
  for (const competitor of side.competitors) {
    const popularity = marketPopularity(
      { ...market, workerPop: competitor.person.regionalPop },
      { tunables },
    );
    calc.add(`${competitor.name} ${formatNumber(popularity.value)}`, popularity);
  }
  if (side.competitors.length > 1) {
    calc.divide(
      'Mean of the side',
      constantOf('Wrestlers on the side', side.competitors.length, 'A side counts as its mean'),
    );
  }
  return calc.done();
}

function sideLabel(side: SideDraft): string {
  return side.competitors.map((competitor) => competitor.name).join(' & ');
}

/**
 * The inputs of one planned rival match, or null for an angle, a missing segment and a match with
 * fewer than two competitor sides.
 */
export function rivalSegmentInputsOf(
  read: GameWorldView,
  tunables: EngineTunables,
  segmentId: SegmentId,
  date: GameDate,
): RivalSegmentInputs | null {
  const segment = read.tables.segments.get(segmentId);
  if (segment?.kind !== 'match') {
    return null;
  }
  const instance = read.tables.eventInstances.require(segment.eventInstanceId);
  const { promotionId } = instance;
  const sides = sidesOf(
    read,
    read.tables.participants.lookup('bySegment', segment.id),
    promotionId,
    date,
  );
  if (sides.length < 2) {
    return null;
  }

  const promotion = read.tables.promotions.require(promotionId);
  const regions = geographyOf(read).regions;
  const deciderBrand = deciderBrandOf(read, instance);
  const taste = tasteOf(read, tunables, promotionId, deciderBrand);
  const featured = featuredRoles(profileOf(read, promotionId, deciderBrand)?.featured ?? null);

  const rivalSides: RivalSide[] = sides.map((side) => {
    const roles = side.competitors.map((competitor) =>
      competitor.employment === null ? undefined : featured.get(competitor.employment.id),
    );
    return {
      side: side.side,
      label: sideLabel(side),
      personIds: side.competitors.map((competitor) => competitor.person.id),
      cardValues: side.competitors.map((competitor) =>
        competitor.employment === null
          ? constantOf(
              `Card value of ${competitor.name}`,
              0,
              `${competitor.name} has no contract with ${promotion.name}`,
            )
          : cardValue(
              cardValueInputsFor(read, tunables, competitor.employment, date, { regions, taste }),
              { tunables },
            ),
      ),
      pushIndex: Math.max(
        ...side.competitors.map((competitor) =>
          competitor.employment === null ? 0 : PUSH_INDEX[competitor.employment.push],
        ),
      ),
      alignment: majorityAlignment(
        side.competitors.map((competitor) => competitor.employment?.alignment ?? 'tweener'),
      ),
      featured: roles.includes('prospect') ? 'prospect' : roles.includes('ace') ? 'ace' : null,
    };
  });

  const storylines: RivalStorylineContext[] = [...segment.storylineIds]
    .sort(compareIds)
    .map((storylineId) => read.tables.storylines.get(storylineId))
    .filter(
      (storyline): storyline is StorylineRow =>
        storyline?.status === 'active' && storyline.promotionId === promotionId,
    )
    .map((storyline) => storylineContextOf(storyline, segment.id, sides, date));

  const titles: RivalTitleContext[] = segment.match.titleIds
    .map((titleId) => read.tables.titles.require(titleId))
    .sort((left, right) => right.prestige - left.prestige || compareIds(left.id, right.id))
    .map((title) => {
      const reign = openReignOf(read, title.id);
      const holders = reign === null ? [] : [...reign.holderIds].sort(compareIds);
      const championSide =
        reign === null
          ? null
          : (sides.find((side) =>
              holders.every((holderId) =>
                side.competitors.some((competitor) => competitor.person.id === holderId),
              ),
            )?.side ?? null);
      return {
        titleId: title.id,
        name: title.name,
        prestige: title.prestige,
        holderCount: title.holderCount,
        openReign:
          reign === null
            ? null
            : {
                reignId: reign.id,
                wonOn: reign.wonOn,
                reignDays: diffDays(reign.wonOn, date),
                holderIds: holders,
              },
        championSide,
        championContractDaysLeft: fewestDaysLeft(
          holders.map((holderId) => employmentAt(read, holderId, promotionId, date)),
          date,
        ),
        challengerSides: sides
          .filter((side) => side.side !== championSide)
          .map((side) => ({
            side: side.side,
            marketPopularity: sideMarketPopularity(
              side,
              sideLabel(side),
              { promotionName: promotion.name, promotionPop: promotion.regionalPop, regions },
              tunables,
            ),
            eligibility: eligibilityOf(side, title, date),
            contractDaysLeft: fewestDaysLeft(
              side.competitors.map((competitor) => competitor.employment),
              date,
            ),
          })),
      };
    });

  return {
    segmentId: segment.id,
    date,
    importance: instance.importance,
    promotionId,
    brandId: instance.brandId,
    regionId: instance.regionId,
    titleTaste: titleTasteOf(taste),
    sides: rivalSides,
    storylines,
    titles,
  };
}
