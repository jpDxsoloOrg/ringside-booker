/**
 * The segment editor's local draft: the engine's `SegmentDraft` plus how many sides the editor
 * shows (a side nobody stands on yet has no participant row, so the draft alone can't say).
 *
 * Every change is a pure function of the state, so the rules are unit-tested without a screen.
 * Nothing here reaches the world: the sheet saves the whole draft with one `booking.addSegment` or
 * `booking.updateSegment` call. The editor never invents rules of its own beyond the catalog's
 * limits; anything else is the engine's to refuse or the checklist's to flag.
 */
import { useCallback, useMemo, useReducer } from 'react';
import type {
  AngleDraft,
  AngleSetting,
  ContentKey,
  MatchDraft,
  MatchOutcome,
  ParticipantDraft,
  PlannedResult,
  PersonId,
  SegmentDraft,
  TalkRole,
  TeamId,
  TitleId,
} from '@ringside/engine';
import { withPlannedResult } from '@ringside/engine';
import type { SegmentEditorKind } from './editorStore';

/** How many sides the editor offers for the chosen type. */
export interface SideLimits {
  readonly min: number;
  readonly max: number;
}

export interface SegmentDraftState {
  readonly draft: SegmentDraft;
  /** Sides shown, empty ones included. Never below the type's minimum. */
  readonly sideCount: number;
}

/**
 * What an editor section may change: its own parts of the draft. The match or angle details are
 * merged field by field, and only into a draft of that kind.
 */
export interface SegmentDraftPatch {
  readonly label?: string | null;
  readonly storylineIds?: SegmentDraft['storylineIds'];
  readonly crew?: SegmentDraft['crew'];
  readonly match?: Partial<MatchDraft['match']>;
  readonly outcome?: MatchOutcome | null;
  readonly angle?: Partial<AngleDraft['angle']>;
}

/** Most characters on a billing line, as the engine stores it. */
export const LABEL_MAX_LENGTH = 80;

/** The crew a new draft starts with: nobody named, so the show assigns one. */
function noCrew(): SegmentDraft['crew'] {
  return { refereeId: null, producerId: null, announcerIds: [] };
}

/** A new, empty draft of a kind and type. */
export function emptyDraft(kind: SegmentEditorKind, typeKey: ContentKey): SegmentDraft {
  const base = { label: null, storylineIds: [], crew: noCrew(), participants: [] };
  if (kind === 'match') {
    return {
      kind: 'match',
      ...base,
      match: { matchTypeKey: typeKey, stipulationKeys: [], titleIds: [], finishKey: null },
      outcome: null,
    };
  }
  return { kind: 'angle', ...base, angle: { angleTypeKey: typeKey } };
}

/** The draft's type key: the match type or the angle type. */
export function draftTypeKey(draft: SegmentDraft): ContentKey {
  return draft.kind === 'match' ? draft.match.matchTypeKey : draft.angle.angleTypeKey;
}

/** The role a person takes when added: a match's competitor or an angle's speaker. */
function roleFor(draft: SegmentDraft): ParticipantDraft['role'] {
  return draft.kind === 'match' ? 'competitor' : 'speaker';
}

function clamp(value: number, limits: SideLimits): number {
  return Math.min(Math.max(value, limits.min), Math.max(limits.max, limits.min));
}

/** Sides the draft uses: one past the highest side anyone stands on. */
function usedSides(draft: SegmentDraft): number {
  return draft.participants.reduce((most, person) => Math.max(most, person.side + 1), 0);
}

/** The editor's starting state for a draft: enough sides for the type and everyone in it. */
export function initialDraftState(draft: SegmentDraft, limits: SideLimits): SegmentDraftState {
  return { draft, sideCount: Math.max(limits.min, usedSides(draft), 1) };
}

/** An angle's details without its beats, keeping its setting (MTCH5-08). */
function angleWithoutBeats(angle: AngleDraft['angle'], angleTypeKey = angle.angleTypeKey) {
  return {
    angleTypeKey,
    ...(angle.setting === undefined ? {} : { setting: angle.setting }),
  };
}

/**
 * The draft with new participants. An angle's beats are dropped so the engine writes its type's
 * default beat for the speakers now on it (until MTCH5's beats section owns them).
 */
function withParticipants(
  draft: SegmentDraft,
  participants: readonly ParticipantDraft[],
): SegmentDraft {
  if (draft.kind === 'match') return { ...draft, participants: [...participants] };
  return {
    ...draft,
    participants: [...participants],
    angle: angleWithoutBeats(draft.angle),
  };
}

/** A planned result that still points at a side the match has. */
function outcomeWithin(outcome: MatchOutcome | null, sideCount: number): MatchOutcome | null {
  if (outcome?.kind === 'win' && outcome.winningSide >= sideCount) return null;
  return outcome;
}

/**
 * Changes the type. Sides past the new type's most are dropped with the people on them, a planned
 * winner that no longer exists is cleared, and titles go when the new type can't carry them.
 */
export function setType(
  state: SegmentDraftState,
  typeKey: ContentKey,
  limits: SideLimits,
  allowsTitles = true,
  settings?: readonly AngleSetting[],
): SegmentDraftState {
  const sideCount = clamp(state.sideCount, limits);
  const kept = state.draft.participants.filter((person) => person.side < sideCount);
  const { draft } = state;
  if (draft.kind === 'match') {
    const next: MatchDraft = {
      ...draft,
      participants: kept,
      match: {
        ...draft.match,
        matchTypeKey: typeKey,
        titleIds: allowsTitles ? draft.match.titleIds : [],
      },
      outcome: outcomeWithin(draft.outcome, sideCount),
    };
    return { draft: next, sideCount };
  }
  if (draft.angle.angleTypeKey === typeKey && kept.length === draft.participants.length) {
    return { draft, sideCount };
  }
  // A new talking segment type gets its own default beat, and keeps the setting when it allows
  // it; otherwise it starts where the new type starts (MTCH5-08).
  const angle = angleWithoutBeats(draft.angle, typeKey);
  const setting = angle.setting ?? 'ring';
  const next =
    settings === undefined || settings.includes(setting)
      ? angle
      : { angleTypeKey: typeKey, setting: settings[0] ?? 'ring' };
  return { draft: { ...draft, participants: kept, angle: next }, sideCount };
}

/** A participant with no client. */
function withoutClient(person: ParticipantDraft): ParticipantDraft {
  const copy = { ...person };
  delete copy.forPersonId;
  return copy;
}

/** MTCH5-08: where a talking segment happens. Only an angle has a setting. */
export function setSetting(state: SegmentDraftState, setting: AngleSetting): SegmentDraftState {
  const { draft } = state;
  if (draft.kind !== 'angle' || draft.angle.setting === setting) return state;
  return { ...state, draft: { ...draft, angle: { ...draft.angle, setting } } };
}

/** The part someone plays in a talking segment. */
export interface TalkPartChoice {
  readonly talkRole: TalkRole;
  /** The client a manager is with. */
  readonly forPersonId?: PersonId;
}

/**
 * MTCH5-08: the part someone plays in a talking segment, and the client a manager is with. Only
 * a speaker has one; anyone else is left as they are.
 */
export function setTalkPart(
  state: SegmentDraftState,
  personId: PersonId,
  part: TalkPartChoice,
): SegmentDraftState {
  const { draft } = state;
  if (draft.kind !== 'angle') return state;
  const index = draft.participants.findIndex((person) => person.personId === personId);
  const current = draft.participants[index];
  if (current?.role !== 'speaker') return state;
  const forPersonId =
    part.talkRole === 'manager' && part.forPersonId !== personId ? part.forPersonId : undefined;
  if (current.talkRole === part.talkRole && current.forPersonId === forPersonId) return state;
  const next: ParticipantDraft = {
    ...withoutClient(current),
    talkRole: part.talkRole,
    ...(forPersonId === undefined ? {} : { forPersonId }),
  };
  const participants = draft.participants.map((person, at) => (at === index ? next : person));
  return { ...state, draft: { ...draft, participants } };
}

/**
 * Puts someone on a side. Someone already in the segment stays where they are. In a talking
 * segment they play `part` (MTCH5-08; a wrestler when left out).
 */
export function addPerson(
  state: SegmentDraftState,
  side: number,
  personId: PersonId,
  teamId: TeamId | null = null,
  part?: TalkPartChoice,
): SegmentDraftState {
  const { draft } = state;
  if (side < 0 || side >= state.sideCount) return state;
  if (draft.participants.some((person) => person.personId === personId)) return state;
  const talk =
    draft.kind === 'angle'
      ? {
          talkRole: part?.talkRole ?? 'wrestler',
          ...(part?.talkRole === 'manager' && part.forPersonId !== undefined
            ? { forPersonId: part.forPersonId }
            : {}),
        }
      : {};
  const added: ParticipantDraft = { personId, side, role: roleFor(draft), teamId, ...talk };
  return { ...state, draft: withParticipants(draft, [...draft.participants, added]) };
}

/** Takes someone out of the segment. */
export function removePerson(state: SegmentDraftState, personId: PersonId): SegmentDraftState {
  const { draft } = state;
  const kept = draft.participants
    .filter((person) => person.personId !== personId)
    // A manager whose client leaves is no longer with anyone.
    .map((person) => (person.forPersonId === personId ? withoutClient(person) : person));
  if (kept.length === draft.participants.length) return state;
  return { ...state, draft: withParticipants(draft, kept) };
}

/** One more side, up to the type's most. */
export function addSide(state: SegmentDraftState, limits: SideLimits): SegmentDraftState {
  if (state.sideCount >= limits.max) return state;
  return { ...state, sideCount: state.sideCount + 1 };
}

/**
 * Removes a side and the people on it; the sides after it move up one. A planned win for the
 * removed side is cleared, and one for a later side follows it.
 */
export function removeSide(
  state: SegmentDraftState,
  side: number,
  limits: SideLimits,
): SegmentDraftState {
  if (state.sideCount <= limits.min || side < 0 || side >= state.sideCount) return state;
  const { draft } = state;
  const participants = draft.participants
    .filter((person) => person.side !== side)
    .map((person) => (person.side > side ? { ...person, side: person.side - 1 } : person));
  const sideCount = state.sideCount - 1;
  if (draft.kind === 'match') {
    let outcome = draft.outcome;
    if (outcome?.kind === 'win') {
      if (outcome.winningSide === side) outcome = null;
      else if (outcome.winningSide > side)
        outcome = { ...outcome, winningSide: outcome.winningSide - 1 };
    }
    return { draft: { ...draft, participants, outcome }, sideCount };
  }
  return { draft: withParticipants(draft, participants), sideCount };
}

/** The titles on the line. Only a match carries titles. */
export function setTitles(
  state: SegmentDraftState,
  titleIds: readonly TitleId[],
): SegmentDraftState {
  const { draft } = state;
  if (draft.kind !== 'match') return state;
  return { ...state, draft: { ...draft, match: { ...draft.match, titleIds: [...titleIds] } } };
}

/**
 * The Result-list choice: a planned outcome, Auto or Random (decided on the night, MTCH2-08), or
 * null for nothing picked yet. Only a match has one.
 */
export function setResult(state: SegmentDraftState, result: PlannedResult): SegmentDraftState {
  const { draft } = state;
  if (draft.kind !== 'match') return state;
  const within =
    result === 'auto' || result === 'random' ? result : outcomeWithin(result, state.sideCount);
  return { ...state, draft: withPlannedResult(draft, within) };
}

/** The billing line as typed; {@link draftForSave} trims it. */
export function setLabel(state: SegmentDraftState, label: string): SegmentDraftState {
  return { ...state, draft: { ...state.draft, label: label.slice(0, LABEL_MAX_LENGTH) } };
}

/**
 * A registered section's change to its own part of the draft. A patch for the other kind's
 * details (an angle's beats on a match) is ignored rather than written.
 */
export function patchDraft(
  state: SegmentDraftState,
  sectionId: string,
  partial: SegmentDraftPatch,
): SegmentDraftState {
  if (sectionId === '') return state;
  const { draft } = state;
  const base = {
    ...(partial.label === undefined ? {} : { label: partial.label }),
    ...(partial.storylineIds === undefined ? {} : { storylineIds: [...partial.storylineIds] }),
    ...(partial.crew === undefined ? {} : { crew: partial.crew }),
  };
  if (draft.kind === 'match') {
    return {
      ...state,
      draft: {
        ...draft,
        ...base,
        ...(partial.match === undefined ? {} : { match: { ...draft.match, ...partial.match } }),
        ...(partial.outcome === undefined
          ? {}
          : { outcome: outcomeWithin(partial.outcome, state.sideCount) }),
      },
    };
  }
  return {
    ...state,
    draft: {
      ...draft,
      ...base,
      ...(partial.angle === undefined ? {} : { angle: { ...draft.angle, ...partial.angle } }),
    },
  };
}

/** The draft as it is saved: the billing line trimmed, and null when it is blank. */
export function draftForSave(draft: SegmentDraft): SegmentDraft {
  const label = draft.label?.trim() ?? '';
  return { ...draft, label: label === '' ? null : label };
}

/** True when two drafts would save the same segment. */
export function sameDraft(left: SegmentDraft, right: SegmentDraft): boolean {
  return JSON.stringify(draftForSave(left)) === JSON.stringify(draftForSave(right));
}

/** The people on one side, in the order they were added. */
export function peopleOnSide(draft: SegmentDraft, side: number): readonly ParticipantDraft[] {
  return draft.participants.filter((person) => person.side === side);
}

/**
 * Why the draft can't be saved yet, or null when it can: a match needs people on at least two
 * sides, a talking segment at least one speaker. Everything finer is the engine's to judge.
 */
export function unsaveableReason(draft: SegmentDraft): string | null {
  if (draft.kind === 'match') {
    const sides = new Set(
      draft.participants
        .filter((person) => person.role === 'competitor')
        .map((person) => person.side),
    );
    return sides.size >= 2 ? null : 'Put someone on at least two sides to save this match.';
  }
  return draft.participants.some((person) => person.role === 'speaker')
    ? null
    : 'Add at least one speaker to save this talking segment.';
}

interface DraftSession {
  /** The draft the sheet opened on, to tell whether anything changed. */
  readonly base: SegmentDraft;
  readonly state: SegmentDraftState;
}

type DraftAction =
  | { readonly type: 'reset'; readonly session: DraftSession }
  | { readonly type: 'apply'; readonly change: (state: SegmentDraftState) => SegmentDraftState };

function draftReducer(session: DraftSession, action: DraftAction): DraftSession {
  if (action.type === 'reset') return action.session;
  const state = action.change(session.state);
  return state === session.state ? session : { ...session, state };
}

export interface SegmentDraftControls {
  readonly state: SegmentDraftState;
  /** True when the draft differs from the one the sheet opened on. */
  readonly dirty: boolean;
  readonly setType: (
    typeKey: ContentKey,
    limits: SideLimits,
    allowsTitles?: boolean,
    settings?: readonly AngleSetting[],
  ) => void;
  readonly addPerson: (
    side: number,
    personId: PersonId,
    teamId?: TeamId | null,
    part?: TalkPartChoice,
  ) => void;
  readonly setSetting: (setting: AngleSetting) => void;
  readonly setTalkPart: (personId: PersonId, part: TalkPartChoice) => void;
  readonly removePerson: (personId: PersonId) => void;
  readonly addSide: (limits: SideLimits) => void;
  readonly removeSide: (side: number, limits: SideLimits) => void;
  readonly setTitles: (titleIds: readonly TitleId[]) => void;
  readonly setResult: (result: PlannedResult) => void;
  readonly setLabel: (label: string) => void;
  readonly patch: (sectionId: string, partial: SegmentDraftPatch) => void;
  /**
   * Starts a new session on `state`, which also becomes the unchanged base. Called when the
   * sheet opens; a refetched card never calls it, so the booker's edits survive.
   */
  readonly start: (state: SegmentDraftState) => void;
  /** Replaces the draft (a new kind, say) and keeps the base, so the sheet still counts as changed. */
  readonly replace: (state: SegmentDraftState) => void;
}

/** The draft for the open sheet, from {@link SegmentDraftControls.start} on. */
export function useSegmentDraft(placeholder: SegmentDraftState): SegmentDraftControls {
  const [session, dispatch] = useReducer(draftReducer, {
    base: placeholder.draft,
    state: placeholder,
  });
  const apply = useCallback((change: (current: SegmentDraftState) => SegmentDraftState) => {
    dispatch({ type: 'apply', change });
  }, []);
  const { state, base } = session;
  const dirty = useMemo(() => !sameDraft(state.draft, base), [state.draft, base]);
  return useMemo(
    () => ({
      state,
      dirty,
      setType: (typeKey, limits, allowsTitles, settings) => {
        apply((current) => setType(current, typeKey, limits, allowsTitles, settings));
      },
      addPerson: (side, personId, teamId, part) => {
        apply((current) => addPerson(current, side, personId, teamId ?? null, part));
      },
      setSetting: (setting) => {
        apply((current) => setSetting(current, setting));
      },
      setTalkPart: (personId, part) => {
        apply((current) => setTalkPart(current, personId, part));
      },
      removePerson: (personId) => {
        apply((current) => removePerson(current, personId));
      },
      addSide: (limits) => {
        apply((current) => addSide(current, limits));
      },
      removeSide: (side, limits) => {
        apply((current) => removeSide(current, side, limits));
      },
      setTitles: (titleIds) => {
        apply((current) => setTitles(current, titleIds));
      },
      setResult: (result) => {
        apply((current) => setResult(current, result));
      },
      setLabel: (label) => {
        apply((current) => setLabel(current, label));
      },
      patch: (sectionId, partial) => {
        apply((current) => patchDraft(current, sectionId, partial));
      },
      start: (next) => {
        dispatch({ type: 'reset', session: { base: next.draft, state: next } });
      },
      replace: (next) => {
        apply(() => next);
      },
    }),
    [apply, dirty, state],
  );
}
