/**
 * MTCH5's Beats section in the segment editor (MTCH5-06): a talking segment's beats in the
 * BeatEditor, so it can have several. People come from the segment's own speakers, the beats from
 * the angle type's list, and the limit from the slot (and the setting the booker picked).
 *
 * Every change is written into the sheet's draft (`patch({ angle: { beats }, sides })`) and saved
 * with the segment through `booking.updateSegment`: `assignAngleSides` turns the groups into the
 * speakers' sides and `toStoredBeat` stores each beat group one first. When the groups can't be
 * stored (two people together in one beat and opposed in another) the section says why and keeps
 * the last beats that could be. Until the booker changes anything the segment keeps what it had
 * (the type's default beat for a new one), so opening the sheet never makes it "changed".
 *
 * Below the editor, a preview of the angle on a typical night (`match.previewAngle`, with the beats
 * earlier on the card for repetition): each beat's score and the angle's, each with its Why?.
 *
 * A save started before beats existed shows nothing: its talking segments keep one default beat.
 * Design: docs/design/angle-rating.md#booking.
 */
import { useId, useState } from 'react';
import type { AngleDraft, PersonId, PreviewAngleArgs } from '@ringside/engine';
import { ANGLES_TUNABLE_CATEGORY, parseContentKey, parseId } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { BeatEditor } from '@/components/BeatEditor';
import type { BeatDraft, BeatPickerArgs } from '@/components/BeatEditor';
import { Button } from '@/components/Button';
import { Stack } from '@/components/layout';
import { Sheet } from '@/components/Sheet';
import { WhyButton } from '@/components/Trace';
import {
  beatOptionsFor,
  beatScoresOf,
  limitFromTunables,
} from '@/screens/match-lab/angle/angleDraft';
import { AngleWarnings } from '@/screens/match-lab/angle/AngleResult';
import type { SegmentEditorSectionContext } from '../registries/segmentEditorSections';
import { cardNameOf, useRosterIndex } from '../editor/useRoster';
import styles from '../editor/SegmentEditor.module.css';
import {
  beatRowsOf,
  beatsToSave,
  earlierBeatKeys,
  previewBeatsOf,
  speakerChips,
} from './beatsDraft';

export const BEATS_SECTION_ID = 'match.beats';
export const BEATS_SECTION_TITLE = 'Beats';

/** Said in the picker when every speaker is already in the beat. */
export const EVERYONE_IN_BEAT_TEXT =
  'Everyone in this segment is already in this beat. Add a speaker above to bring someone new.';

/** Said under the preview: it is one typical night, not a promise. */
export const PREVIEW_HINT = 'A typical night. The real show rolls its own.';

/** The seed every preview uses, so the same beats always preview the same. */
const PREVIEW_SEED = 1;

/** The fallback name of someone the roster and the card no longer list. */
const UNKNOWN_NAME = 'Someone off the roster';

/** Stands in for the preview's arguments while it has nothing to rate; never sent. */
const UNASKED: PreviewAngleArgs = {
  importance: 'regular',
  regionId: parseId('region', 'reg_0000000001'),
  televised: false,
  slotRole: 'midcard',
  angleTypeKey: parseContentKey('angle.promo'),
  beats: [],
  previewSeed: PREVIEW_SEED,
};

interface PickerProps extends BeatPickerArgs {
  readonly speakers: readonly { readonly id: PersonId; readonly name: string }[];
}

/** The people picker: the segment's own speakers who aren't in the beat yet. */
function SpeakerPicker({ groupLabel, exclude, onPick, onClose, speakers }: PickerProps) {
  const left = speakers.filter((speaker) => !exclude.includes(speaker.id));
  return (
    <Sheet open onClose={onClose} title={`Add to ${groupLabel}`} size="sm">
      {left.length === 0 ? (
        <p className={styles['hint']}>{EVERYONE_IN_BEAT_TEXT}</p>
      ) : (
        <Stack gap={2}>
          {left.map((speaker) => (
            <Button
              key={speaker.id}
              variant="ghost"
              onClick={() => {
                onPick(speaker);
              }}
            >
              {speaker.name}
            </Button>
          ))}
        </Stack>
      )}
    </Sheet>
  );
}

/** What the section was last built from: the stored beats and who is in the segment. */
function syncKeyOf(draft: AngleDraft): string {
  return JSON.stringify([
    draft.angle.angleTypeKey,
    draft.angle.beats ?? null,
    draft.participants.map((person) => person.personId),
  ]);
}

interface BeatsSectionProps {
  readonly context: SegmentEditorSectionContext;
}

/** The section's body for a talking segment; see the file comment. */
export function BeatsSection({ context }: BeatsSectionProps) {
  const { draft } = context;
  if (draft.kind !== 'angle') return null;
  return <AngleBeats context={context} draft={draft} />;
}

function AngleBeats({
  context,
  draft,
}: BeatsSectionProps & {
  readonly draft: AngleDraft;
}) {
  const { show, slot, patch, disabled } = context;
  const conflictId = useId();
  const catalog = useEngineQuery('match.catalog', {});
  const card = useEngineQuery('booking.card', { eventInstanceId: show.eventInstanceId });
  const roster = useRosterIndex(show.eventInstanceId, 'angle');
  const setting = draft.angle.setting ?? 'ring';
  const slotInfo = useEngineQuery('match.slotInfo', {
    slotRole: slot.role,
    kind: 'angle',
    setting,
  });
  const tunables = useEngineQuery('tunables.list', { category: ANGLES_TUNABLE_CATEGORY });

  const nameOf = (personId: PersonId): string =>
    roster.people.get(personId)?.ringName ??
    (card.data === undefined ? null : cardNameOf(card.data, personId)) ??
    UNKNOWN_NAME;

  const beats = catalog.data?.beats ?? [];
  const angleType = catalog.data?.angleTypes.find((type) => type.key === draft.angle.angleTypeKey);
  const beatOptions = catalog.data === undefined ? [] : beatOptionsFor(catalog.data, angleType);

  const [rows, setRows] = useState<BeatDraft[]>([]);
  const [syncedKey, setSyncedKey] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  // Built from the draft once the catalog is in, and again when the draft changes outside the
  // section (a speaker added or removed, another type): the section's own edits set the key.
  const ready = catalog.data !== undefined;
  const key = syncKeyOf(draft);
  if (ready && key !== syncedKey) {
    setRows(beatRowsOf(draft, angleType, beats, nameOf));
    setSyncedKey(key);
    setConflict(null);
  }

  const limit = limitFromTunables(slotInfo.data?.durationClass, tunables.data);
  const speakers = speakerChips(draft, nameOf);

  const previewArgs: PreviewAngleArgs | null =
    rows.length === 0 || conflict !== null || rows.length > limit.max
      ? null
      : {
          importance: show.importance,
          regionId: show.regionId,
          televised: show.televised,
          slot: { slot: slot.slot + 1, slots: show.format.slots, preShow: slot.preShow },
          promotionId: show.promotionId,
          angleTypeKey: draft.angle.angleTypeKey,
          beats: previewBeatsOf(rows),
          earlierBeatKeysOnCard: earlierBeatKeys(card.data?.sections ?? [], slot).slice(0, 64),
          previewSeed: PREVIEW_SEED,
          setting,
        };
  const preview = useEngineQuery('match.previewAngle', previewArgs ?? UNASKED, {
    enabled: previewArgs !== null,
    keepPreviousData: true,
  });
  const shown =
    previewArgs !== null && preview.status !== 'error' && preview.data !== undefined
      ? preview.data
      : null;
  const refusals =
    previewArgs !== null && preview.status === 'error' && preview.error?.kind === 'rejected'
      ? preview.error.reasons
      : [];

  if (!ready || beats.length === 0) return null;

  const onChange = (next: BeatDraft[]): void => {
    setRows(next);
    const saved = beatsToSave(next, beats, nameOf);
    if (!saved.ok) {
      setConflict(saved.message);
      return;
    }
    setConflict(null);
    if (saved.beats.length === 0) return;
    const nextDraft: AngleDraft = {
      ...draft,
      angle: { ...draft.angle, beats: saved.beats },
    };
    setSyncedKey(syncKeyOf(nextDraft));
    patch({ angle: { beats: saved.beats }, sides: saved.sides });
  };

  return (
    <div className={styles['beats']}>
      <BeatEditor
        beats={rows}
        onChange={onChange}
        beatOptions={beatOptions}
        limit={limit}
        disabled={disabled}
        headingLevel={4}
        scores={beatScoresOf(rows, shown)}
        renderPicker={(args) => <SpeakerPicker {...args} speakers={speakers} />}
      />
      {conflict !== null && (
        <p id={conflictId} className={styles['warnNote']} role="alert">
          {conflict}. These beats aren't saved: move someone so each beat's groups agree.
        </p>
      )}
      {refusals.length > 0 && (
        <ul className={styles['hint']} role="status">
          {refusals.map((reason, index) => (
            <li key={`${reason.code}-${String(index)}`}>{reason.message}</li>
          ))}
        </ul>
      )}
      {shown !== null && (
        <div className={styles['beatPreview']}>
          <p className={styles['beatPreviewLine']}>
            <span>
              Preview: angle score <strong>{String(shown.score.value)}</strong> (
              {shown.beatLimit.message.toLowerCase()})
            </span>
            <WhyButton
              label="Angle score"
              value={shown.score.value}
              source={{ trace: shown.score.trace }}
            />
          </p>
          <p className={styles['hint']}>{PREVIEW_HINT}</p>
          <AngleWarnings warnings={shown.warnings} />
        </div>
      )}
    </div>
  );
}
