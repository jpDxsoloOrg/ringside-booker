import type {
  ContentKey,
  EventImportance,
  LabOptions,
  MatchCatalog,
  RegionId,
  SegmentKind,
  SlotRole,
} from '@ringside/engine';
import { SLOT_ROLE_LABELS, SLOT_ROLES } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Badge } from '@/components/Badge';
import { Panel } from '@/components/Panel';
import type { RadioOption } from '@/components/RadioGroup';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import { Switch } from '@/components/Switch';
import { WhyButton } from '@/components/Trace';
import { useIsMobile } from '@/styles/useMediaQuery';
import { useLabStore } from './labStore';
import type { LabState } from './labStore';
import { weightText } from './labText';
import styles from './MatchLab.module.css';
import { LabResultGroup } from './result/LabResultGroup';

/** The rules the lab rates by when no Run has said otherwise. */
export const DEFAULT_RULES_LABEL = 'Full rules';

/**
 * The lab's two modes (MTCH5-05): a match, or an angle built from beats. Angle mode replaced
 * MTCH1's simple "Talking segment".
 */
export const MODE_OPTIONS: readonly RadioOption<SegmentKind>[] = [
  { value: 'match', label: 'Match' },
  { value: 'angle', label: 'Angle' },
];

const SLOT_ROLE_OPTIONS: readonly SelectOption[] = SLOT_ROLES.map((role) => ({
  value: role,
  label: SLOT_ROLE_LABELS[role],
}));

function isSlotRole(value: string): value is SlotRole {
  return SLOT_ROLES.some((role) => role === value);
}

/** How many sides a fresh line-up of this type starts with. */
export function startingSides(
  catalog: MatchCatalog,
  kind: SegmentKind,
  typeKey: ContentKey | null,
): number {
  if (kind === 'angle') return 1;
  const matchType = catalog.matchTypes.find((option) => option.key === typeKey);
  return matchType?.sides.min ?? 2;
}

interface SlotChipsProps {
  readonly slotRole: SlotRole;
  readonly kind: SegmentKind;
  readonly typeKey: ContentKey | null;
}

/** The duration class and weight the slot role gives, each with its Why?, before any Run. */
function SlotChips({ slotRole, kind, typeKey }: SlotChipsProps) {
  const ready = kind === 'angle' || typeKey !== null;
  const info = useEngineQuery(
    'match.slotInfo',
    typeKey === null ? { slotRole, kind } : { slotRole, kind, typeKey },
    { enabled: ready },
  );
  const data = info.data;
  if (data === undefined) {
    return (
      <p className={styles['chipsNote']} role="status">
        {info.status === 'error' ? 'The slot could not be read.' : 'Reading the slot…'}
      </p>
    );
  }
  return (
    <div className={styles['chips']} aria-busy={info.isStale}>
      <span className={styles['chip']}>
        <Badge tone="data">{data.durationLabel}</Badge>
        <WhyButton
          label="Duration class"
          value={data.durationLabel}
          panelTitle={`Duration class: ${data.durationLabel}`}
          source={{ trace: data.durationTrace }}
        />
      </span>
      <span className={styles['chip']}>
        <Badge>Weight {weightText(data.weight)}</Badge>
        <WhyButton
          label="Slot weight"
          value={data.weight}
          unit="multiplier"
          panelTitle={`${data.roleLabel} weight`}
          source={{ trace: data.weightTrace }}
        />
      </span>
    </div>
  );
}

export interface LabSetupPanelProps {
  readonly options: LabOptions;
  readonly catalog: MatchCatalog;
  /** The policy label of the Run on screen, or null before the first. */
  readonly rulesLabel: string | null;
}

/** "Main event · Regular show · Bayshore · Televised": the setup in one line, for a phone. */
export function setupSummary(setup: LabState['setup'], options: LabOptions): string {
  const importance = options.importances.find((option) => option.key === setup.importance);
  const region = options.regions.find((option) => option.id === setup.regionId);
  return [
    SLOT_ROLE_LABELS[setup.slotRole],
    importance?.label ?? setup.importance,
    region?.name ?? 'No region',
    setup.televised ? 'Televised' : 'Not televised',
  ].join(' · ');
}

/**
 * The left column: the match type, where the segment sits on the card, and the show it is on. The
 * duration and weight chips follow the slot role at once; nothing is rated until Run. For a match,
 * the Winner and finish group that Simulate plays out comes last. In Angle mode (MTCH5-05) the
 * angle type lives with the beats instead, and on a phone the panel folds into a one-line summary.
 */
export function LabSetupPanel({ options, catalog, rulesLabel }: LabSetupPanelProps) {
  const setup = useLabStore((state) => state.setup);
  const setType = useLabStore((state) => state.setType);
  const setSlotRole = useLabStore((state) => state.setSlotRole);
  const setImportance = useLabStore((state) => state.setImportance);
  const setRegion = useLabStore((state) => state.setRegion);
  const setTelevised = useLabStore((state) => state.setTelevised);
  const setPromotion = useLabStore((state) => state.setPromotion);
  const isMobile = useIsMobile();

  const typeOptions: readonly SelectOption[] =
    setup.kind === 'match'
      ? catalog.matchTypes.map((type) => ({ value: type.key, label: type.name }))
      : catalog.angleTypes.map((type) => ({ value: type.key, label: type.name }));
  const importanceOptions: readonly SelectOption[] = options.importances.map((importance) => ({
    value: importance.key,
    label: importance.label,
  }));
  const rateAsOptions: readonly SelectOption[] = options.rateAs.map((option) => ({
    value: option.id,
    label: option.yours ? `${option.name} (yours)` : option.name,
  }));
  const ratingAsRival = options.rateAs.some(
    (option) => option.id === setup.promotionId && !option.yours,
  );
  const regionOptions: readonly SelectOption[] = options.regions.map((region) => ({
    value: region.id,
    label: region.name,
    group: region.countryName,
  }));

  const changeType = (value: string): void => {
    const option =
      setup.kind === 'match'
        ? catalog.matchTypes.find((type) => type.key === value)
        : catalog.angleTypes.find((type) => type.key === value);
    if (option === undefined) return;
    setType(option.key, startingSides(catalog, setup.kind, option.key));
  };

  const isAngle = setup.kind === 'angle';
  // On a phone, Angle mode folds the setup into a summary row (the beats need the room).
  const folded = isMobile && isAngle;

  return (
    <Panel
      // A new key when it starts folding, so it opens folded; the setup itself is in the store.
      key={folded ? 'folded' : 'open'}
      title="Setup"
      {...(folded ? { subtitle: setupSummary(setup, options) } : {})}
      collapsible={folded}
      defaultCollapsed={folded}
      className={styles['setupPanel']}
    >
      <div className={styles['setupFields']}>
        {!isAngle && (
          <Select
            label="Match type"
            options={typeOptions}
            value={setup.typeKey ?? ''}
            placeholder="Pick a type"
            onValueChange={changeType}
          />
        )}
        <div className={styles['slotField']}>
          <Select
            label="Slot role"
            options={SLOT_ROLE_OPTIONS}
            value={setup.slotRole}
            onValueChange={(value) => {
              if (isSlotRole(value)) setSlotRole(value);
            }}
          />
          <SlotChips slotRole={setup.slotRole} kind={setup.kind} typeKey={setup.typeKey} />
        </div>
        <Select
          label="Event size"
          options={importanceOptions}
          value={setup.importance}
          onValueChange={(value) => {
            const importance = options.importances.find((option) => option.key === value);
            if (importance !== undefined) setImportance(importance.key satisfies EventImportance);
          }}
        />
        <Select
          label="Region"
          options={regionOptions}
          value={setup.regionId ?? ''}
          placeholder="Pick a region"
          onValueChange={(value) => {
            const region = options.regions.find((option) => option.id === value);
            if (region !== undefined) setRegion(region.id satisfies RegionId);
          }}
        />
        <Switch
          label="Televised"
          checked={setup.televised}
          onCheckedChange={(televised) => {
            setTelevised(televised);
          }}
        />
        {rateAsOptions.length > 1 && (
          <div className={styles['slotField']}>
            <Select
              label="Rate as"
              options={rateAsOptions}
              value={setup.promotionId ?? ''}
              onValueChange={(value) => {
                const option = options.rateAs.find((candidate) => candidate.id === value);
                if (option !== undefined) setPromotion(option.id);
              }}
            />
            <p className={styles['chipsNote']}>
              {ratingAsRival
                ? 'Rated by the rules this rival plays by. Run to see them.'
                : 'Pick a rival to see the rules its shows are rated by.'}
            </p>
          </div>
        )}
        <p className={styles['rules']}>
          <span className={styles['rulesLabel']}>Rules</span>
          <Badge tone="neutral">{rulesLabel ?? DEFAULT_RULES_LABEL}</Badge>
        </p>
        {/* On a phone the Winner and finish group sits under the sides instead (MatchLabView). */}
        {!isMobile && !isAngle && <LabResultGroup />}
      </div>
    </Panel>
  );
}
