import type {
  AngleTemplateOption,
  AngleTypeOption,
  BeatOption as EngineBeatOption,
  ContentKey,
  DurationClass,
  PersonId,
  PreviewAngleArgs,
  PreviewAngleResult,
  TraceNode,
  TunableRow,
} from '@ringside/engine';
import { BEAT_LIMIT_KEYS, MAX_ANGLE_BEATS, beatLimitMessage, fitTemplate } from '@ringside/engine';
import type { BeatDraft, BeatLimit, BeatScore, PersonChip } from '@/components/BeatEditor';
import { newBeatDraft } from '@/components/BeatEditor';
import type { LabAngleDraft, LabSetup } from '../labStore';

/**
 * Angle mode's rules (MTCH5-05), kept apart from the screen so they can be tested on their own:
 * which types and beats are offered, how a template fills the editor, the beat limit before the
 * first Run, what Run sends and why it can't go yet.
 */

/** The catalog slice Angle mode reads. */
export interface AngleCatalog {
  readonly angleTypes: readonly AngleTypeOption[];
  readonly beats: readonly EngineBeatOption[];
  readonly angleTemplates: readonly AngleTemplateOption[];
}

/** Until the slot is read: no limit narrower than what an angle can hold at all. */
export const UNKNOWN_LIMIT: BeatLimit = {
  max: MAX_ANGLE_BEATS,
  message: `Up to ${String(MAX_ANGLE_BEATS)} beats`,
};

/** The angle types the lab offers: every type that is not hidden, in catalog order. */
export function visibleAngleTypes(catalog: AngleCatalog): readonly AngleTypeOption[] {
  return catalog.angleTypes.filter((type) => !type.hidden);
}

/** The beats an angle type allows, its default beat first (that is what "Add beat" adds). */
export function beatOptionsFor(
  catalog: AngleCatalog,
  angleType: AngleTypeOption | undefined,
): readonly EngineBeatOption[] {
  if (angleType === undefined) return [];
  const allowed = catalog.beats.filter((beat) => angleType.beatKeys.includes(beat.key));
  const first = allowed.find((beat) => beat.key === angleType.defaultBeatKey);
  return first === undefined ? allowed : [first, ...allowed.filter((beat) => beat !== first)];
}

/** A fresh draft for `angleTypeKey`: one beat, the type's default, with nobody in it yet. */
export function freshAngleDraft(
  catalog: AngleCatalog,
  angleTypeKey: ContentKey | null,
): LabAngleDraft {
  const angleType = catalog.angleTypes.find((type) => type.key === angleTypeKey);
  const [first] = beatOptionsFor(catalog, angleType);
  return {
    angleTypeKey: angleType?.key ?? null,
    beats: first === undefined ? [] : [newBeatDraft(first, 'beat-1')],
    managerOverrides: {},
    people: {},
  };
}

/** The templates of one angle type, in catalog order. */
export function templatesFor(
  catalog: AngleCatalog,
  angleTypeKey: ContentKey | null,
): readonly AngleTemplateOption[] {
  return catalog.angleTemplates.filter((template) => template.angleTypeKey === angleTypeKey);
}

/**
 * A template's beats as drafts, trimmed to `max` the way the engine's `fitTemplate` does (optional
 * beats dropped from the front first), with every group empty. Null when even its required beats
 * don't fit.
 */
export function templateDrafts(template: AngleTemplateOption, max: number): BeatDraft[] | null {
  const fitted = fitTemplate(template, max);
  if (fitted === null) return null;
  return fitted.beats.map((beat, index) => ({
    id: `beat-${String(index + 1)}`,
    beatKey: beat.beatKey,
    groupOne: [],
    groupTwo: [],
  }));
}

/** True when a draft has someone in any beat. */
export function hasPeople(beats: readonly BeatDraft[]): boolean {
  return beats.some((beat) => beat.groupOne.length > 0 || beat.groupTwo.length > 0);
}

/**
 * The beat limit before any Run, from the slot's duration class and the `match.angle.maxBeats.*`
 * tunables; {@link UNKNOWN_LIMIT} until both are read.
 */
export function limitFromTunables(
  durationClass: DurationClass | undefined,
  tunables: readonly TunableRow[] | undefined,
): BeatLimit {
  if (durationClass === undefined || tunables === undefined) return UNKNOWN_LIMIT;
  const row = tunables.find((entry) => entry.key === BEAT_LIMIT_KEYS[durationClass]);
  if (row === undefined || typeof row.value !== 'number') return UNKNOWN_LIMIT;
  const max = Math.min(row.value, MAX_ANGLE_BEATS);
  return { max, message: beatLimitMessage(durationClass, max) };
}

/** Everyone in any beat, each once, in order of first appearance. */
export function peopleInBeats(beats: readonly BeatDraft[]): PersonChip[] {
  const seen = new Map<PersonId, PersonChip>();
  for (const beat of beats) {
    for (const person of [...beat.groupOne, ...beat.groupTwo]) {
      if (!seen.has(person.id)) seen.set(person.id, person);
    }
  }
  return [...seen.values()];
}

/** The groups of a beat that still need someone, by label: a required group with nobody in it. */
export function emptyRequiredGroups(
  beat: BeatDraft,
  option: EngineBeatOption | undefined,
): readonly string[] {
  if (option === undefined) return [];
  if (option.groups.length === 1) {
    const [group] = option.groups;
    const people = beat.groupOne.length + beat.groupTwo.length;
    return people === 0 && group !== undefined ? [group.label] : [];
  }
  return option.groups.flatMap((group, index) => {
    const people = index === 0 ? beat.groupOne : beat.groupTwo;
    return people.length === 0 && !group.optional ? [group.label] : [];
  });
}

/** What Angle mode's Run needs besides the beats: the show and the promotion. */
export type AngleShow = Pick<
  LabSetup,
  'slotRole' | 'importance' | 'regionId' | 'televised' | 'promotionId'
>;

/**
 * Why Run can't go yet, in player words, or null when it can. The first missing thing wins: the
 * type, the region, the promotion, a day still running, the limit, then the first beat with an
 * empty required group ("Add someone to beat 1 to run").
 */
export function angleBlocker(input: {
  readonly show: AngleShow;
  readonly draft: LabAngleDraft;
  readonly beatOptions: readonly EngineBeatOption[];
  readonly limit: BeatLimit;
  readonly advancing: boolean;
  readonly busyText: string;
}): string | null {
  const { show, draft, beatOptions, limit, advancing, busyText } = input;
  if (draft.angleTypeKey === null) return 'Pick a type first';
  if (show.regionId === null) return 'Pick a region first';
  if (show.promotionId === null) return 'Run a promotion to use the Match lab';
  if (advancing) return busyText;
  if (draft.beats.length > limit.max) return limit.message;
  for (const [index, beat] of draft.beats.entries()) {
    const option = beatOptions.find((entry) => entry.key === beat.beatKey);
    const missing = emptyRequiredGroups(beat, option);
    if (missing.length === 0) continue;
    const place = `beat ${String(index + 1)}`;
    const empty = beat.groupOne.length + beat.groupTwo.length === 0;
    return empty
      ? `Add someone to ${place} to run`
      : `Add someone to ${missing.join(' and ')} in ${place} to run`;
  }
  return null;
}

/**
 * The `match.previewAngle` arguments Run sends with `previewSeed`, or null while something is
 * missing. Only the manager what-ifs of people in a beat go along.
 */
export function angleArgsOf(
  show: AngleShow,
  draft: LabAngleDraft,
  beatOptions: readonly EngineBeatOption[],
  previewSeed: number,
): PreviewAngleArgs | null {
  if (draft.angleTypeKey === null || show.regionId === null || show.promotionId === null) {
    return null;
  }
  const keys = new Map(beatOptions.map((option) => [String(option.key), option.key]));
  const beats: PreviewAngleArgs['beats'] = [];
  for (const beat of draft.beats) {
    const beatKey = keys.get(beat.beatKey);
    if (beatKey === undefined) return null;
    beats.push({
      beatKey,
      groupOne: beat.groupOne.map((person) => person.id),
      groupTwo: beat.groupTwo.map((person) => person.id),
    });
  }
  if (beats.length === 0) return null;
  const managerOverrides: Record<PersonId, PersonId | null> = {};
  for (const person of peopleInBeats(draft.beats)) {
    const override = draft.managerOverrides[person.id];
    if (override !== undefined) managerOverrides[person.id] = override;
  }
  return {
    importance: show.importance,
    regionId: show.regionId,
    televised: show.televised,
    slotRole: show.slotRole,
    promotionId: show.promotionId,
    angleTypeKey: draft.angleTypeKey,
    beats,
    ...(Object.keys(managerOverrides).length === 0 ? {} : { managerOverrides }),
    previewSeed,
    // MTCH5-06: the lab's Aftermath panel shows what the angle would do to everyone in it.
    aftermath: true,
  };
}

/** True when two angle previews rate the same angle, whatever their seeds. */
export function sameAngle(left: PreviewAngleArgs, right: PreviewAngleArgs): boolean {
  return (
    JSON.stringify({ ...left, previewSeed: 0 }) === JSON.stringify({ ...right, previewSeed: 0 })
  );
}

/**
 * The editor's score chips from a result: each beat's score keyed by the draft's id, matched by
 * place, and only while the beat in that place is still the one rated. Uncounted beats are left
 * out.
 */
export function beatScoresOf(
  beats: readonly BeatDraft[],
  result: PreviewAngleResult | null,
): Record<string, BeatScore> {
  const scores: Record<string, BeatScore> = {};
  if (result === null) return scores;
  for (const [index, beat] of beats.entries()) {
    const rated = result.beats[index];
    if (rated?.score == null || rated.beatKey !== beat.beatKey) continue;
    scores[beat.id] = { value: rated.score.value, trace: rated.score.trace };
  }
  return scores;
}

/** The first node under `node` (itself included) with this label, depth first. */
export function findTraceNode(node: TraceNode, label: string): TraceNode | null {
  if (node.label === label) return node;
  for (const child of node.children ?? []) {
    const found = findTraceNode(child, label);
    if (found !== null) return found;
  }
  return null;
}
