import { describe, expect, it } from 'vitest';
import { parseContentKey, parseId } from '@ringside/engine';
import type { PersonId, SegmentDraft, TeamId, TitleId } from '@ringside/engine';
import {
  addPerson,
  addSide,
  draftForSave,
  emptyDraft,
  initialDraftState,
  patchDraft,
  removePerson,
  removeSide,
  sameDraft,
  setLabel,
  setResult,
  setTitles,
  setType,
  unsaveableReason,
} from './useSegmentDraft';
import type { SegmentDraftState } from './useSegmentDraft';

const SINGLES = parseContentKey('match.singles');
const THREE_WAY = parseContentKey('match.triple-threat');
const ROYAL = parseContentKey('match.battle-royal');
const PROMO = parseContentKey('angle.promo');
const CONFRONTATION = parseContentKey('angle.confrontation');
const PINFALL = parseContentKey('method.pinfall');

const TWO_SIDES = { min: 2, max: 2 };
const THREE_SIDES = { min: 3, max: 3 };

function person(index: number): PersonId {
  return parseId('person', `per_${String(index).padStart(10, '0')}`);
}

const TEAM: TeamId = parseId('team', 'tem_0000000001');
const TITLE: TitleId = parseId('title', 'tit_0000000001');

function singles(): SegmentDraftState {
  return initialDraftState(emptyDraft('match', SINGLES), TWO_SIDES);
}

/** A three-way with one person a side and side 3 planned to win. */
function threeWay(): SegmentDraftState {
  let state = initialDraftState(emptyDraft('match', THREE_WAY), THREE_SIDES);
  state = addPerson(state, 0, person(1));
  state = addPerson(state, 1, person(2));
  state = addPerson(state, 2, person(3));
  return setResult(state, { kind: 'win', winningSide: 2, methodKey: PINFALL });
}

/** A promo whose beats were written before (as a saved talking segment has). */
function promoWithBeats(personIds: readonly PersonId[]): SegmentDraft {
  return {
    kind: 'angle',
    label: null,
    storylineIds: [],
    crew: { refereeId: null, producerId: null, announcerIds: [] },
    participants: [],
    angle: { angleTypeKey: PROMO, beats: [{ beatKey: PROMO, personIds: [...personIds] }] },
  };
}

function outcomeOf(draft: SegmentDraft) {
  return draft.kind === 'match' ? draft.outcome : undefined;
}

describe('the segment draft', () => {
  it('starts a match with the sides its type needs and nobody on them', () => {
    const state = singles();
    expect(state.sideCount).toBe(2);
    expect(state.draft).toMatchObject({
      kind: 'match',
      label: null,
      participants: [],
      match: { matchTypeKey: SINGLES, titleIds: [], stipulationKeys: [], finishKey: null },
      outcome: null,
    });
  });

  it('starts from a saved draft with as many sides as its people use', () => {
    const draft = threeWay().draft;
    expect(initialDraftState(draft, { min: 2, max: 4 }).sideCount).toBe(3);
  });

  it('adds people to a side as competitors, once each', () => {
    let state = addPerson(singles(), 0, person(1));
    state = addPerson(state, 1, person(1));
    state = addPerson(state, 1, person(2), TEAM);
    expect(state.draft.participants).toEqual([
      { personId: person(1), side: 0, role: 'competitor', teamId: null },
      { personId: person(2), side: 1, role: 'competitor', teamId: TEAM },
    ]);
  });

  it('adds speakers to a talking segment and drops its beats so the default is written', () => {
    const draft = promoWithBeats([person(9)]);
    const state = addPerson(initialDraftState(draft, { min: 1, max: 1 }), 0, person(1));
    expect(state.draft.participants).toEqual([
      { personId: person(1), side: 0, role: 'speaker', teamId: null },
    ]);
    expect(state.draft.kind === 'angle' && state.draft.angle.beats).toBeUndefined();
  });

  it('ignores a side the draft does not show', () => {
    const state = singles();
    expect(addPerson(state, 2, person(1))).toBe(state);
  });

  it('removes someone', () => {
    const state = removePerson(addPerson(singles(), 0, person(1)), person(1));
    expect(state.draft.participants).toEqual([]);
  });

  it('adds sides up to the most and removes them down to the least', () => {
    const limits = { min: 2, max: 3 };
    let state = addSide(singles(), limits);
    expect(state.sideCount).toBe(3);
    expect(addSide(state, limits).sideCount).toBe(3);
    state = removeSide(state, 0, limits);
    expect(state.sideCount).toBe(2);
    expect(removeSide(state, 0, limits).sideCount).toBe(2);
  });

  it('renumbers later sides and follows the planned winner when a side goes', () => {
    const limits = { min: 2, max: 4 };
    const state = removeSide(threeWay(), 0, limits);
    expect(state.draft.participants.map((entry) => [entry.personId, entry.side])).toEqual([
      [person(2), 0],
      [person(3), 1],
    ]);
    expect(outcomeOf(state.draft)).toEqual({ kind: 'win', winningSide: 1, methodKey: PINFALL });
  });

  it('clears the planned win when the winning side is removed', () => {
    const state = removeSide(threeWay(), 2, { min: 2, max: 4 });
    expect(outcomeOf(state.draft)).toBeNull();
  });

  it('trims sides past the new type and clears a winner that no longer exists', () => {
    const state = setType(threeWay(), SINGLES, TWO_SIDES);
    expect(state.sideCount).toBe(2);
    expect(state.draft.participants.map((entry) => entry.personId)).toEqual([person(1), person(2)]);
    expect(outcomeOf(state.draft)).toBeNull();
    expect(state.draft.kind === 'match' && state.draft.match.matchTypeKey).toBe(SINGLES);
  });

  it('keeps a winner that still exists and adds sides a bigger type needs', () => {
    let state = addPerson(addPerson(singles(), 0, person(1)), 1, person(2));
    state = setResult(state, { kind: 'win', winningSide: 1, methodKey: PINFALL });
    state = setType(state, THREE_WAY, THREE_SIDES);
    expect(state.sideCount).toBe(3);
    expect(outcomeOf(state.draft)).toEqual({ kind: 'win', winningSide: 1, methodKey: PINFALL });
  });

  it('takes titles off when the new type cannot carry them', () => {
    const state = setType(setTitles(singles(), [TITLE]), ROYAL, { min: 6, max: 30 }, false);
    expect(state.draft.kind === 'match' && state.draft.match.titleIds).toEqual([]);
    expect(state.sideCount).toBe(6);
  });

  it('gives a talking segment of a new type its own default beat', () => {
    const draft = promoWithBeats([]);
    const state = setType(initialDraftState(draft, { min: 1, max: 1 }), CONFRONTATION, {
      min: 1,
      max: 2,
    });
    expect(state.draft.kind === 'angle' && state.draft.angle).toEqual({
      angleTypeKey: CONFRONTATION,
    });
  });

  it('plans draws and no contests, and never a result for a talking segment', () => {
    expect(outcomeOf(setResult(singles(), { kind: 'draw' }).draft)).toEqual({ kind: 'draw' });
    const promo = initialDraftState(emptyDraft('angle', PROMO), { min: 1, max: 1 });
    expect(setResult(promo, { kind: 'noContest' })).toBe(promo);
    expect(setTitles(promo, [TITLE])).toBe(promo);
  });

  it('keeps the billing line to 80 characters and saves a blank one as none', () => {
    const state = setLabel(singles(), 'x'.repeat(90));
    expect(state.draft.label).toHaveLength(80);
    expect(draftForSave(setLabel(singles(), '   ').draft).label).toBeNull();
    expect(draftForSave(setLabel(singles(), '  Title eliminator ').draft).label).toBe(
      'Title eliminator',
    );
  });

  it('merges a section patch into its own kind only', () => {
    const match = patchDraft(singles(), 'test.finish', {
      match: { finishKey: parseContentKey('finish.clean') },
      angle: { angleTypeKey: PROMO },
      label: 'From a section',
    });
    expect(match.draft).toMatchObject({
      label: 'From a section',
      match: { matchTypeKey: SINGLES, finishKey: 'finish.clean' },
    });
    expect('angle' in match.draft).toBe(false);
  });

  it('tells a saved draft from a changed one, ignoring blank space in the billing line', () => {
    const base = singles().draft;
    expect(sameDraft(base, setLabel(singles(), '  ').draft)).toBe(true);
    expect(sameDraft(base, addPerson(singles(), 0, person(1)).draft)).toBe(false);
  });

  it('can be saved once two sides have people, or a talking segment has a speaker', () => {
    let state = addPerson(singles(), 0, person(1));
    expect(unsaveableReason(state.draft)).toBe(
      'Put someone on at least two sides to save this match.',
    );
    state = addPerson(state, 1, person(2));
    expect(unsaveableReason(state.draft)).toBeNull();
    const promo = initialDraftState(emptyDraft('angle', PROMO), { min: 1, max: 1 });
    expect(unsaveableReason(promo.draft)).toBe(
      'Add at least one speaker to save this talking segment.',
    );
    expect(unsaveableReason(addPerson(promo, 0, person(1)).draft)).toBeNull();
  });
});
