import { parseId } from '@ringside/engine';
import { describe, expect, it } from 'vitest';
import {
  canAddBeat,
  changeBeatKey,
  droppedPeopleMessage,
  limitText,
  moveBeat,
  nextBeatId,
  overLimitBy,
} from './beatDraft';
import type { BeatDraft, BeatOption, PersonChip } from './beatDraft';

function person(index: number, name: string): PersonChip {
  return { id: parseId('person', `per_${String(index).padStart(10, '0')}`), name };
}

const REX = person(1, 'Rex Halden');
const TOBIN = person(2, 'Tobin Vasquell');
const MILA = person(3, 'Mila Stroud');

const PROMO: BeatOption = {
  key: 'beat.promo',
  name: 'Promo',
  description: 'One side talks.',
  groups: [{ label: 'Speaker', minPeople: 1, maxPeople: 4, optional: false }],
  physical: false,
};
const ATTACK: BeatOption = {
  key: 'beat.attack',
  name: 'Attack',
  description: 'One side jumps the other.',
  groups: [
    { label: 'Attackers', minPeople: 1, maxPeople: 4, optional: false },
    { label: 'Targets', minPeople: 1, maxPeople: 4, optional: false },
  ],
  physical: true,
};
const INTERVIEW: BeatOption = {
  key: 'beat.interview',
  name: 'Interview',
  description: 'Someone answers questions.',
  groups: [
    { label: 'Guest', minPeople: 1, maxPeople: 1, optional: false },
    { label: 'Host', minPeople: 1, maxPeople: 1, optional: true },
  ],
  physical: false,
};

const LIMIT = { max: 2, message: 'Short slot: up to 2 beats' };

function draft(id: string, beatKey: string, groupOne: PersonChip[], groupTwo: PersonChip[] = []) {
  return { id, beatKey, groupOne, groupTwo } satisfies BeatDraft;
}

describe('moveBeat', () => {
  it('moves an item and shifts the rest', () => {
    expect(moveBeat(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveBeat(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
  });

  it('returns an unchanged copy for a move out of range or in place', () => {
    const beats = ['a', 'b'];
    expect(moveBeat(beats, 0, 2)).toEqual(['a', 'b']);
    expect(moveBeat(beats, 1, 1)).not.toBe(beats);
  });
});

describe('changeBeatKey', () => {
  it('keeps group one, drops a group the new beat lacks, and says why', () => {
    const changed = changeBeatKey(draft('b1', ATTACK.key, [REX], [TOBIN]), PROMO);

    expect(changed.beat).toEqual(draft('b1', PROMO.key, [REX], []));
    expect(changed.dropped).toEqual([{ person: TOBIN, reason: 'Promo has no second group' }]);
    expect(droppedPeopleMessage(changed.dropped)).toBe(
      'Removed Tobin Vasquell: Promo has no second group.',
    );
  });

  it('drops people past the new group size', () => {
    const changed = changeBeatKey(draft('b1', ATTACK.key, [REX, MILA], [TOBIN]), INTERVIEW);

    expect(changed.beat.groupOne).toEqual([REX]);
    expect(changed.beat.groupTwo).toEqual([TOBIN]);
    expect(droppedPeopleMessage(changed.dropped)).toBe(
      'Removed Mila Stroud: Interview takes up to 1 in Guest.',
    );
  });

  it('drops nobody when every group still fits', () => {
    const changed = changeBeatKey(draft('b1', PROMO.key, [REX]), ATTACK);
    expect(changed.dropped).toEqual([]);
    expect(droppedPeopleMessage(changed.dropped)).toBe('');
  });

  it('lists several names for one reason together', () => {
    const changed = changeBeatKey(draft('b1', ATTACK.key, [REX], [TOBIN, MILA]), PROMO);
    expect(droppedPeopleMessage(changed.dropped)).toBe(
      'Removed Tobin Vasquell and Mila Stroud: Promo has no second group.',
    );
  });
});

describe('limits', () => {
  const one = [draft('b1', PROMO.key, [])];
  const two = [...one, draft('b2', PROMO.key, [])];
  const three = [...two, draft('b3', PROMO.key, [])];

  it('allows another beat only below the limit', () => {
    expect(canAddBeat(one, LIMIT)).toBe(true);
    expect(canAddBeat(two, LIMIT)).toBe(false);
  });

  it('counts the beats past the limit', () => {
    expect(overLimitBy(one, LIMIT)).toBe(0);
    expect(overLimitBy(two, LIMIT)).toBe(0);
    expect(overLimitBy(three, LIMIT)).toBe(1);
  });

  it('says nothing with room, the limit when full, and what to remove when over', () => {
    expect(limitText(one, LIMIT)).toBe('');
    expect(limitText(two, LIMIT)).toBe('Short slot: up to 2 beats');
    expect(limitText(three, LIMIT)).toBe('Short slot: up to 2 beats. Remove 1 beat to run.');
    expect(limitText([...three, draft('b4', PROMO.key, [])], LIMIT)).toBe(
      'Short slot: up to 2 beats. Remove 2 beats to run.',
    );
  });
});

describe('nextBeatId', () => {
  it('skips ids already used', () => {
    expect(nextBeatId([])).toBe('beat-1');
    expect(nextBeatId([draft('beat-2', PROMO.key, [])])).toBe('beat-3');
    expect(nextBeatId([draft('beat-3', PROMO.key, []), draft('x', PROMO.key, [])])).toBe('beat-4');
  });
});
