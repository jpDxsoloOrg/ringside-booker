/**
 * Beat groups without a schema change (MTCH5).
 *
 * A stored beat is `{ beatKey, personIds }` and nothing else (`model/entities/segment.ts`), so a
 * beat's one or two groups are derived from the segment's participants:
 *
 * - a one-group beat puts everyone in group one;
 * - a two-group beat puts everyone on the same participant `side` as `personIds[0]` in group one
 *   and everyone else in group two.
 *
 * `toStoredBeat` writes group one first, so the two round-trip as long as each person keeps one
 * side for the whole angle, group one of a two-group beat is on one side and group two is not on
 * it. `assignAngleSides` gives every person such a side, or names the pair that makes it
 * impossible (the lab warns about it, MTCH5-03).
 *
 * Design: docs/design/angle-rating.md, "Beat groups and sides".
 */

import type { ContentKey } from '../../../core/content-key';
import type { PersonId } from '../../../core/ids';
import type { BeatDef } from '../../../model/catalogs';
import type { AngleBeat } from '../../../model/entities/segment';
import type { DeepReadonly } from '../../../model/world';
import type { GroupedBeat } from './templates';

export type { GroupedBeat } from './templates';

/** A person's participant side in the segment, or undefined when they are not a participant. */
export type SideOf = (personId: PersonId) => number | undefined;

/** The stored beat's people split into the catalog beat's groups. */
export function beatGroupsOf(
  beat: DeepReadonly<AngleBeat>,
  catalogBeat: Pick<BeatDef, 'groups'>,
  sideOf: SideOf,
): GroupedBeat {
  const people = [...beat.personIds];
  const [first] = people;
  if (catalogBeat.groups.length < 2 || first === undefined) {
    return { beatKey: beat.beatKey, groupOne: people, groupTwo: [] };
  }
  const firstSide = sideOf(first);
  return {
    beatKey: beat.beatKey,
    groupOne: people.filter((personId) => sideOf(personId) === firstSide),
    groupTwo: people.filter((personId) => sideOf(personId) !== firstSide),
  };
}

/** The stored beat for grouped people: group one first, then group two. */
export function toStoredBeat(beat: {
  readonly beatKey: ContentKey;
  readonly groupOne: readonly PersonId[];
  readonly groupTwo: readonly PersonId[];
}): AngleBeat {
  return { beatKey: beat.beatKey, personIds: [...beat.groupOne, ...beat.groupTwo] };
}

/** Two people who would need to share a side and oppose each other, and the beat they oppose in. */
export interface SideConflict {
  readonly personA: PersonId;
  readonly personB: PersonId;
  /** 0-based index of the beat where they face each other. */
  readonly beatIndex: number;
}

export type AngleSides =
  { readonly sides: Readonly<Record<PersonId, number>> } | { readonly conflict: SideConflict };

/** Union-find over person IDs. */
class SideUnion {
  private readonly parent = new Map<PersonId, PersonId>();

  add(personId: PersonId): void {
    if (!this.parent.has(personId)) {
      this.parent.set(personId, personId);
    }
  }

  root(personId: PersonId): PersonId {
    let current = personId;
    let next = this.parent.get(current);
    while (next !== undefined && next !== current) {
      current = next;
      next = this.parent.get(current);
    }
    return current;
  }

  join(left: PersonId, right: PersonId): void {
    const leftRoot = this.root(left);
    const rightRoot = this.root(right);
    if (leftRoot !== rightRoot) {
      this.parent.set(rightRoot, leftRoot);
    }
  }
}

/** One beat's people for `assignAngleSides`. */
export interface SidedBeat {
  readonly groupOne: readonly PersonId[];
  readonly groupTwo: readonly PersonId[];
  /**
   * The catalog beat has two groups. Left out, a beat counts as two-group when `groupTwo` has
   * someone in it; pass it for a two-group beat whose optional second group is left empty.
   */
  readonly twoGroups?: boolean;
}

function isTwoGroup(beat: SidedBeat): boolean {
  return beat.twoGroups ?? beat.groupTwo.length > 0;
}

/** True when joining the sides rooted at `left` and `right` would put a beat's groups together. */
function joinConflicts(
  union: SideUnion,
  beats: readonly SidedBeat[],
  left: PersonId,
  right: PersonId,
): boolean {
  const inSide = (root: PersonId) => (personId: PersonId) => union.root(personId) === root;
  return beats.some(
    (beat) =>
      isTwoGroup(beat) &&
      ((beat.groupOne.some(inSide(left)) && beat.groupTwo.some(inSide(right))) ||
        (beat.groupOne.some(inSide(right)) && beat.groupTwo.some(inSide(left)))),
  );
}

/**
 * One participant side per person for the whole angle, so that `beatGroupsOf` gives every beat
 * back the groups it was built with:
 *
 * - in a two-group beat, everyone in group one must share a side, and nobody in group two may be
 *   on it;
 * - a one-group beat puts no constraint on sides (both sides may brawl together).
 *
 * People in one group two share a side too when that breaks no beat (side B of a war of words),
 * but not when it would (the subjects of an announcement who then face each other). Sides are
 * numbered 0, 1, 2... in order of first appearance. Returns the first conflict instead when two
 * people who must share a side face each other in some beat.
 */
export function assignAngleSides(beats: readonly SidedBeat[]): AngleSides {
  const union = new SideUnion();
  const order: PersonId[] = [];
  for (const beat of beats) {
    for (const personId of [...beat.groupOne, ...beat.groupTwo]) {
      if (!order.includes(personId)) {
        order.push(personId);
      }
      union.add(personId);
    }
    const [first, ...rest] = beat.groupOne;
    if (first !== undefined && isTwoGroup(beat)) {
      for (const personId of rest) {
        union.join(first, personId);
      }
    }
  }

  for (const [beatIndex, beat] of beats.entries()) {
    for (const personA of beat.groupOne) {
      const opposed = beat.groupTwo.find((personB) => union.root(personA) === union.root(personB));
      if (opposed !== undefined) {
        return { conflict: { personA, personB: opposed, beatIndex } };
      }
    }
  }

  for (const beat of beats) {
    const [first, ...rest] = beat.groupTwo;
    if (first === undefined || !isTwoGroup(beat)) {
      continue;
    }
    for (const personId of rest) {
      const left = union.root(first);
      const right = union.root(personId);
      if (left !== right && !joinConflicts(union, beats, left, right)) {
        union.join(first, personId);
      }
    }
  }

  const sideByRoot = new Map<PersonId, number>();
  const sides: Record<PersonId, number> = {};
  for (const personId of order) {
    const root = union.root(personId);
    let side = sideByRoot.get(root);
    if (side === undefined) {
      side = sideByRoot.size;
      sideByRoot.set(root, side);
    }
    sides[personId] = side;
  }
  return { sides };
}
