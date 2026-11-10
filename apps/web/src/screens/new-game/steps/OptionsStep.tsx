import { formatGameDate, formatNumber } from '@/components/format';
import { Button } from '@/components/Button';
import { Panel } from '@/components/Panel';
import { Switch } from '@/components/Switch';
import type { NewGameSettingDef, NewGameSettingGroup, WorldPreview } from '@ringside/engine';
import { SegmentedChoice, TextField } from '../fields/Fields';
import type { SegmentOption } from '../fields/Fields';
import type { DraftSnapshot } from '../draftModel';
import {
  customWeeksMessage,
  seasonChoice,
  seasonOneWindow,
  SEED_MAX,
  settingValue,
  validCustomWeeks,
} from '../draftModel';
import type { WizardIssue } from '../issues';
import { fieldMessage } from '../issues';
import { codeLabel, SETTING_GROUP_LABELS } from '../labels';
import type { SeasonLengthDraft } from '../useNewGameDraft';
import styles from './Steps.module.css';

/** The segmented control's value for a custom length. Preset keys never clash with it. */
const CUSTOM_SEASON = 'custom';

export interface OptionsStepProps {
  readonly preview: WorldPreview;
  readonly draft: DraftSnapshot;
  readonly issues: readonly WizardIssue[];
  readonly onSeasonLengthChange: (seasonLength: SeasonLengthDraft) => void;
  readonly onSettingChange: (key: string, value: boolean | string) => void;
  readonly onSeedChange: (seed: string) => void;
  readonly onNewSeed: () => void;
  readonly onStartDateChange: (startDate: string | null) => void;
}

/** The settings in groups, each group in the order its first setting was registered. */
function groupSettings(
  settings: readonly NewGameSettingDef[],
): readonly { group: NewGameSettingGroup; settings: NewGameSettingDef[] }[] {
  const groups: { group: NewGameSettingGroup; settings: NewGameSettingDef[] }[] = [];

  /** Hide these until systems that read them exist. They are still stored in the draft so they can be used later. */
  const SKIPPED_SETTING_KEYS = new Set(['agingEnabled', 'sandbox', 'generationLevel']);

  for (const definition of settings) {
    const existing = groups.find((entry) => entry.group === definition.group);
    if (SKIPPED_SETTING_KEYS.has(definition.key)) continue;
    if (existing === undefined) {
      groups.push({ group: definition.group, settings: [definition] });
    } else {
      existing.settings.push(definition);
    }
  }
  return groups;
}

interface SettingFieldProps {
  readonly definition: NewGameSettingDef;
  readonly value: boolean | string;
  readonly error: string | undefined;
  readonly onChange: (key: string, value: boolean | string) => void;
}

/** One registered setting: a switch for on/off, a segmented choice for options. */
function SettingField({ definition, value, error, onChange }: SettingFieldProps) {
  const description =
    error === undefined ? (
      definition.description
    ) : (
      <>
        {definition.description} <strong>{error}</strong>
      </>
    );
  if (definition.kind === 'boolean') {
    return (
      <Switch
        label={definition.label}
        description={description}
        checked={value === true}
        onCheckedChange={(checked) => {
          onChange(definition.key, checked);
        }}
      />
    );
  }
  const options: SegmentOption<string>[] = (definition.options ?? []).map((option) => ({
    value: option,
    label: codeLabel(option),
  }));
  return (
    <SegmentedChoice
      legend={definition.label}
      legendStyle="field"
      description={description}
      options={options}
      value={typeof value === 'string' ? value : String(definition.default)}
      onValueChange={(option) => {
        onChange(definition.key, option);
      }}
    />
  );
}

/**
 * Step 3: how the game runs. The season length comes first (design decision D-08): the engine's
 * presets or a custom number of weeks, with season 1's dates worked out underneath. Then every
 * registered new-game setting, grouped, and an Advanced section for the seed and the start date.
 */
export function OptionsStep({
  preview,
  draft,
  issues,
  onSeasonLengthChange,
  onSettingChange,
  onSeedChange,
  onNewSeed,
  onStartDateChange,
}: OptionsStepProps) {
  const choice = seasonChoice(draft, preview);
  const selected = 'preset' in choice ? choice.preset : CUSTOM_SEASON;
  const { min, max } = preview.seasonLength.customWeeks;
  const seasonOptions: SegmentOption<string>[] = [
    ...preview.seasonLength.presets.map((preset) => ({ value: preset.key, label: preset.label })),
    { value: CUSTOM_SEASON, label: 'Custom' },
  ];
  const seasonOne = seasonOneWindow(draft, preview);
  // Checked as it is typed, so a length outside the range shows before Next.
  const customWeeksOutOfRange =
    'customWeeks' in choice &&
    choice.customWeeks.trim() !== '' &&
    validCustomWeeks(choice.customWeeks, preview) === null;
  const customWeeksError = customWeeksOutOfRange
    ? customWeeksMessage(preview)
    : fieldMessage(issues, 'customWeeks');

  return (
    <div className={styles['step']}>
      <SegmentedChoice
        legend="Season length"
        description="Seasons set the competitive rhythm: awards, rankings and season goals come round at the end of each one."
        options={seasonOptions}
        value={selected}
        onValueChange={(value) => {
          const preset = preview.seasonLength.presets.find((candidate) => candidate.key === value);
          if (preset !== undefined) {
            onSeasonLengthChange({ preset: preset.key });
          } else {
            onSeasonLengthChange({
              customWeeks: 'customWeeks' in choice ? choice.customWeeks : String(min),
            });
          }
        }}
      >
        {'customWeeks' in choice && (
          <TextField
            className={styles['customWeeks']}
            label="Season length in weeks"
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={1}
            value={choice.customWeeks}
            onValueChange={(customWeeks) => {
              onSeasonLengthChange({ customWeeks });
            }}
            hint={`A whole number from ${String(min)} to ${String(max)}.`}
            error={customWeeksError}
          />
        )}
      </SegmentedChoice>
      <div className={styles['seasonLine']} data-testid="season-one-line">
        <p className={styles['seasonDates']} aria-live="polite">
          {seasonOne === null
            ? 'Season 1 runs once the length is valid.'
            : `Season 1 runs ${formatGameDate(seasonOne.start, 'short')} – ${formatGameDate(
                seasonOne.end,
                'short',
              )} (${formatNumber(seasonOne.lengthDays)} days)`}
        </p>
        <p className={styles['note']}>
          Aging, birthdays, contracts and injuries follow the real calendar, whatever the season
          length.
        </p>
      </div>

      <div className={styles['settingGroups']}>
        {groupSettings(preview.settings).map(({ group, settings }) => (
          <section
            key={group}
            className={styles['settingGroup']}
            aria-labelledby={`settings-${group}`}
          >
            <h3 id={`settings-${group}`} className={styles['sectionTitle']}>
              {SETTING_GROUP_LABELS[group]}
            </h3>
            {settings.map((definition) => (
              <SettingField
                key={definition.key}
                definition={definition}
                value={settingValue(definition, draft.settings)}
                error={fieldMessage(issues, `setting.${definition.key}`)}
                onChange={onSettingChange}
              />
            ))}
          </section>
        ))}
      </div>

      <Panel
        title="Advanced"
        headingLevel={3}
        collapsible
        defaultCollapsed={
          fieldMessage(issues, 'seed') === undefined &&
          fieldMessage(issues, 'startDate') === undefined
        }
      >
        <div className={styles['advancedFields']}>
          <TextField
            label="Seed"
            value={draft.seed}
            onValueChange={onSeedChange}
            maxLength={SEED_MAX}
            spellCheck={false}
            autoComplete="off"
            hint="The same seed and choices build the same world."
            error={fieldMessage(issues, 'seed')}
            trailing={
              <Button iconStart="reset" onClick={onNewSeed}>
                New seed
              </Button>
            }
          />
          <TextField
            label="Start date"
            type="date"
            min={preview.startDate}
            value={draft.startDate ?? preview.startDate}
            onValueChange={(startDate) => {
              onStartDateChange(startDate === '' ? null : startDate);
            }}
            hint={`The world starts on ${formatGameDate(preview.startDate, 'long')}; you can start later.`}
            error={fieldMessage(issues, 'startDate')}
          />
        </div>
      </Panel>
    </div>
  );
}
