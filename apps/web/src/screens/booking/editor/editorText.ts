/**
 * The segment editor's words and catalog readings: limits as short text, side names and the
 * number of sides a type allows. Pure, so the sheet and its tests read them the same way.
 */
import { rolesPhrase, TALK_ROLE_LABELS } from '@ringside/engine';
import type {
  AngleSetting,
  AngleTypeOption,
  BeatGroupOption,
  BookingCard,
  BookingSlotView,
  CountRange,
  MatchCatalog,
  MatchTypeOption,
  MethodOption,
  SegmentDraft,
  SegmentId,
  TalkRole,
} from '@ringside/engine';
import type { SegmentEditorRequest } from './editorStore';
import type { SideLimits } from './useSegmentDraft';

/** "1", or "2–4". */
function rangeText(range: CountRange): string {
  return range.min === range.max ? String(range.min) : `${String(range.min)}–${String(range.max)}`;
}

/** "2 sides · 1 each", "6–30 sides · 1 each", "2 sides · 1–3 each". */
export function matchLimitsText(matchType: Pick<MatchTypeOption, 'sides' | 'sideSize'>): string {
  const sides = `${rangeText(matchType.sides)} ${matchType.sides.max === 1 ? 'side' : 'sides'}`;
  return `${sides} · ${rangeText(matchType.sideSize)} each`;
}

/** "1–4 speakers", "2–8 speakers". */
export function angleLimitsText(angleType: Pick<AngleTypeOption, 'speakers'>): string {
  return `${rangeText(angleType.speakers)} ${angleType.speakers.max === 1 ? 'speaker' : 'speakers'}`;
}

/** "Side 1" for stored side 0. */
export function sideLabel(side: number): string {
  return `Side ${String(side + 1)}`;
}

/** The sides the editor offers: a match type's own; a talking segment one, or two to face off. */
export function sideLimitsOf(
  kind: SegmentDraft['kind'],
  matchType: MatchTypeOption | undefined,
  angleType: AngleTypeOption | undefined,
): SideLimits {
  if (kind === 'match') {
    return matchType === undefined ? { min: 2, max: 2 } : matchType.sides;
  }
  return { min: 1, max: angleType !== undefined && angleType.speakers.max > 1 ? 2 : 1 };
}

/** The catalog's types for a kind, in catalog order, hiding hidden ones except `keep`. */
export function typeOptionsFor(
  catalog: MatchCatalog,
  kind: SegmentDraft['kind'],
  keep: string,
): readonly (MatchTypeOption | AngleTypeOption)[] {
  const list: readonly (MatchTypeOption | AngleTypeOption)[] =
    kind === 'match' ? catalog.matchTypes : catalog.angleTypes;
  return [...list]
    .filter((option) => !option.hidden || option.key === keep)
    .sort((left, right) => left.order - right.order);
}

/** The win methods in catalog order, hiding hidden ones except `keep`. */
export function methodOptions(catalog: MatchCatalog, keep: string | null): readonly MethodOption[] {
  return [...catalog.methods]
    .filter((method) => !method.hidden || method.key === keep)
    .sort((left, right) => left.order - right.order);
}

/** The first method that can move a title, else the first method: a new win's default. */
export function defaultMethod(methods: readonly MethodOption[]): MethodOption | undefined {
  return methods.find((method) => method.changesTitles) ?? methods[0];
}

/** The slot a request is about, from the loaded card. */
export function slotOfRequest(
  request: SegmentEditorRequest,
  card: BookingCard,
): BookingSlotView | null {
  const slots = card.sections.flatMap((section) => section.slots);
  if (request.mode === 'new') {
    return (
      slots.find((slot) => slot.preShow === request.preShow && slot.slot === request.slot) ?? null
    );
  }
  return slots.find((slot) => slot.segment?.segmentId === request.segmentId) ?? null;
}

/** "Slot 3 · Midcard", "Pre-show slot 1". */
export function slotTitle(slot: BookingSlotView): string {
  if (slot.preShow) return `Pre-show slot ${String(slot.displayNumber)}`;
  return `Slot ${String(slot.displayNumber)} · ${slot.roleLabel}`;
}

/** The sheet's title for a request: the slot's name, or a plain one while the card has no slot. */
export function segmentEditorTitle(request: SegmentEditorRequest, card: BookingCard): string {
  const slot = slotOfRequest(request, card);
  if (slot !== null) return slotTitle(slot);
  return request.mode === 'new' ? 'New segment' : 'Edit segment';
}

/**
 * How the card names another slot in "On this card: …": its role for the opener, semi-main and
 * main event, otherwise its number, as the booking checks do.
 */
export function slotNameOnCard(card: BookingCard, segmentId: SegmentId, fallback: string): string {
  const slot = card.sections
    .flatMap((section) => section.slots)
    .find((candidate) => candidate.segment?.segmentId === segmentId);
  if (slot === undefined) return fallback;
  if (slot.role === 'opener' || slot.role === 'semiMain' || slot.role === 'mainEvent') {
    return slot.roleLabel;
  }
  return slot.preShow
    ? `Pre-show slot ${String(slot.displayNumber)}`
    : `Slot ${String(slot.displayNumber)}`;
}

/**
 * A team with its wrestlers by name, so a team is never only its name: "Running Axe (Kai Moreno &
 * Rex Hale)". Just the team's name when it has no members to list.
 */
export function teamWithMembers(teamName: string, memberNames: readonly string[]): string {
  return memberNames.length === 0 ? teamName : `${teamName} (${memberNames.join(' & ')})`;
}

/** "Rhea Cortez", "Kai Moreno and Tia Cruz", "A, B and C". */
export function namesText(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

// ---------------------------------------------------------------------------------------------
// MTCH5-08: who plays which part, and where

/**
 * The beat group a side of a talking segment fills: the type's default beat splits its people by
 * side, the first side into its first group and every other side into its second. A one-group beat
 * puts every side in its one group. Null without a beat catalog.
 */
export function sideGroupOf(
  catalog: Pick<MatchCatalog, 'beats'>,
  angleType: Pick<AngleTypeOption, 'defaultBeatKey'> | undefined,
  side: number,
): BeatGroupOption | null {
  if (angleType === undefined) return null;
  const beat = catalog.beats.find((option) => option.key === angleType.defaultBeatKey);
  if (beat === undefined) return null;
  return (side === 0 ? beat.groups[0] : (beat.groups[1] ?? beat.groups[0])) ?? null;
}

/** True when the default beat has two groups, so each side has a name of its own. */
export function sidesAreGroups(
  catalog: Pick<MatchCatalog, 'beats'>,
  angleType: Pick<AngleTypeOption, 'defaultBeatKey'> | undefined,
): boolean {
  if (angleType === undefined) return false;
  const beat = catalog.beats.find((option) => option.key === angleType.defaultBeatKey);
  return (beat?.groups.length ?? 0) > 1;
}

/** What each setting means for the score, in the setting choice. */
export const SETTING_HINTS: Readonly<Record<AngleSetting, string>> = {
  ring: 'Live in front of the crowd.',
  backstage:
    'The crowd watches on screen: scored mostly on mic and acting, and usually a short segment.',
  video: 'Played on the screen: scored mostly on mic and acting.',
};

/** "Manager for Kai Moreno", "Interviewer", "Manager". */
export function partLabel(talkRole: TalkRole, clientName: string | null): string {
  return talkRole === 'manager' && clientName !== null
    ? `Manager for ${clientName}`
    : TALK_ROLE_LABELS[talkRole];
}

/** "Host is for an interviewer", or null when the part suits the group (or it takes anyone). */
export function partMismatch(
  group: Pick<BeatGroupOption, 'label' | 'roles'> | null,
  talkRole: TalkRole,
): string | null {
  if (group === null || group.roles.length === 0 || group.roles.includes(talkRole)) return null;
  return `${group.label} is for ${rolesPhrase(group.roles)}`;
}
