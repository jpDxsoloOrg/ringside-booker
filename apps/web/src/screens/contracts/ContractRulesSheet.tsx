import { useState } from 'react';
import { PUSH_LABELS, PUSH_LEVELS } from '@ringside/engine';
import type { Push } from '@ringside/engine';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import type { RadioOption } from '@/components/RadioGroup';
import { RadioGroup } from '@/components/RadioGroup';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import { Sheet } from '@/components/Sheet';
import { Switch } from '@/components/Switch';
import {
  CUSTOM_PATIENCE,
  EXPIRING_MIN_PUSH_KEY,
  EXPIRING_STOP_KEY,
  matchingPatience,
  PATIENCE_PRESETS,
  QUIT_DAYS_KEY,
  QUIT_THRESHOLD_KEY,
} from './patiencePresets';
import type { PatienceId } from './patiencePresets';
import type { ContractRules } from './useContractRules';
import styles from './ContractsScreen.module.css';

type PatienceChoice = PatienceId | typeof CUSTOM_PATIENCE;

/** "Warn from push" options: each card position, then everyone. */
export const MIN_PUSH_OPTIONS: readonly SelectOption[] = PUSH_LEVELS.map((push: Push) => ({
  value: push,
  label: push === 'none' ? 'Everyone, crew included' : `${PUSH_LABELS[push]} and up`,
}));

export interface ContractRulesSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly rules: ContractRules;
}

/**
 * The owner's contract rules, saved with this game: how patient unhappy workers are, whether a
 * contract about to end stops a skip, and from which push it warns. Each change goes through
 * `tunables.setOverride` / `tunables.clearOverride` straight away.
 */
export function ContractRulesSheet({ open, onClose, rules }: ContractRulesSheetProps) {
  const setOverride = useEngineCommand('tunables.setOverride');
  const clearOverride = useEngineCommand('tunables.clearOverride');
  const [error, setError] = useState<string | null>(null);
  const busy = setOverride.pending || clearOverride.pending;

  const patience = matchingPatience({
    threshold: rules.quitThreshold,
    days: rules.quitDays,
    thresholdOverridden: rules.quitThresholdOverridden,
    daysOverridden: rules.quitDaysOverridden,
  });

  const report = (results: readonly { ok: boolean; reasons?: { message: string }[] }[]): void => {
    const failed = results.flatMap((result) => (result.ok ? [] : (result.reasons ?? [])));
    setError(failed.length === 0 ? null : failed.map((reason) => reason.message).join(' '));
  };

  const choosePatience = async (choice: PatienceChoice): Promise<void> => {
    const preset = PATIENCE_PRESETS.find((candidate) => candidate.id === choice);
    if (preset === undefined) return;
    if (preset.threshold === null || preset.days === null) {
      report([
        await clearOverride.run({ key: QUIT_THRESHOLD_KEY }),
        await clearOverride.run({ key: QUIT_DAYS_KEY }),
      ]);
      return;
    }
    report([
      await setOverride.run({ key: QUIT_THRESHOLD_KEY, value: preset.threshold }),
      await setOverride.run({ key: QUIT_DAYS_KEY, value: preset.days }),
    ]);
  };

  const options: RadioOption<PatienceChoice>[] = PATIENCE_PRESETS.map((preset) => ({
    value: preset.id,
    label: preset.label,
    description: preset.description,
  }));
  if (patience === CUSTOM_PATIENCE) {
    options.push({
      value: CUSTOM_PATIENCE,
      label: 'Custom',
      description: `Morale ${String(rules.quitThreshold)} or lower for ${String(rules.quitDays)} days. Pick a preset to change it.`,
      unavailable: true,
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title="Contract rules" size="sm">
      <div className={styles['rules']}>
        <p className={styles['muted']}>Saved with this game. A new game starts at Normal.</p>
        <RadioGroup
          legend="Worker patience"
          description="How unhappy a worker gets, and for how long, before asking to leave."
          options={options}
          value={patience}
          disabled={busy}
          onValueChange={(choice) => {
            void choosePatience(choice);
          }}
        />
        <Switch
          label="Stop skips when a contract is about to end"
          description={`Within ${String(rules.expiringSoonDays)} days of its end date. Off: the Expiring tab still lists it.`}
          checked={rules.expiringStop}
          disabled={busy}
          onCheckedChange={(checked) => {
            void (async () => {
              report([await setOverride.run({ key: EXPIRING_STOP_KEY, value: checked })]);
            })();
          }}
        />
        <Select
          label="Warn from push"
          options={MIN_PUSH_OPTIONS}
          value={rules.expiringMinPush}
          disabled={busy}
          onValueChange={(value) => {
            void (async () => {
              report([await setOverride.run({ key: EXPIRING_MIN_PUSH_KEY, value })]);
            })();
          }}
        />
        {error !== null && (
          <p role="alert" className={styles['error']}>
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
