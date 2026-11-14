import { useCallback, useState } from 'react';
import type {
  AngleTemplateOption,
  LabWorkerRow,
  MatchCatalog,
  PersonId,
  PromotionId,
  Reason,
  RegionId,
} from '@ringside/engine';
import { useAnnounce } from '@/app/a11y/LiveAnnouncer';
import { BeatEditor } from '@/components/BeatEditor';
import type { BeatDraft, BeatPickerArgs, PersonChip } from '@/components/BeatEditor';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icon } from '@/components/Icon';
import { Panel } from '@/components/Panel';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import { useLabStore } from '../labStore';
import type { LabAngleDraft } from '../labStore';
import { PeoplePickerSheet, talkPickerColumns } from '../WorkerPickerSheet';
import {
  beatScoresOf,
  freshAngleDraft,
  hasPeople,
  templateDrafts,
  templatesFor,
} from './angleDraft';
import { ManagerMenu } from './ManagerMenu';
import type { ManagerName } from './ManagerMenu';
import type { AngleLabState } from './useAngleLab';
import styles from './AngleLab.module.css';

/** The template select's "nothing picked" value; it goes back to it after every pick. */
const NO_TEMPLATE = '';

/** Shown on a template whose required beats are more than the slot holds. */
export const NEEDS_LONGER_SLOT = 'Needs a longer slot';

const TALK_COLUMNS = talkPickerColumns();

/** A change that would throw the beats away, waiting for the player's yes. */
type PendingReplace =
  | { readonly kind: 'template'; readonly template: AngleTemplateOption }
  | { readonly kind: 'type'; readonly angleTypeKey: string };

/** True for a refusal about the angle type; the rest are about the beats or the managers. */
function isTypeReason(reason: Reason): boolean {
  return reason.field === 'angleTypeKey';
}

/** The contract's manager for a person, from what the picker knew about them. */
function contractManagerOf(row: LabWorkerRow | undefined): ManagerName | null {
  if (row?.managerId == null) return null;
  return { id: row.managerId, name: row.managerName ?? 'Their manager' };
}

/** "In beat 2": where else a person stands in the angle, for the picker's badge. */
function beatsOf(beats: readonly BeatDraft[], personId: PersonId): number[] {
  return beats.flatMap((beat, index) =>
    [...beat.groupOne, ...beat.groupTwo].some((person) => person.id === personId) ? [index] : [],
  );
}

export interface AngleLabProps {
  readonly catalog: MatchCatalog;
  readonly lab: AngleLabState;
  /** The show's region, for popularity in the pickers. */
  readonly regionId: RegionId;
  /** The promotion the pickers' "My roster" lists. */
  readonly promotionId: PromotionId | null;
}

/**
 * Angle mode's builder (MTCH5-05): the angle type, a template to start from, and the beats with
 * the people in each group in the BeatEditor. People come from the lab's picker with their Mic,
 * Charisma and Presence; each chip has a manager menu for a stand-in. The engine's refusals are
 * shown next to what they are about.
 */
export function AngleLab({ catalog, lab, regionId, promotionId }: AngleLabProps) {
  const draft = useLabStore((state) => state.angle);
  const setAngle = useLabStore((state) => state.setAngle);
  const setKind = useLabStore((state) => state.setKind);
  const announce = useAnnounce();
  const [pending, setPending] = useState<PendingReplace | null>(null);
  const [notice, setNotice] = useState('');
  const [managerFor, setManagerFor] = useState<PersonChip | null>(null);

  const typeOptions: readonly SelectOption[] = lab.angleTypes.map((type) => ({
    value: type.key,
    label: type.name,
  }));
  const templates = templatesFor(catalog, draft.angleTypeKey);
  const templateOptions: readonly SelectOption[] = templates.map((template) => {
    const fits = template.requiredBeatCount <= lab.limit.max;
    return {
      value: template.key,
      label: fits ? template.name : `${template.name} (${NEEDS_LONGER_SLOT})`,
      disabled: !fits,
    };
  });

  const changeDraft = useCallback(
    (change: Partial<LabAngleDraft>) => {
      setAngle(change);
    },
    [setAngle],
  );

  const applyType = (angleTypeKey: string): void => {
    const fresh = freshAngleDraft(
      catalog,
      catalog.angleTypes.find((type) => type.key === angleTypeKey)?.key ?? null,
    );
    // The people the pickers knew and the manager what-ifs stay for the next beats.
    changeDraft({ angleTypeKey: fresh.angleTypeKey, beats: fresh.beats });
    if (fresh.angleTypeKey !== null) setKind('angle', fresh.angleTypeKey, 1);
    setNotice('');
  };

  const applyTemplate = (template: AngleTemplateOption): void => {
    const beats = templateDrafts(template, lab.limit.max);
    if (beats === null) return;
    changeDraft({ beats });
    const dropped = template.beats.length - beats.length;
    const message =
      dropped === 0
        ? `Started from ${template.name}: add people to each beat.`
        : `Started from ${template.name}, without ${String(dropped)} optional ${dropped === 1 ? 'beat' : 'beats'} to fit the slot: add people to each beat.`;
    setNotice(message);
    announce(message);
  };

  /** Asks first when the change would throw away beats someone built. */
  const replace = (change: PendingReplace): void => {
    const built = hasPeople(draft.beats) || draft.beats.length > 1;
    if (built) {
      setPending(change);
      return;
    }
    if (change.kind === 'template') applyTemplate(change.template);
    else applyType(change.angleTypeKey);
  };

  const rememberPerson = (row: LabWorkerRow): void => {
    changeDraft({ people: { ...useLabStore.getState().angle.people, [row.personId]: row } });
  };

  const renderPicker = (args: BeatPickerArgs) => (
    <PeoplePickerSheet
      open
      title={`Add to ${args.groupLabel}, beat ${String(args.beatIndex + 1)}`}
      caption={`People to add to ${args.groupLabel} in beat ${String(args.beatIndex + 1)}`}
      regionId={regionId}
      promotionId={promotionId}
      onClose={args.onClose}
      exclude={args.exclude}
      columns={TALK_COLUMNS}
      placedLabel={(row) => {
        const places = beatsOf(useLabStore.getState().angle.beats, row.personId);
        return places.length === 0
          ? null
          : `In beat ${places.map((place) => String(place + 1)).join(', ')}`;
      }}
      onPick={(row) => {
        rememberPerson(row);
        args.onPick({ id: row.personId, name: row.name });
      }}
    />
  );

  const personExtras = (person: PersonChip, beatIndex: number) => {
    const beat = draft.beats[beatIndex];
    const option = lab.beatOptions.find((entry) => entry.key === beat?.beatKey);
    if (beat === undefined || option === undefined) return null;
    const inGroupTwo = beat.groupTwo.some((member) => member.id === person.id);
    const group = option.groups.length === 1 ? option.groups[0] : option.groups[inGroupTwo ? 1 : 0];
    if (group?.managerCanStandIn !== true) return null;
    const overrideId = draft.managerOverrides[person.id];
    const override: ManagerName | null | undefined =
      overrideId === undefined
        ? undefined
        : overrideId === null
          ? null
          : { id: overrideId, name: draft.people[overrideId]?.name ?? 'Chosen manager' };
    const setOverride = (value: PersonId | null | undefined): void => {
      const next = Object.fromEntries(
        Object.entries(useLabStore.getState().angle.managerOverrides).filter(
          ([personId]) => personId !== person.id,
        ),
      ) as Record<PersonId, PersonId | null>;
      if (value !== undefined) next[person.id] = value;
      changeDraft({ managerOverrides: next });
    };
    return (
      <ManagerMenu
        person={person}
        contractManager={contractManagerOf(draft.people[person.id])}
        override={override}
        onUseContract={() => {
          setOverride(undefined);
        }}
        onNoManager={() => {
          setOverride(null);
        }}
        onChoose={() => {
          setManagerFor(person);
        }}
      />
    );
  };

  const typeReasons = lab.refusals.filter(isTypeReason);
  const beatReasons = lab.refusals.filter((reason) => !isTypeReason(reason));

  return (
    <Panel title="Angle" subtitle={lab.limit.message} className={styles['anglePanel']}>
      <div className={styles['fields']}>
        <div className={styles['field']}>
          <Select
            label="Angle type"
            options={typeOptions}
            value={draft.angleTypeKey ?? ''}
            placeholder="Pick a type"
            onValueChange={(value) => {
              if (value !== draft.angleTypeKey) replace({ kind: 'type', angleTypeKey: value });
            }}
          />
          {typeReasons.length > 0 && <Refusals reasons={typeReasons} />}
        </div>
        <div className={styles['field']}>
          <Select
            label="Start from template"
            options={templateOptions}
            value={NO_TEMPLATE}
            placeholder={templates.length === 0 ? 'No templates for this type' : 'Pick a template'}
            disabled={templates.length === 0}
            onValueChange={(value) => {
              const template = templates.find((entry) => entry.key === value);
              if (template !== undefined) replace({ kind: 'template', template });
            }}
          />
          {templateOptions.some((option) => option.disabled === true) && (
            <p className={styles['hint']}>
              Templates marked “{NEEDS_LONGER_SLOT}” have more beats than this slot holds.
            </p>
          )}
          {notice !== '' && (
            <p className={styles['hint']} role="status">
              {notice}
            </p>
          )}
        </div>
      </div>
      <div className={styles['editor']}>
        <BeatEditor
          beats={draft.beats}
          onChange={(beats) => {
            changeDraft({ beats });
          }}
          beatOptions={lab.beatOptions}
          limit={lab.limit}
          renderPicker={renderPicker}
          scores={lab.outOfDate ? {} : beatScoresOf(draft.beats, lab.shown?.result ?? null)}
          personExtras={personExtras}
          headingLevel={3}
        />
        {beatReasons.length > 0 && <Refusals reasons={beatReasons} />}
      </div>
      <PeoplePickerSheet
        open={managerFor !== null}
        title={managerFor === null ? 'Choose a manager' : `Manager for ${managerFor.name}`}
        caption="Managers who can talk for them"
        regionId={regionId}
        promotionId={promotionId}
        personRole="manager"
        columns={TALK_COLUMNS}
        exclude={managerFor === null ? [] : [managerFor.id]}
        placedLabel={() => null}
        onClose={() => {
          setManagerFor(null);
        }}
        onPick={(row) => {
          if (managerFor === null) return;
          const state = useLabStore.getState().angle;
          changeDraft({
            managerOverrides: { ...state.managerOverrides, [managerFor.id]: row.personId },
            people: { ...state.people, [row.personId]: row },
          });
          announce(`${row.name} talks for ${managerFor.name}`);
          setManagerFor(null);
        }}
      />
      <ConfirmDialog
        open={pending !== null}
        onClose={() => {
          setPending(null);
        }}
        onConfirm={() => {
          if (pending?.kind === 'template') applyTemplate(pending.template);
          else if (pending?.kind === 'type') applyType(pending.angleTypeKey);
          setPending(null);
        }}
        title={pending?.kind === 'type' ? 'Change the angle type?' : 'Start from this template?'}
        body={
          pending?.kind === 'type'
            ? 'The beats you built start again from this type’s first beat.'
            : `The beats you built are replaced by ${pending?.kind === 'template' ? pending.template.name : 'the template'}’s, with nobody in them.`
        }
        confirmLabel={pending?.kind === 'type' ? 'Change type' : 'Replace beats'}
      />
    </Panel>
  );
}

/** The engine's reasons for refusing the Run, next to what they are about. */
function Refusals({ reasons }: { readonly reasons: readonly Reason[] }) {
  return (
    <div className={styles['refusals']} role="alert">
      {reasons.map((reason) => (
        <p
          key={`${reason.code}-${reason.field ?? ''}-${reason.message}`}
          className={styles['refusal']}
        >
          <Icon name="warning" size="sm" decorative />
          <span>{reason.message}</span>
        </p>
      ))}
    </div>
  );
}
