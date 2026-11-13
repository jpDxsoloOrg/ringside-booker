/**
 * The card planner's data shapes (AIP4). Plain data, safe to keep in a trace or hand to a screen.
 *
 * `CardPool` is what `buildCardPool` (`pool.ts`) returns: everyone a show may use today, its teams
 * and titles, and who is left out and why. Later AIP4 tickets (match picking, title matches,
 * talking segments, Auto-fill) read only this, so they never walk the world tables themselves.
 */

import type { ContentKey } from '../../../core/content-key';
import type { GameDate } from '../../../core/date';
import type {
  BrandId,
  EmploymentId,
  EventInstanceId,
  PersonId,
  PromotionId,
  TeamId,
  TitleId,
  TitleReignId,
} from '../../../core/ids';
import type { Traced, TraceNode } from '../../../core/trace';
import type { Alignment, Push } from '../../../model/entities/employment';
import type { EventImportance } from '../../../model/entities/event-definition';
import type { Gender, PersonRole } from '../../../model/entities/person';
import type { TeamKind } from '../../../model/entities/team';
import type { TitleDivision, TitleHolderCount } from '../../../model/entities/title';
import type { Availability } from '../../workers/helpers/availability';
import type { TracedTaste } from '../formulas/defaultTaste';

/** Why a contract keeps someone off this show: a used-up appearance cap or a no-house-shows perk. */
export type ContractBlock = 'appearanceCap' | 'noHouseShows';

/** One person the show may use. */
export interface CardCandidate {
  readonly personId: PersonId;
  /** The contract this person works the show under. */
  readonly employmentId: EmploymentId;
  readonly ringName: string;
  readonly gender: Gender;
  readonly alignment: Alignment;
  readonly push: Push;
  /** The person's career roles (`wrestler`, `manager`, ...). */
  readonly roles: readonly PersonRole[];
  /** AIP1's card value at the show's promotion, 0-100. */
  readonly cardValue: Traced<number>;
  /** WRK1's availability on the show's date. */
  readonly availability: Availability;
  readonly fatigue: number;
  /** Available, holds a wrestling role and is under contract as a wrestler. */
  readonly canWrestle: boolean;
  /** Available, or out but still able to do talking segments (WRK1's `canWorkAngles`). */
  readonly canTalk: boolean;
  /** Fatigue at or below `aip.card.maxFatigue`; above it only a last resort. */
  readonly restedEnough: boolean;
  readonly contractBlock: ContractBlock | null;
  /** The pool's teams this person is in (`CardPool.teams`), in team ID order. */
  readonly teamIds: readonly TeamId[];
  /** The pool's titles this person holds now, in title ID order. */
  readonly championOf: readonly TitleId[];
  /** The mean of mic and charisma: how well they carry a talking segment, 0-100. */
  readonly talkValue: Traced<number>;
}

/** A team whose members are all in the pool and can wrestle. */
export interface CardTeam {
  readonly teamId: TeamId;
  readonly name: string;
  readonly kind: TeamKind;
  /** Members in the team's own order. */
  readonly memberIds: readonly PersonId[];
  readonly experience: number;
  /** The mean of the members' card values. */
  readonly meanCardValue: number;
}

/** A title the show may defend. */
export interface CardTitle {
  readonly titleId: TitleId;
  readonly name: string;
  readonly prestige: number;
  readonly holderCount: TitleHolderCount;
  readonly division: TitleDivision;
  /** The current reign, or null while the title is vacant. */
  readonly reignId: TitleReignId | null;
  readonly wonOn: GameDate | null;
  readonly holderIds: readonly PersonId[];
  /** The holders' names as fans know them now. */
  readonly holderNames: readonly string[];
}

/** Someone on the roster the planner will not book first, and why, in plain words. */
export interface CardExclusion {
  readonly personId: PersonId;
  readonly ringName: string;
  /** "Injured (leg injury) until 12 Feb", "Tired (fatigue 82, limit 75)", ... */
  readonly reason: string;
}

/** Who and what one show may use. */
export interface CardPool {
  readonly instanceId: EventInstanceId;
  readonly promotionId: PromotionId;
  readonly brandId: BrandId | null;
  readonly showName: string;
  readonly importance: EventImportance;
  readonly date: GameDate;
  /** The taste of whoever books the show (`tasteOf` for the show's deciding brand). */
  readonly taste: TracedTaste;
  /**
   * Everyone who can wrestle or talk on the date, tired and contract-blocked people included (their
   * flags say so). Sorted by card value, highest first, then person ID.
   */
  readonly candidates: readonly CardCandidate[];
  /** In team ID order. */
  readonly teams: readonly CardTeam[];
  /** In title ID order. */
  readonly titles: readonly CardTitle[];
  /** Candidates with `canWrestle && restedEnough && contractBlock === null`. */
  readonly availableWrestlers: number;
  /**
   * Who the planner will not book first, with the reason, in roster order: people who cannot work
   * at all (not in `candidates`), wrestlers who can only talk today, the tired and the
   * contract-blocked (still in `candidates`, as a last resort).
   */
  readonly excluded: readonly CardExclusion[];
}

/** One side of a planned title match. */
export interface PlannedSide {
  /** Everyone on the side, in order (a team's own order). */
  readonly personIds: readonly PersonId[];
  /** The team the side represents, or null for a singles side or a pairing made for tonight. */
  readonly teamId: TeamId | null;
  /** True for the champions' side. */
  readonly isChampions: boolean;
}

/** Who challenges for a title tonight: one side for a defence, two for a vacant title. */
export interface ChallengerPick {
  readonly sides: readonly PlannedSide[];
}

/** A title match the card planner wants on tonight's card. Plain JSON. */
export interface PlannedTitleMatch {
  readonly titleId: TitleId;
  /** A non-hidden match type that allows titles, two sides and the title's holder count per side. */
  readonly matchTypeKey: ContentKey;
  /** The champions first (when the title has any), then the challengers. */
  readonly sides: readonly PlannedSide[];
  /** The title's decision: why it is defended, the challenger pick and the match type. */
  readonly trace: Traced<string>;
}

/** A title left off tonight's card, and why, in plain words. */
export interface SkippedTitle {
  readonly titleId: TitleId;
  readonly reason: string;
}

/** Which titles are on the line tonight. */
export interface TitlePicture {
  /** In booking order: vacant titles first, then by urgency, highest first, then prestige. */
  readonly planned: readonly PlannedTitleMatch[];
  /** In the order the titles were considered (prestige, highest first, then title ID). */
  readonly skipped: readonly SkippedTitle[];
  /** One decision per title, in the order considered, under "Title picture for <show>". */
  readonly trace: TraceNode;
}
