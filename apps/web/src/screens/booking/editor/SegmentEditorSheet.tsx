import { useId, useState } from 'react';
import { parseContentKey } from '@ringside/engine';
import type {
  AvailableTeamRow,
  AvailableWorkerRow,
  BookingCard,
  BookingSlotView,
  CommandResult,
  MatchCatalog,
  PersonId,
  Reason,
  SegmentDraft,
  TeamId,
} from '@ringside/engine';
import { useAnnounce } from '@/app/a11y/LiveAnnouncer';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { RadioGroup } from '@/components/RadioGroup';
import { Sheet } from '@/components/Sheet';
import { useSegmentEditorSections } from '../registries/segmentEditorSections';
import type { SegmentEditorSectionDefinition } from '../registries/segmentEditorSections';
import { EditorRosterPicker } from './EditorRosterPicker';
import type { PickerTarget } from './EditorRosterPicker';
import {
  methodOptions,
  segmentEditorTitle,
  sideLabel,
  sideLimitsOf,
  slotOfRequest,
  typeOptionsFor,
} from './editorText';
import { useSegmentEditor } from './editorStore';
import type { SegmentEditorKind, SegmentEditorRequest } from './editorStore';
import { PlannedResultField } from './PlannedResultField';
import styles from './SegmentEditor.module.css';
import { SideBuilder } from './SideBuilder';
import { TitlesField } from './TitlesField';
import { TypeField } from './TypeField';
import { useRosterIndex } from './useRoster';
import {
  draftForSave,
  emptyDraft,
  initialDraftState,
  LABEL_MAX_LENGTH,
  peopleOnSide,
  unsaveableReason,
  useSegmentDraft,
} from './useSegmentDraft';
import type { SegmentDraftControls, SegmentDraftState } from './useSegmentDraft';

export { segmentEditorTitle } from './editorText';

export interface SegmentEditorSheetProps {
  /** The card the screen has loaded: the slot, the segment and its `draft` come from here. */
  readonly card: BookingCard;
}

const NO_REASON = 'The game did not say why.';

/** What the sheet holds before a session has started. Never saved. */
const PLACEHOLDER: SegmentDraftState = {
  draft: emptyDraft('match', parseContentKey('match.singles')),
  sideCount: 2,
};

const NO_MATCH_TYPES = 'This save has no match types. Start a new game to book matches.';

/** A new draft of a kind: the catalog's first type, with the sides it needs. */
export function newDraftState(kind: SegmentEditorKind, catalog: MatchCatalog): SegmentDraftState {
  const first = typeOptionsFor(catalog, kind, '')[0];
  const key = first?.key ?? parseContentKey(kind === 'match' ? 'match.singles' : 'angle.promo');
  const matchType = catalog.matchTypes.find((option) => option.key === key);
  const angleType = catalog.angleTypes.find((option) => option.key === key);
  return initialDraftState(emptyDraft(kind, key), sideLimitsOf(kind, matchType, angleType));
}

/** The starting state for a draft already on the card. */
function existingDraftState(draft: SegmentDraft, catalog: MatchCatalog): SegmentDraftState {
  const key = draft.kind === 'match' ? draft.match.matchTypeKey : draft.angle.angleTypeKey;
  const matchType = catalog.matchTypes.find((option) => option.key === key);
  const angleType = catalog.angleTypes.find((option) => option.key === key);
  return initialDraftState(draft, sideLimitsOf(draft.kind, matchType, angleType));
}

/** The parts of the sheet a refusal can point at. */
export type FieldArea = 'type' | 'sides' | 'titles' | 'result' | 'label';

/** Which part of the sheet each reason's `field` names, so it can be marked. */
export function refusedAreas(reasons: readonly Reason[]): ReadonlySet<FieldArea> {
  const areas = new Set<FieldArea>();
  for (const reason of reasons) {
    const field = (reason.field ?? '').replace(/^draft\./, '');
    if (field.startsWith('participants')) areas.add('sides');
    else if (field.startsWith('match.titleIds')) areas.add('titles');
    else if (field.startsWith('outcome')) areas.add('result');
    else if (field.startsWith('match.matchTypeKey') || field.startsWith('angle.angleTypeKey'))
      areas.add('type');
    else if (field.startsWith('label')) areas.add('label');
  }
  return areas;
}

/** The engine's reasons, or one plain line when a refusal came with none. */
function reasonsOf<T>(result: CommandResult<T>): readonly Reason[] {
  if (result.ok) return [];
  return result.reasons.length > 0 ? result.reasons : [{ code: 'unknown', message: NO_REASON }];
}

/**
 * A side's name for the result field: "Side 1: " and its team when everyone on it is listed for
 * the same team, else the names joined with " & ", as the card names it.
 */
export function sideName(
  draft: SegmentDraft,
  side: number,
  people: ReadonlyMap<PersonId, AvailableWorkerRow>,
  teams: ReadonlyMap<TeamId, AvailableTeamRow>,
  fallbackName: (personId: PersonId) => string,
): string {
  const onSide = peopleOnSide(draft, side);
  if (onSide.length === 0) return `${sideLabel(side)} (nobody yet)`;
  const teamId = onSide[0]?.teamId ?? null;
  const team =
    teamId !== null && onSide.every((person) => person.teamId === teamId)
      ? teams.get(teamId)
      : undefined;
  const names =
    team?.name ??
    onSide
      .map((person) => people.get(person.personId)?.ringName ?? fallbackName(person.personId))
      .join(' & ');
  return `${sideLabel(side)}: ${names}`;
}

interface RefusalListProps {
  readonly reasons: readonly Reason[];
}

/** The engine's refusal, word for word, at the top of the sheet. */
function RefusalList({ reasons }: RefusalListProps) {
  return (
    <div className={styles['refusal']} role="alert">
      <p className={styles['refusalTitle']}>This segment wasn't saved</p>
      <ul className={styles['refusalList']}>
        {reasons.map((reason, index) => (
          <li key={`${reason.code}-${String(index)}`}>{reason.message}</li>
        ))}
      </ul>
    </div>
  );
}

interface RegisteredSectionProps {
  readonly section: SegmentEditorSectionDefinition;
  readonly controls: SegmentDraftControls;
  readonly card: BookingCard;
  readonly slot: BookingSlotView;
  readonly disabled: boolean;
}

/** A section another feature registered, headed by its title. */
function RegisteredSection({ section, controls, card, slot, disabled }: RegisteredSectionProps) {
  const headingId = useId();
  const content = section.render({
    draft: controls.state.draft,
    patch: (partial) => {
      controls.patch(section.id, partial);
    },
    show: card.show,
    slot,
    disabled,
    randomWinners: card.randomWinners,
  });
  if (content === null || content === undefined || content === false) return null;
  return (
    <section aria-labelledby={headingId} className={styles['field']}>
      <h3 id={headingId} className={styles['legend']}>
        {section.title}
      </h3>
      {content}
    </section>
  );
}

interface EditorBodyProps {
  readonly request: SegmentEditorRequest;
  readonly card: BookingCard;
  readonly slot: BookingSlotView;
  readonly catalog: MatchCatalog;
  readonly controls: SegmentDraftControls;
  readonly refusal: readonly Reason[] | null;
  readonly disabled: boolean;
  readonly onKindChange: (kind: SegmentEditorKind) => void;
}

/** The fields, top to bottom: kind, type, sides, titles, result, billing line, sections. */
function EditorBody({
  request,
  card,
  slot,
  catalog,
  controls,
  refusal,
  disabled,
  onKindChange,
}: EditorBodyProps) {
  const announce = useAnnounce();
  const labelId = useId();
  const labelHintId = useId();
  const { draft, sideCount } = controls.state;
  const kind = draft.kind;
  const eventInstanceId = card.show.eventInstanceId;
  const segmentId = request.mode === 'existing' ? request.segmentId : null;
  const roster = useRosterIndex(eventInstanceId, kind);
  const sections = useSegmentEditorSections(kind);
  const [picker, setPicker] = useState<PickerTarget | null>(null);

  const typeKey = draft.kind === 'match' ? draft.match.matchTypeKey : draft.angle.angleTypeKey;
  const matchType = catalog.matchTypes.find((option) => option.key === typeKey);
  const angleType = catalog.angleTypes.find((option) => option.key === typeKey);
  const limits = sideLimitsOf(kind, matchType, angleType);
  const areas = refusedAreas(refusal ?? []);
  const outcomeMethod =
    draft.kind === 'match' && draft.outcome?.kind === 'win' ? draft.outcome.methodKey : null;
  const methods = methodOptions(catalog, outcomeMethod);
  const fallbackName = (personId: PersonId): string =>
    card.sections
      .flatMap((section) => section.slots)
      .flatMap((candidate) => candidate.segment?.sides ?? [])
      .flatMap((side) => side.people)
      .find((person) => person.personId === personId)?.ringName ?? 'Someone off the roster';
  const sideNames = Array.from({ length: sideCount }, (_unused, side) =>
    sideName(draft, side, roster.people, roster.teams, fallbackName),
  );

  const pickerFull = (side: number, adding: number): boolean => {
    if (kind === 'match') {
      return (
        matchType !== undefined &&
        peopleOnSide(draft, side).length + adding >= matchType.sideSize.max
      );
    }
    return angleType !== undefined && draft.participants.length + adding >= angleType.speakers.max;
  };
  const pickerStatus = (target: PickerTarget): string => {
    if (kind === 'match') {
      const count = peopleOnSide(draft, target.side).length;
      const most = matchType?.sideSize.max;
      return most === undefined
        ? `${sideLabel(target.side)}: ${String(count)}`
        : `${sideLabel(target.side)}: ${String(count)} of ${String(most)}`;
    }
    const count = draft.participants.length;
    const most = angleType?.speakers.max;
    return most === undefined
      ? `Speakers: ${String(count)}`
      : `Speakers: ${String(count)} of ${String(most)}`;
  };
  const where = (side: number): string => (kind === 'match' ? sideLabel(side) : 'the speakers');

  const typeOptions = typeOptionsFor(catalog, kind, typeKey);
  const allowsTitles = kind === 'match' && matchType?.allowsTitles !== false;

  return (
    <div className={styles['editor']}>
      {refusal !== null && <RefusalList reasons={refusal} />}
      {!card.canEdit && card.editBlock !== null && (
        <p className={styles['blocked']} role="status">
          {card.editBlock.message}
        </p>
      )}
      {request.mode === 'new' && (
        <RadioGroup
          legend="Kind"
          layout="row"
          options={[
            { value: 'match', label: 'Match' },
            { value: 'angle', label: 'Talking segment' },
          ]}
          value={kind}
          disabled={disabled}
          onValueChange={onKindChange}
        />
      )}
      <TypeField
        draft={draft}
        options={typeOptions}
        show={card.show}
        slot={slot}
        disabled={disabled}
        invalid={areas.has('type')}
        onChange={(key) => {
          const nextMatch = catalog.matchTypes.find((option) => option.key === key);
          const nextAngle = catalog.angleTypes.find((option) => option.key === key);
          controls.setType(
            key,
            sideLimitsOf(kind, nextMatch, nextAngle),
            nextMatch?.allowsTitles !== false,
          );
        }}
      />
      <SideBuilder
        draft={draft}
        sideCount={sideCount}
        limits={limits}
        matchType={matchType}
        angleType={angleType}
        card={card}
        roster={roster.people}
        disabled={disabled}
        invalid={areas.has('sides')}
        onOpenPicker={setPicker}
        onRemovePerson={(personId, name) => {
          const side = draft.participants.find((person) => person.personId === personId)?.side;
          controls.removePerson(personId);
          announce(`Removed ${name}${side === undefined ? '' : ` from ${where(side)}`}`);
        }}
        onAddSide={() => {
          controls.addSide(limits);
          announce(`${kind === 'match' ? sideLabel(sideCount) : 'A second side'} added`);
        }}
        onRemoveSide={(side) => {
          controls.removeSide(side, limits);
          announce(`${kind === 'match' ? sideLabel(side) : 'The second side'} removed`);
        }}
      />
      {allowsTitles && (
        <TitlesField
          draft={draft}
          options={card.titleOptions}
          disabled={disabled}
          invalid={areas.has('titles')}
          onChange={controls.setTitles}
        />
      )}
      <PlannedResultField
        draft={draft}
        sideCount={sideCount}
        sideNames={sideNames}
        methods={methods}
        disabled={disabled}
        invalid={areas.has('result')}
        randomWinners={card.randomWinners}
        onChange={controls.setResult}
      />
      <div className={styles['field']} data-invalid={areas.has('label') ? '' : undefined}>
        <label htmlFor={labelId} className={styles['legend']}>
          Billing line
        </label>
        <input
          id={labelId}
          type="text"
          className={styles['textInput']}
          value={draft.label ?? ''}
          maxLength={LABEL_MAX_LENGTH}
          disabled={disabled}
          aria-describedby={labelHintId}
          onChange={(event) => {
            controls.setLabel(event.target.value);
          }}
        />
        <p id={labelHintId} className={styles['hint']}>
          {`Optional, such as "Number one contender's match". Up to ${String(LABEL_MAX_LENGTH)} characters.`}
        </p>
      </div>
      {sections.map((section) => (
        <RegisteredSection
          key={section.id}
          section={section}
          controls={controls}
          card={card}
          slot={slot}
          disabled={disabled}
        />
      ))}
      <EditorRosterPicker
        target={picker}
        eventInstanceId={eventInstanceId}
        kind={kind}
        draft={draft}
        card={card}
        segmentId={segmentId}
        roster={roster.people}
        {...(picker === null ? {} : { status: pickerStatus(picker) })}
        onPickPerson={(side, personId, name) => {
          controls.addPerson(side, personId);
          announce(`Added ${name} to ${where(side)}`);
          if (pickerFull(side, 1)) setPicker(null);
        }}
        onPickTeam={(side, teamId, memberIds, name) => {
          for (const personId of memberIds) controls.addPerson(side, personId, teamId);
          announce(`Added ${name} to ${where(side)}`);
          setPicker(null);
        }}
        onClose={() => {
          setPicker(null);
        }}
      />
    </div>
  );
}

type Confirming =
  | { readonly kind: 'discard' }
  | { readonly kind: 'remove' }
  | { readonly kind: 'switch'; readonly to: SegmentEditorKind };

/**
 * The segment editor, opened from `useSegmentEditor`: a match or a talking segment for one slot,
 * built in a local draft and saved whole with `booking.addSegment` or `booking.updateSegment`.
 * Nothing reaches the world until Save. A side sheet on desktop; the whole screen on a phone.
 */
export function SegmentEditorSheet({ card }: SegmentEditorSheetProps) {
  const request = useSegmentEditor((state) => state.request);
  const closeEditor = useSegmentEditor((state) => state.close);
  const announce = useAnnounce();
  const catalogQuery = useEngineQuery('match.catalog', {}, { enabled: request !== null });
  const catalog = catalogQuery.data;
  const addSegment = useEngineCommand('booking.addSegment');
  const updateSegment = useEngineCommand('booking.updateSegment');
  const removeSegment = useEngineCommand('booking.removeSegment');
  const controls = useSegmentDraft(PLACEHOLDER);
  const [startedFor, setStartedFor] = useState<SegmentEditorRequest | null>(null);
  const [refusal, setRefusal] = useState<readonly Reason[] | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);

  const slot = request === null ? null : slotOfRequest(request, card);
  const segment = request?.mode === 'existing' ? (slot?.segment ?? null) : null;

  // A new opening starts a session from the card as it is now. A refetched card (after any
  // command or a simulated day) never restarts it, so the booker's changes survive.
  if (request !== startedFor) {
    if (request === null) {
      setStartedFor(null);
    } else if (catalog !== undefined && (request.mode === 'new' || segment !== null)) {
      setStartedFor(request);
      setRefusal(null);
      setConfirming(null);
      controls.start(
        request.mode === 'new'
          ? newDraftState(request.kind, catalog)
          : existingDraftState(segment?.draft ?? PLACEHOLDER.draft, catalog),
      );
    }
  }
  const started = request !== null && startedFor === request;

  const pending = addSegment.pending || updateSegment.pending || removeSegment.pending;
  const disabled = pending || !card.canEdit;
  const { draft } = controls.state;
  const blocked = started ? unsaveableReason(draft) : null;

  const requestClose = (): void => {
    if (pending) return;
    if (started && controls.dirty) setConfirming({ kind: 'discard' });
    else closeEditor();
  };

  const save = async (): Promise<void> => {
    if (request === null || slot === null) return;
    const saved = draftForSave(draft);
    const result =
      request.mode === 'new'
        ? await addSegment.run({
            eventInstanceId: request.eventInstanceId,
            preShow: request.preShow,
            slot: request.slot,
            draft: saved,
          })
        : await updateSegment.run({ segmentId: request.segmentId, draft: saved });
    if (!result.ok) {
      setRefusal(reasonsOf(result));
      return;
    }
    announce(
      slot.preShow
        ? `Saved to pre-show slot ${String(slot.displayNumber)}`
        : `Saved to slot ${String(slot.displayNumber)}`,
    );
    closeEditor();
  };

  const remove = async (): Promise<void> => {
    if (request?.mode !== 'existing') return;
    const result = await removeSegment.run({ segmentId: request.segmentId });
    if (!result.ok) throw new Error(reasonsOf(result)[0]?.message ?? NO_REASON);
    announce(`${segment?.typeName ?? 'Segment'} removed`);
    setConfirming(null);
    closeEditor();
  };

  const switchKind = (to: SegmentEditorKind): void => {
    if (catalog === undefined) return;
    controls.replace(newDraftState(to, catalog));
  };

  let body = null;
  if (request === null) {
    body = null;
  } else if (catalogQuery.status === 'error') {
    const error = catalogQuery.error;
    body = (
      <EmptyState
        icon="booking"
        title="The match types can't be read"
        body={
          error === null
            ? NO_REASON
            : error.kind === 'transport'
              ? error.message
              : (error.reasons[0]?.message ?? NO_REASON)
        }
      />
    );
  } else if (catalog === undefined) {
    body = (
      <p className={styles['hint']} role="status">
        Loading…
      </p>
    );
  } else if (!catalog.available) {
    body = <EmptyState icon="booking" title="Matches can't be booked" body={NO_MATCH_TYPES} />;
  } else if (slot === null || (request.mode === 'existing' && segment === null)) {
    body = (
      <EmptyState
        icon="booking"
        title="That segment is no longer on the card"
        body="It was moved or removed. Close this and pick it again from the card."
      />
    );
  } else if (started) {
    body = (
      <EditorBody
        request={request}
        card={card}
        slot={slot}
        catalog={catalog}
        controls={controls}
        refusal={refusal}
        disabled={disabled}
        onKindChange={(to) => {
          if (to === draft.kind) return;
          if (draft.participants.length > 0) setConfirming({ kind: 'switch', to });
          else switchKind(to);
        }}
      />
    );
  }

  const canSave = started && catalog?.available === true && blocked === null && !disabled;
  const footer = (
    <div className={styles['footer']}>
      {started && blocked !== null && card.canEdit && (
        <p className={styles['saveHint']}>{blocked}</p>
      )}
      <div className={styles['footerButtons']}>
        {request?.mode === 'existing' && segment !== null && card.canEdit && (
          <Button
            variant="danger"
            iconStart="trash"
            disabled={pending}
            onClick={() => {
              setConfirming({ kind: 'remove' });
            }}
            className={styles['remove']}
          >
            Remove
          </Button>
        )}
        <Button variant="ghost" disabled={pending} onClick={requestClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!canSave}
          loading={addSegment.pending || updateSegment.pending}
          onClick={() => {
            void save();
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );

  return (
    <Sheet
      open={request !== null}
      onClose={requestClose}
      title={request === null ? 'Segment' : segmentEditorTitle(request, card)}
      side="right"
      size="lg"
      phoneHeight="full"
      footer={footer}
    >
      {body}
      <ConfirmDialog
        open={confirming?.kind === 'discard'}
        onClose={() => {
          setConfirming(null);
        }}
        onConfirm={() => {
          setConfirming(null);
          closeEditor();
        }}
        tone="danger"
        title="Discard changes?"
        body="Your changes to this slot haven't been saved."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
      />
      <ConfirmDialog
        open={confirming?.kind === 'remove'}
        onClose={() => {
          setConfirming(null);
        }}
        onConfirm={remove}
        tone="danger"
        title={`Remove this ${segment?.kind === 'angle' ? 'talking segment' : 'match'}?`}
        body="The slot becomes open again."
        confirmLabel="Remove"
      />
      <ConfirmDialog
        open={confirming?.kind === 'switch'}
        onClose={() => {
          setConfirming(null);
        }}
        onConfirm={() => {
          if (confirming?.kind === 'switch') switchKind(confirming.to);
          setConfirming(null);
        }}
        title={
          confirming?.kind === 'switch' && confirming.to === 'angle'
            ? 'Start again as a talking segment?'
            : 'Start again as a match?'
        }
        body="Everyone you've added is taken off, and the type starts over."
        confirmLabel="Start again"
      />
    </Sheet>
  );
}
