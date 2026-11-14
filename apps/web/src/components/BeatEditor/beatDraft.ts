import type { PersonId } from '@ringside/engine';

/** A person in one of a beat's groups. */
export interface PersonChip {
  readonly id: PersonId;
  readonly name: string;
}

/** One group of a beat as the editor needs it: the engine's `BeatGroupOption` fits. */
export interface BeatGroupOption {
  /** From the catalog, such as "Attackers" or "Host". */
  readonly label: string;
  readonly minPeople: number;
  readonly maxPeople: number;
  /** Only ever true for a second group. */
  readonly optional: boolean;
}

/** A beat the angle type allows, as the editor needs it: the engine's `BeatOption` fits. */
export interface BeatOption {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  /** One or two groups; the first is never optional. */
  readonly groups: readonly BeatGroupOption[];
  readonly physical: boolean;
}

/** One beat being built. `id` is a key made on the client, never saved. */
export interface BeatDraft {
  readonly id: string;
  readonly beatKey: string;
  readonly groupOne: readonly PersonChip[];
  readonly groupTwo: readonly PersonChip[];
}

/** How many beats the slot allows and the words for it ("Short slot: up to 2 beats"). */
export interface BeatLimit {
  readonly max: number;
  readonly message: string;
}

/** A person a beat change took out, and why. */
export interface DroppedPerson {
  readonly person: PersonChip;
  readonly reason: string;
}

export interface ChangedBeat {
  readonly beat: BeatDraft;
  readonly dropped: readonly DroppedPerson[];
}

/** The beats with the one at `from` moved to `to` (both 0-based); the others shift. */
export function moveBeat<T>(beats: readonly T[], from: number, to: number): T[] {
  const next = [...beats];
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}

function keepUpTo(
  people: readonly PersonChip[],
  group: BeatGroupOption | undefined,
  beatName: string,
  dropped: DroppedPerson[],
): PersonChip[] {
  if (group === undefined) {
    for (const person of people) {
      dropped.push({ person, reason: `${beatName} has no second group` });
    }
    return [];
  }
  const kept = people.slice(0, group.maxPeople);
  for (const person of people.slice(group.maxPeople)) {
    dropped.push({
      person,
      reason: `${beatName} takes up to ${String(group.maxPeople)} in ${group.label}`,
    });
  }
  return kept;
}

/**
 * The beat turned into `option`. People keep their group (group one stays group one) when the new
 * beat has it and room for them; the rest are dropped and listed with the reason.
 */
export function changeBeatKey(beat: BeatDraft, option: BeatOption): ChangedBeat {
  const dropped: DroppedPerson[] = [];
  const groupOne = keepUpTo(beat.groupOne, option.groups[0], option.name, dropped);
  const groupTwo = keepUpTo(beat.groupTwo, option.groups[1], option.name, dropped);
  return { beat: { ...beat, beatKey: option.key, groupOne, groupTwo }, dropped };
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

/** "Removed Tobin Vasquell: Promo has no second group", one sentence per reason; '' for none. */
export function droppedPeopleMessage(dropped: readonly DroppedPerson[]): string {
  const byReason = new Map<string, string[]>();
  for (const { person, reason } of dropped) {
    const names = byReason.get(reason) ?? [];
    names.push(person.name);
    byReason.set(reason, names);
  }
  return [...byReason]
    .map(([reason, names]) => `Removed ${joinNames(names)}: ${reason}.`)
    .join(' ');
}

/** True while another beat fits the slot. */
export function canAddBeat(beats: readonly unknown[], limit: BeatLimit): boolean {
  return beats.length < limit.max;
}

/** How many beats are past the slot's limit; 0 when they fit. */
export function overLimitBy(beats: readonly unknown[], limit: BeatLimit): number {
  return Math.max(0, beats.length - limit.max);
}

/**
 * What the editor says about the limit: nothing while there is room, the limit message when full,
 * and what to remove when over ("Short slot: up to 2 beats. Remove 1 beat to run.").
 */
export function limitText(beats: readonly unknown[], limit: BeatLimit): string {
  if (canAddBeat(beats, limit)) return '';
  const over = overLimitBy(beats, limit);
  if (over === 0) return limit.message;
  const base = limit.message.replace(/\.\s*$/u, '');
  return `${base}. Remove ${String(over)} ${over === 1 ? 'beat' : 'beats'} to run.`;
}

/** A new beat of `option` with nobody in it. */
export function newBeatDraft(option: BeatOption, id: string): BeatDraft {
  return { id, beatKey: option.key, groupOne: [], groupTwo: [] };
}

/** An id no beat in `beats` uses yet: `beat-1`, `beat-2`, ... */
export function nextBeatId(beats: readonly BeatDraft[]): string {
  const taken = new Set(beats.map((beat) => beat.id));
  let index = beats.length + 1;
  while (taken.has(`beat-${String(index)}`)) index += 1;
  return `beat-${String(index)}`;
}
