import type {
  AngleTypeOption,
  BookingShowView,
  BookingSlotView,
  ContentKey,
  DurationClass,
  MatchTypeOption,
  SegmentDraft,
} from '@ringside/engine';
import { isContentKey } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Badge } from '@/components/Badge';
import { Select } from '@/components/Select';
import { angleLimitsText, matchLimitsText } from './editorText';
import styles from './SegmentEditor.module.css';

const CLASS_STEP: Readonly<Record<DurationClass, number>> = { short: 0, standard: 1, long: 2 };

/** "Singles · 2 sides · 1 each", "Promo · 1–4 speakers": a type in the list. */
export function typeOptionLabel(option: MatchTypeOption | AngleTypeOption): string {
  const limits = 'sides' in option ? matchLimitsText(option) : angleLimitsText(option);
  return `${option.name} · ${limits}`;
}

/** The slot's place among `match.slotRoles`' rows: the pre-show first, then the main card. */
function placeIndex(show: BookingShowView, slot: BookingSlotView): number {
  return slot.preShow ? slot.slot : show.format.preShowSlots + slot.slot;
}

/**
 * The slot's size with and without the match type, read from `match.slotRoles` the way the
 * card's own Why? reads it, or null while loading or when the type moves nothing.
 */
function useDurationShift(
  show: BookingShowView,
  slot: BookingSlotView,
  typeKey: ContentKey | null,
): { readonly label: string; readonly longer: boolean } | null {
  const total = show.format.slots + show.format.preShowSlots;
  const index = placeIndex(show, slot);
  const base = useEngineQuery('match.slotRoles', {
    slots: show.format.slots,
    preShowSlots: show.format.preShowSlots,
  });
  const keys = Array.from({ length: total }, (_unused, place) =>
    place === index ? typeKey : null,
  );
  const shifted = useEngineQuery(
    'match.slotRoles',
    { slots: show.format.slots, preShowSlots: show.format.preShowSlots, matchTypeKeys: keys },
    { enabled: typeKey !== null, keepPreviousData: false },
  );
  const before = base.data?.[index];
  const after = shifted.data?.[index];
  if (typeKey === null || before === undefined || after === undefined) return null;
  if (before.durationClass === after.durationClass) return null;
  return {
    label: after.durationLabel,
    longer: CLASS_STEP[after.durationClass] > CLASS_STEP[before.durationClass],
  };
}

export interface TypeFieldProps {
  readonly draft: SegmentDraft;
  readonly options: readonly (MatchTypeOption | AngleTypeOption)[];
  readonly show: BookingShowView;
  readonly slot: BookingSlotView;
  readonly disabled: boolean;
  readonly invalid: boolean;
  readonly onChange: (typeKey: ContentKey) => void;
}

/**
 * The match type (or talking segment type), in catalog order with its limits, and a Long or
 * Short chip when the type moves the slot's size, worded as the card's own note.
 */
export function TypeField({
  draft,
  options,
  show,
  slot,
  disabled,
  invalid,
  onChange,
}: TypeFieldProps) {
  const typeKey = draft.kind === 'match' ? draft.match.matchTypeKey : draft.angle.angleTypeKey;
  const shift = useDurationShift(show, slot, draft.kind === 'match' ? typeKey : null);
  const chosen = options.find((option) => option.key === typeKey);
  return (
    <div className={styles['field']} data-invalid={invalid ? '' : undefined}>
      <Select
        label={draft.kind === 'match' ? 'Match type' : 'Talking segment type'}
        options={options.map((option) => ({ value: option.key, label: typeOptionLabel(option) }))}
        value={typeKey}
        disabled={disabled}
        onValueChange={(value) => {
          if (isContentKey(value)) onChange(value);
        }}
      />
      {shift !== null && chosen !== undefined && (
        <p className={styles['shift']}>
          <Badge tone={shift.longer ? 'prestige' : 'data'}>{shift.label}</Badge>
          <span>
            {`${chosen.name} runs a step ${shift.longer ? 'longer' : 'shorter'} than its slot`}
          </span>
        </p>
      )}
    </div>
  );
}
