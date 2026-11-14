/**
 * MTCH5-08: the talking segment's own fields. Where it happens (In the ring, Backstage, Pre-taped)
 * and, for each speaker, the part they play (Wrestler, Manager for …, Interviewer, Authority
 * figure). A part that doesn't suit its group says so in plain words beside it; the engine only
 * warns about it, it never blocks the booking.
 */
import { ANGLE_SETTING_LABELS, TALK_ROLE_LABELS, TALK_ROLES } from '@ringside/engine';
import type { AngleSetting, BeatGroupOption, PersonId, TalkRole } from '@ringside/engine';
import { RadioGroup } from '@/components/RadioGroup';
import { Select } from '@/components/Select';
import { partMismatch, SETTING_HINTS } from './editorText';
import styles from './SegmentEditor.module.css';

export interface SettingFieldProps {
  /** The settings the type allows, the one a new segment starts in first. */
  readonly settings: readonly AngleSetting[];
  readonly value: AngleSetting;
  readonly disabled: boolean;
  readonly onChange: (setting: AngleSetting) => void;
}

/** Where the talking segment happens. Hidden when the type allows only one setting. */
export function SettingField({ settings, value, disabled, onChange }: SettingFieldProps) {
  if (settings.length <= 1) {
    const only = settings[0] ?? value;
    return (
      <p className={styles['hint']}>{`${ANGLE_SETTING_LABELS[only]}: ${SETTING_HINTS[only]}`}</p>
    );
  }
  return (
    <RadioGroup
      legend="Where"
      layout="row"
      options={settings.map((setting) => ({
        value: setting,
        label: ANGLE_SETTING_LABELS[setting],
        description: SETTING_HINTS[setting],
      }))}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const chosen = settings.find((setting) => setting === next);
        if (chosen !== undefined) onChange(chosen);
      }}
    />
  );
}

/** Someone else in the segment a manager can be with. */
export interface ClientOption {
  readonly personId: PersonId;
  readonly name: string;
}

export interface PartFieldProps {
  readonly name: string;
  readonly talkRole: TalkRole;
  readonly forPersonId: PersonId | null;
  /** The others in the segment, for "Manager for …". */
  readonly clients: readonly ClientOption[];
  /** The beat group this person's side fills, for the mismatch line. */
  readonly group: BeatGroupOption | null;
  readonly disabled: boolean;
  readonly onChange: (talkRole: TalkRole, forPersonId: PersonId | null) => void;
}

const NOBODY = 'nobody';

/** One speaker's part, and who a manager is with. */
export function PartField({
  name,
  talkRole,
  forPersonId,
  clients,
  group,
  disabled,
  onChange,
}: PartFieldProps) {
  const mismatch = partMismatch(group, talkRole);
  return (
    <span className={styles['part']}>
      <Select
        label={`${name}'s part`}
        hideLabel
        options={TALK_ROLES.map((role) => ({ value: role, label: TALK_ROLE_LABELS[role] }))}
        value={talkRole}
        disabled={disabled}
        className={styles['partSelect'] ?? ''}
        onValueChange={(value) => {
          const role = TALK_ROLES.find((candidate) => candidate === value);
          if (role === undefined) return;
          // A new manager is with the first wrestler in the segment until the booker says otherwise.
          onChange(role, role === 'manager' ? (forPersonId ?? clients[0]?.personId ?? null) : null);
        }}
      />
      {talkRole === 'manager' && clients.length > 0 && (
        <Select
          label={`Who ${name} manages here`}
          hideLabel
          options={[
            { value: NOBODY, label: 'Nobody in particular' },
            ...clients.map((client) => ({
              value: client.personId,
              label: `Manager for ${client.name}`,
            })),
          ]}
          value={forPersonId ?? NOBODY}
          disabled={disabled}
          className={styles['partSelect'] ?? ''}
          onValueChange={(value) => {
            const client = clients.find((option) => option.personId === value);
            onChange('manager', client?.personId ?? null);
          }}
        />
      )}
      {mismatch !== null && <span className={styles['warnNote']}>{mismatch}</span>}
    </span>
  );
}
