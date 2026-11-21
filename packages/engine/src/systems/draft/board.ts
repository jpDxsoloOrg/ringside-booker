/**
 * The draft board (DRF-01): the pool as rivals see it, and how a rival picks.
 *
 * A rival takes the candidate with the best **pick score**: draft value, plus
 *
 * - `draft.ai.styleBonus` when the ring style suits the promotion's style ({@link STYLE_FITS});
 * - gender need: for each gender, the roster's fair share is `roster size × that gender's share of
 *   the pool`. Short of it: `+ draft.ai.genderNeedWeight × shortfall ÷ share`; at or over it:
 *   `− draft.ai.genderSurplusWeight × (over + 1) ÷ roster size`;
 * - division need: `+ draft.ai.divisionNeedWeight × missing ÷ draft.ai.divisionNeed` for the
 *   neediest of the promotion's title divisions (gender and weight limits) the wrestler can hold;
 * - alignment: `+ draft.ai.alignmentWeight` for a natural heel when the roster has more faces, or
 *   a face when it has more heels;
 * - staff: `+ draft.ai.divisionNeedWeight` for a staff job nobody on the roster does yet.
 *
 * Cheap for hundreds of promotions and thousands of people: candidates are grouped into buckets
 * that score alike (category, gender, weight class, heel or face, ring style or staff job), each
 * bucket sorted best value first. A pick scores only the best untaken candidate of every bucket,
 * so its cost depends on the number of buckets (a few hundred at most), not the pool size.
 * Deterministic: ties go to the lower person id.
 *
 * Picks paid up front (DRF-10): a promotion only takes someone it can afford; see
 * {@link DraftBoard.bestFor}.
 *
 * Design: docs/design/draft.md#rival-picks.
 */

import type { PersonId, PromotionId } from '../../core/ids';
import type { DraftCategory } from '../../model/entities/draft';
import type { Gender, RingStyle } from '../../model/entities/person';
import type { PromotionStyle } from '../../model/entities/promotion-style';
import type { TitleDivision } from '../../model/entities/title';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';
import { compareCandidates, type DraftCandidate } from './candidates';

/** The ring styles each promotion style likes. */
export const STYLE_FITS: Readonly<Record<PromotionStyle, readonly RingStyle[]>> = {
  mainstream: ['allRounder', 'showman', 'powerhouse'],
  traditional: ['allRounder', 'technician', 'brawler'],
  technical: ['technician', 'grappler'],
  hardHitting: ['striker', 'powerhouse', 'brawler'],
  hardcore: ['hardcore', 'brawler'],
  highFlying: ['highFlyer', 'allRounder'],
  entertainment: ['showman', 'powerhouse'],
};

export interface BoardWeights {
  readonly styleBonus: number;
  readonly genderNeedWeight: number;
  readonly genderSurplusWeight: number;
  readonly divisionNeed: number;
  readonly divisionNeedWeight: number;
  readonly alignmentWeight: number;
}

export function boardWeights(tunables: EngineTunables): BoardWeights {
  return {
    styleBonus: tunables.get('draft.ai.styleBonus'),
    genderNeedWeight: tunables.get('draft.ai.genderNeedWeight'),
    genderSurplusWeight: tunables.get('draft.ai.genderSurplusWeight'),
    divisionNeed: tunables.get('draft.ai.divisionNeed'),
    divisionNeedWeight: tunables.get('draft.ai.divisionNeedWeight'),
    alignmentWeight: tunables.get('draft.ai.alignmentWeight'),
  };
}

/** One promotion's roster so far, as the board counts it. */
export interface RosterCount {
  readonly promotionId: PromotionId;
  readonly style: PromotionStyle;
  wrestlers: number;
  staff: number;
  heels: number;
  faces: number;
  readonly genders: Map<Gender, number>;
  readonly staffRoles: Map<string, number>;
  readonly divisions: { division: TitleDivision; filled: number }[];
}

export interface BoardTargets {
  readonly rosterTarget: number;
  readonly staffTarget: number;
}

function fitsDivision(candidate: DraftCandidate, division: TitleDivision): boolean {
  if (division.gender !== 'open' && division.gender !== candidate.gender) {
    return false;
  }
  if (division.minWeightKg !== null && candidate.weightKg < division.minWeightKg) {
    return false;
  }
  return division.maxWeightKg === null || candidate.weightKg <= division.maxWeightKg;
}

function bucketKey(candidate: DraftCandidate): string {
  return candidate.category === 'wrestler'
    ? `w|${candidate.gender}|${candidate.weightClass}|${candidate.heel ? 'h' : 'f'}|${candidate.style}`
    : `s|${candidate.gender}|${candidate.role}`;
}

interface Bucket {
  readonly key: string;
  readonly category: DraftCategory;
  readonly members: DraftCandidate[];
  next: number;
}

/** Misses before {@link DraftBoard.bestFor} prices every bucket's top at once. */
export const LAZY_AFFORD_TRIES = 8;

/** A bucket's top as {@link DraftBoard.bestFor} weighs it. */
interface Top {
  readonly candidate: DraftCandidate;
  readonly score: number;
  readonly bucket: number;
  readonly at: number;
}

/** A scored choice and the parts of its score, for the Why? of a rival's pick. */
export interface PickChoice {
  readonly candidate: DraftCandidate;
  readonly score: number;
  readonly reasons: string[];
}

export class DraftBoard {
  readonly #buckets: Bucket[];
  readonly #taken = new Set<PersonId>();
  readonly #byId = new Map<PersonId, DraftCandidate>();
  readonly #rosters = new Map<PromotionId, RosterCount>();
  readonly #genderShare = new Map<Gender, number>();
  readonly #closed = new Set<PromotionId>();
  /** Per promotion and bucket: members above this index are taken or unaffordable to it. */
  readonly #looked = new Map<PromotionId, number[]>();
  #wrestlersLeft = 0;
  #staffLeft = 0;

  constructor(
    pool: readonly DraftCandidate[],
    readonly targets: BoardTargets,
    readonly weights: BoardWeights,
  ) {
    const buckets = new Map<string, Bucket>();
    let wrestlers = 0;
    const genders = new Map<Gender, number>();
    for (const candidate of pool) {
      this.#byId.set(candidate.personId, candidate);
      const key = bucketKey(candidate);
      let bucket = buckets.get(key);
      if (bucket === undefined) {
        bucket = { key, category: candidate.category, members: [], next: 0 };
        buckets.set(key, bucket);
      }
      bucket.members.push(candidate);
      if (candidate.category === 'wrestler') {
        wrestlers += 1;
        genders.set(candidate.gender, (genders.get(candidate.gender) ?? 0) + 1);
      } else {
        this.#staffLeft += 1;
      }
    }
    this.#wrestlersLeft = wrestlers;
    for (const [gender, count] of genders) {
      this.#genderShare.set(gender, wrestlers === 0 ? 0 : count / wrestlers);
    }
    this.#buckets = [...buckets.values()].sort((left, right) => (left.key < right.key ? -1 : 1));
    for (const bucket of this.#buckets) {
      bucket.members.sort(compareCandidates);
    }
  }

  /** Adds a promotion's roster (its titles' divisions and its picks so far). */
  addRoster(roster: RosterCount): void {
    this.#rosters.set(roster.promotionId, roster);
  }

  roster(promotionId: PromotionId): RosterCount | undefined {
    return this.#rosters.get(promotionId);
  }

  candidate(personId: PersonId): DraftCandidate | undefined {
    return this.#byId.get(personId);
  }

  /** Everyone still in the pool, best value first. */
  poolMembers(): DraftCandidate[] {
    return [...this.#byId.values()]
      .filter((candidate) => !this.#taken.has(candidate.personId))
      .sort(compareCandidates);
  }

  isAvailable(personId: PersonId): boolean {
    return this.#byId.has(personId) && !this.#taken.has(personId);
  }

  get wrestlersLeft(): number {
    return this.#wrestlersLeft;
  }

  get staffLeft(): number {
    return this.#staffLeft;
  }

  /** Stops a promotion picking: its remaining turns are passed (a player finishing early). */
  close(promotionId: PromotionId): void {
    this.#closed.add(promotionId);
  }

  /** True when the promotion still wants someone the pool has. */
  needs(promotionId: PromotionId): boolean {
    const roster = this.#rosters.get(promotionId);
    if (roster === undefined || this.#closed.has(promotionId)) {
      return false;
    }
    return this.wants(roster, 'wrestler') || this.wants(roster, 'staff');
  }

  /** True when the roster has room in `category` and the pool still has someone for it. */
  wants(roster: RosterCount, category: DraftCategory): boolean {
    return category === 'wrestler'
      ? roster.wrestlers < this.targets.rosterTarget && this.#wrestlersLeft > 0
      : roster.staff < this.targets.staffTarget && this.#staffLeft > 0;
  }

  /** Records a pick: off the board, onto the roster. */
  take(promotionId: PromotionId, candidate: DraftCandidate): void {
    if (this.#taken.has(candidate.personId)) {
      return;
    }
    this.#taken.add(candidate.personId);
    if (this.#byId.has(candidate.personId)) {
      if (candidate.category === 'wrestler') {
        this.#wrestlersLeft -= 1;
      } else {
        this.#staffLeft -= 1;
      }
    }
    const roster = this.#rosters.get(promotionId);
    if (roster !== undefined) {
      countOnRoster(roster, candidate);
    }
  }

  /**
   * The best pick for this promotion, or null when it wants nobody the board has. With `afford`,
   * only candidates it can pay for count (DRF-10). `afford` must only ever turn false for a
   * candidate (cash only goes down in a draft), so the board remembers, per promotion and bucket,
   * whom it has already turned down.
   *
   * Cheap when money is not tight: the best candidate is found as usual and only that one is
   * priced. Each one it cannot afford is passed over in its bucket and the search runs again; after
   * {@link LAZY_AFFORD_TRIES} misses it prices every bucket's top instead, to find the best
   * affordable one in a single pass.
   */
  bestFor(
    promotionId: PromotionId,
    afford?: (candidate: DraftCandidate) => boolean,
  ): PickChoice | null {
    const roster = this.#rosters.get(promotionId);
    if (roster === undefined) {
      return null;
    }
    let found: Top | null;
    if (afford === undefined) {
      found = this.#bestTop(roster, null, null);
    } else {
      const marks = this.#marksOf(promotionId);
      for (let tries = 0; ; tries += 1) {
        found = this.#bestTop(roster, marks, tries >= LAZY_AFFORD_TRIES ? afford : null);
        if (found === null || afford(found.candidate)) {
          break;
        }
        marks[found.bucket] = found.at + 1;
      }
    }
    if (found === null) {
      return null;
    }
    const reasons: string[] = [];
    this.score(roster, found.candidate, reasons);
    return { candidate: found.candidate, score: found.score, reasons };
  }

  #marksOf(promotionId: PromotionId): number[] {
    let marks = this.#looked.get(promotionId);
    if (marks === undefined) {
      marks = new Array<number>(this.#buckets.length).fill(0);
      this.#looked.set(promotionId, marks);
    }
    return marks;
  }

  /**
   * The best-scoring top of every bucket the roster wants. With `marks`, a bucket's top is its
   * first untaken member at or after the promotion's mark; with `afford` too, its first one the
   * promotion can pay for (the mark moves past the rest).
   */
  #bestTop(
    roster: RosterCount,
    marks: number[] | null,
    afford: ((candidate: DraftCandidate) => boolean) | null,
  ): Top | null {
    const wantsWrestler = this.wants(roster, 'wrestler');
    const wantsStaff = this.wants(roster, 'staff');
    let best: Top | null = null;
    for (const [index, bucket] of this.#buckets.entries()) {
      if (bucket.category === 'wrestler' ? !wantsWrestler : !wantsStaff) {
        continue;
      }
      while (bucket.next < bucket.members.length) {
        const member = bucket.members[bucket.next];
        if (member !== undefined && !this.#taken.has(member.personId)) {
          break;
        }
        bucket.next += 1;
      }
      let at = bucket.next;
      if (marks !== null) {
        at = Math.max(at, marks[index] ?? 0);
        while (at < bucket.members.length) {
          const member = bucket.members[at];
          if (
            member !== undefined &&
            !this.#taken.has(member.personId) &&
            (afford === null || afford(member))
          ) {
            break;
          }
          at += 1;
        }
        if (afford !== null) {
          marks[index] = at;
        }
      }
      const top = bucket.members[at];
      if (top === undefined) {
        continue;
      }
      const score = this.score(roster, top, null);
      if (
        best === null ||
        score > best.score ||
        (score === best.score && compareIds(top.personId, best.candidate.personId) < 0)
      ) {
        best = { candidate: top, score, bucket: index, at };
      }
    }
    return best;
  }

  /** The pick score of `candidate` for `roster`; with `reasons`, each part in words. */
  score(roster: RosterCount, candidate: DraftCandidate, reasons: string[] | null): number {
    const { weights, targets } = this;
    let score = candidate.value;
    reasons?.push(`Draft value ${round1(candidate.value)}`);
    if (candidate.category === 'staff') {
      if ((roster.staffRoles.get(candidate.role) ?? 0) === 0) {
        score += weights.divisionNeedWeight;
        reasons?.push(`+${round1(weights.divisionNeedWeight)}: nobody does this job yet`);
      }
      return score;
    }
    if (STYLE_FITS[roster.style].includes(candidate.style)) {
      score += weights.styleBonus;
      reasons?.push(`+${round1(weights.styleBonus)}: their style suits the promotion`);
    }
    const share = this.#genderShare.get(candidate.gender) ?? 0;
    const want = targets.rosterTarget * share;
    const have = roster.genders.get(candidate.gender) ?? 0;
    if (want > 0 && have < want) {
      const bonus = (weights.genderNeedWeight * (want - have)) / want;
      score += bonus;
      reasons?.push(`+${round1(bonus)}: the roster needs more of this division's gender`);
    } else if (targets.rosterTarget > 0) {
      const penalty = (weights.genderSurplusWeight * (have - want + 1)) / targets.rosterTarget;
      score -= penalty;
      reasons?.push(`−${round1(penalty)}: the roster already has its share of this gender`);
    }
    let divisionBonus = 0;
    for (const entry of roster.divisions) {
      if (entry.filled < weights.divisionNeed && fitsDivision(candidate, entry.division)) {
        const bonus =
          (weights.divisionNeedWeight * (weights.divisionNeed - entry.filled)) /
          weights.divisionNeed;
        divisionBonus = Math.max(divisionBonus, bonus);
      }
    }
    if (divisionBonus > 0) {
      score += divisionBonus;
      reasons?.push(`+${round1(divisionBonus)}: fills a title division`);
    }
    if (candidate.heel ? roster.heels < roster.faces : roster.faces < roster.heels) {
      score += weights.alignmentWeight;
      reasons?.push(`+${round1(weights.alignmentWeight)}: balances faces and heels`);
    }
    return score;
  }
}

function round1(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** Counts one more person on a roster. */
export function countOnRoster(roster: RosterCount, candidate: DraftCandidate): void {
  if (candidate.category === 'staff') {
    roster.staff += 1;
    roster.staffRoles.set(candidate.role, (roster.staffRoles.get(candidate.role) ?? 0) + 1);
    return;
  }
  roster.wrestlers += 1;
  roster.genders.set(candidate.gender, (roster.genders.get(candidate.gender) ?? 0) + 1);
  if (candidate.heel) {
    roster.heels += 1;
  } else {
    roster.faces += 1;
  }
  for (const entry of roster.divisions) {
    if (fitsDivision(candidate, entry.division)) {
      entry.filled += 1;
    }
  }
}

/** An empty roster count for a promotion, with its active titles' divisions. */
export function emptyRoster(read: GameWorldView, promotionId: PromotionId): RosterCount {
  const promotion = read.tables.promotions.require(promotionId);
  const seen = new Set<string>();
  const divisions: { division: TitleDivision; filled: number }[] = [];
  for (const title of read.tables.titles.lookup('byPromotion', promotionId)) {
    if (title.status !== 'active') {
      continue;
    }
    const key = JSON.stringify(title.division);
    if (!seen.has(key)) {
      seen.add(key);
      divisions.push({ division: { ...title.division }, filled: 0 });
    }
  }
  return {
    promotionId,
    style: promotion.style,
    wrestlers: 0,
    staff: 0,
    heels: 0,
    faces: 0,
    genders: new Map(),
    staffRoles: new Map(),
    divisions,
  };
}
