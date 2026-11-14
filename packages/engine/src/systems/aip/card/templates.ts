/**
 * Talking segments from angle templates (MTCH5-06): once the running order has put a rival's
 * talking segment in its slot, the booker builds it from one of MTCH5's angle templates instead of
 * the angle type's one default beat.
 *
 * 1. The purpose: a storyline segment opens a feud (`startFeud`) in the story's first
 *    {@link NEW_STORYLINE_DAYS} days and builds it (`buildFeud`) after; otherwise a title match on
 *    the card makes it a `titleChallenge`; otherwise a speaker who won a title in the last
 *    {@link RECENT_TITLE_DAYS} days `celebrate`s; otherwise it is a `promo`. When nothing of that
 *    purpose can be cast, a `promo` is tried; when nothing fits at all, the default beat stays.
 * 2. The templates of that purpose (`angleTemplatesFor`) that can be cast with the speakers: side
 *    one is `a`, every other side `b`, and a speaker who interviews (a presenter) is the `host`.
 *    Each is trimmed to the slot's beat limit (`fitTemplate`) for the setting it would happen in.
 * 3. One is picked with `rollPick` in key order, on a detached stream per show and segment
 *    (`aip.card.template`, `<instanceId>/<segmentKey>`), so no other pick on the card moves.
 * 4. The draft gets the template's angle type, setting and cast beats (`castTemplate`, stored with
 *    `toStoredBeat`, sides from `assignAngleSides`) and is written by EVT2's card writer as before.
 *
 * The choice is traced as a decision: "Template: Feud opener (fits short slot: 2 of 3 beats)".
 *
 * Design: docs/design/rival-booking.md#talking-segments and angle-rating.md#angle-templates.
 */

import { diffDays, type GameDate } from '../../../core/date';
import { detachedStream } from '../../../core/rng/registry';
import { rollPick } from '../../../core/rng/rolls';
import type { Traced } from '../../../core/trace';
import {
  angleTypeOf,
  beatOf,
  hasBeatCatalog,
  type AngleTemplatePurpose,
  type AngleTypeDef,
} from '../../../model/catalogs';
import type { AngleSetting } from '../../../model/entities/angle-setting';
import { MAX_ANGLE_BEATS } from '../../../model/entities/segment';
import type { GameWorldView } from '../../../model/tables';
import type { AngleDraft, ParticipantDraft, SegmentDraft } from '../../booking/draft';
import { assignAngleSides, toStoredBeat } from '../../match/angles/beatGroups';
import { beatLimitOf } from '../../match/angles/beatLimit';
import { angleDurationClass } from '../../match/angles/rateAngle';
import { allowsSetting, defaultSettingOf } from '../../match/angles/settings';
import {
  angleTemplatesFor,
  castTemplate,
  fitTemplate,
  type GroupedBeat,
  type TemplateCast,
  type TemplateFit,
} from '../../match/angles/templates';
import { DURATION_CLASS_LABELS, type SlotRole } from '../../match/slots';
import type { EngineTunables } from '../../tunables';
import { BookerNotes } from './notes';
import { TALKING_DOC_REF } from './tunables';
import type { CardPool } from './types';

declare module '../../../core/rng/streams' {
  interface StreamNames {
    'aip.card.template': true;
  }
}

/** The detached stream a talking segment's template is picked on. */
export const TEMPLATE_STREAM = 'aip.card.template';

/** A storyline this young (in days) is still being opened: `startFeud`, else `buildFeud`. */
export const NEW_STORYLINE_DAYS = 14;

/** A title won this recently (in days) by a speaker makes the segment a celebration. */
export const RECENT_TITLE_DAYS = 7;

/** What the booker knows about the card when it builds one talking segment. */
export interface TemplateContext {
  readonly read: GameWorldView;
  readonly tunables: EngineTunables;
  readonly pool: CardPool;
  readonly today: GameDate;
  /** The planned segment's key, for the detached stream. */
  readonly segmentKey: string;
  readonly role: SlotRole;
  /** True when the card (planned or already booked) has a title match. */
  readonly titleMatchOnCard: boolean;
}

/** A talking segment built from a template, and the decision behind it. */
export interface TemplatedAngle {
  readonly draft: AngleDraft;
  readonly trace: Traced<string>;
  /** "Template: Feud opener (fits short slot: 2 of 3 beats)". */
  readonly label: string;
}

/** "Template: Feud opener (fits short slot: 2 of 3 beats)", or "(3 beats)" when nothing dropped. */
export function templateLabel(
  name: string,
  kept: number,
  total: number,
  durationClassLabel: string,
): string {
  const beats = `${String(kept)} ${kept === 1 ? 'beat' : 'beats'}`;
  return kept === total
    ? `Template: ${name} (${beats})`
    : `Template: ${name} (fits ${durationClassLabel.toLowerCase()} slot: ${String(kept)} of ${String(total)} beats)`;
}

function purposeOf(
  context: TemplateContext,
  draft: AngleDraft,
  notes: BookerNotes,
): AngleTemplatePurpose {
  const { read, pool, today } = context;
  const [storylineId] = draft.storylineIds;
  const storyline = storylineId === undefined ? undefined : read.tables.storylines.get(storylineId);
  if (storyline !== undefined) {
    const age = diffDays(storyline.startedOn, today);
    const fresh = age < NEW_STORYLINE_DAYS;
    notes.rule(
      `"${storyline.name}" started ${String(age)} days ago: ${fresh ? 'opening the feud' : 'building the feud'}`,
      fresh,
    );
    return fresh ? 'startFeud' : 'buildFeud';
  }
  notes.rule('A title match is on the card: a title challenge', context.titleMatchOnCard);
  if (context.titleMatchOnCard) {
    return 'titleChallenge';
  }
  const speakers = new Set(draft.participants.map((participant) => participant.personId));
  const newChampion = pool.candidates.some(
    (candidate) =>
      speakers.has(candidate.personId) &&
      pool.titles.some(
        (title) =>
          title.holderIds.includes(candidate.personId) &&
          title.wonOn !== null &&
          diffDays(title.wonOn, today) <= RECENT_TITLE_DAYS,
      ),
  );
  notes.rule(`A speaker won a title in the last ${String(RECENT_TITLE_DAYS)} days`, newChampion);
  return newChampion ? 'celebrate' : 'promo';
}

/** Side one is `a`, every other side `b`; an interviewer is the host. */
function castOf(participants: readonly ParticipantDraft[]): TemplateCast {
  const host = participants.find((participant) => participant.talkRole === 'interviewer');
  const talkers = participants.filter((participant) => participant !== host);
  return {
    a: talkers.filter((participant) => participant.side === 0).map((p) => p.personId),
    b: talkers.filter((participant) => participant.side !== 0).map((p) => p.personId),
    host: host?.personId ?? null,
  };
}

/** Where a template's angle happens: its own setting, or the rolled one when its type allows it. */
function settingFor(fit: TemplateFit, angleType: AngleTypeDef, rolled: AngleSetting): AngleSetting {
  if (fit.template.setting !== undefined) {
    return fit.template.setting;
  }
  return allowsSetting(angleType, rolled) ? rolled : defaultSettingOf(angleType);
}

interface Castable {
  readonly fit: TemplateFit;
  readonly angleType: AngleTypeDef;
  readonly setting: AngleSetting;
  readonly beats: readonly GroupedBeat[];
  readonly durationClassLabel: string;
}

/** The template fitted to its setting's slot and cast, or null when it can't be. */
function castable(
  context: TemplateContext,
  listed: TemplateFit,
  cast: TemplateCast,
  speakerCount: number,
  rolled: AngleSetting,
): Castable | null {
  const { read, tunables } = context;
  const angleType = angleTypeOf(read, listed.template.angleTypeKey);
  if (
    angleType === undefined ||
    angleType.hidden ||
    speakerCount < angleType.speakers.min ||
    speakerCount > angleType.speakers.max
  ) {
    return null;
  }
  const setting = settingFor(listed, angleType, rolled);
  if (!allowsSetting(angleType, setting)) {
    return null;
  }
  const durationClass = angleDurationClass(context.role, setting, tunables);
  const fitted = fitTemplate(listed.template, beatLimitOf(durationClass, tunables).value);
  if (fitted === null) {
    return null;
  }
  const fit: TemplateFit = { template: listed.template, ...fitted };
  const beats = castTemplate({ beats: [...fit.beats] }, cast);
  if (beats.length === 0) {
    return null;
  }
  for (const beat of beats) {
    const catalogBeat = beatOf(read, beat.beatKey);
    if (catalogBeat === undefined || !allowsSetting(catalogBeat, setting)) {
      return null;
    }
    const second = catalogBeat.groups[1];
    if (second !== undefined && !second.optional && beat.groupTwo.length === 0) {
      return null;
    }
  }
  return {
    fit,
    angleType,
    setting,
    beats,
    durationClassLabel: DURATION_CLASS_LABELS[durationClass],
  };
}

/**
 * The talking segment built from a template, or null to keep the default beat (a save without a
 * beat catalog, a draft that already has beats, or no template that can be cast).
 */
export function templatedAngle(
  context: TemplateContext,
  draft: SegmentDraft,
): TemplatedAngle | null {
  const { read } = context;
  if (draft.kind !== 'angle' || draft.angle.beats !== undefined || !hasBeatCatalog(read)) {
    return null;
  }
  const notes = new BookerNotes();
  const purpose = purposeOf(context, draft, notes);
  const cast = castOf(draft.participants);
  const rolledType = angleTypeOf(read, draft.angle.angleTypeKey);
  const rolled =
    draft.angle.setting ?? (rolledType === undefined ? 'ring' : defaultSettingOf(rolledType));
  const speakerCount = draft.participants.length;

  const candidatesFor = (wanted: AngleTemplatePurpose): Castable[] =>
    angleTemplatesFor(read, { purpose: wanted, maxBeats: MAX_ANGLE_BEATS }).flatMap((listed) => {
      const ready = castable(context, listed, cast, speakerCount, rolled);
      notes.consider(
        listed.template.name,
        ready === null ? 0 : 1,
        ready === null ? "Can't be cast with these speakers here" : 'Fits',
      );
      return ready === null ? [] : [ready];
    });

  let options = candidatesFor(purpose);
  if (options.length === 0 && purpose !== 'promo') {
    notes.note(`No ${purpose} template fits: trying a promo`);
    options = candidatesFor('promo');
  }
  if (options.length === 0) {
    return null;
  }
  const rng = detachedStream(
    read.meta.seed,
    TEMPLATE_STREAM,
    `${context.pool.instanceId}/${context.segmentKey}`,
  );
  const picked = rollPick(rng, options, 'Template', (option) => option.fit.template.name);
  notes.roll(picked.roll);
  const choice = picked.value;

  const sided = assignAngleSides(
    choice.beats.map((beat) => ({
      groupOne: beat.groupOne,
      groupTwo: beat.groupTwo,
      twoGroups: (beatOf(read, beat.beatKey)?.groups.length ?? 1) > 1,
    })),
  );
  const participants: ParticipantDraft[] = draft.participants.map((participant) => {
    const side = 'sides' in sided ? sided.sides[participant.personId] : undefined;
    return side === undefined ? participant : { ...participant, side };
  });
  const total = choice.fit.beats.length + choice.fit.dropped.length;
  const label = templateLabel(
    choice.fit.template.name,
    choice.fit.beats.length,
    total,
    choice.durationClassLabel,
  );
  const because =
    options.length === 1
      ? `The only ${purpose} template that fits`
      : `Picked from ${String(options.length)} templates that fit`;
  return {
    draft: {
      ...draft,
      participants,
      angle: {
        angleTypeKey: choice.angleType.key,
        beats: choice.beats.map((beat) => toStoredBeat(beat)),
        ...(choice.setting === 'ring' ? {} : { setting: choice.setting }),
      },
    },
    trace: notes.decide(label, choice.fit.template.name, because, TALKING_DOC_REF),
    label,
  };
}
