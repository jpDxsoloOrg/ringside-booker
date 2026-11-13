import { cents, POLICY_AREA_LABELS } from '@ringside/engine';
import type {
  FinancePolicyPreview,
  PolicyEffectLine,
  PolicyLevel,
  PolicyLevelPreview,
} from '@ringside/engine';
import { useSettingsStore } from '@/app/settings/settingsStore';
import { classNames } from '@/components/classNames';
import { formatSignedMoney, useMoneyFormatter } from '@/components/format';
import { RadioGroup } from '@/components/RadioGroup';
import type { RadioOption } from '@/components/RadioGroup';
import { WhyButton } from '@/components/Trace';
import styles from './Finances.module.css';

/** "(−$1,200 vs now)", or "(today's level)" for the level in force. */
export function policyDeltaText(
  level: PolicyLevelPreview,
  current: PolicyLevel,
  signed: (amount: number) => string,
): string {
  if (level.level === current) return "(today's level)";
  if (level.delta === 0) return '(same cost as now)';
  return `(${signed(level.delta)} vs now)`;
}

const EFFECT_TONE_WORDS: Readonly<Record<PolicyEffectLine['tone'], string>> = {
  positive: 'Better',
  negative: 'Worse',
  neutral: 'Note',
};

function EffectLine({ effect }: { readonly effect: PolicyEffectLine }) {
  return (
    <span className={classNames(styles['effect'], styles[`effect-${effect.tone}`])}>
      <span className={styles['effectTone']}>{EFFECT_TONE_WORDS[effect.tone]}:</span> {effect.text}
      {effect.trace !== undefined && (
        <WhyButton label={effect.text} value={effect.text} source={{ trace: effect.trace }} />
      )}
    </span>
  );
}

export interface PolicyPickerProps {
  /** The area at every level, from `finance.policyPreview`. */
  readonly preview: FinancePolicyPreview;
  /** The area's description: "Travel: who pays for getting to shows". */
  readonly description: string;
  readonly onChange: (level: PolicyLevel) => void;
  /** While a change is on its way: the options cannot be picked. */
  readonly disabled?: boolean;
  /** `row` puts the levels side by side (desktop), `column` stacks them (phone). */
  readonly layout?: 'row' | 'column';
}

function levelOf(value: string): PolicyLevel | null {
  if (value === '0') return 0;
  if (value === '1') return 1;
  if (value === '2') return 2;
  if (value === '3') return 3;
  return null;
}

/**
 * One staff policy as four radio options: None, Basic, Good and Premium, each with its expected
 * monthly cost (with a Why?), the change from today and any effect lines other features registered.
 */
export function PolicyPicker({
  preview,
  description,
  onChange,
  disabled = false,
  layout = 'row',
}: PolicyPickerProps) {
  const formatMoney = useMoneyFormatter();
  const moneyStyle = useSettingsStore((state) => state.settings.moneyStyle);
  const signed = (amount: number): string =>
    formatSignedMoney(cents(amount), { style: moneyStyle, showPlus: true });
  const areaLabel = POLICY_AREA_LABELS[preview.area];

  const options: RadioOption<string>[] = preview.levels.map((level) => ({
    value: String(level.level),
    label: level.label,
    description: (
      <span className={styles['policyOption']}>
        <span className={styles['policyCost']}>
          <span className="tabular">{formatMoney(cents(level.monthlyCost))}/month</span>{' '}
          <span className={styles['muted']}>{policyDeltaText(level, preview.current, signed)}</span>
          <WhyButton
            label={`${areaLabel} at ${level.label}, a month`}
            value={level.monthlyCost}
            unit="money"
            source={{ trace: level.monthlyCostTrace }}
          />
        </span>
        {level.effects.map((effect) => (
          <EffectLine key={effect.text} effect={effect} />
        ))}
      </span>
    ),
  }));

  return (
    <RadioGroup
      legend={`${areaLabel} level`}
      description={description}
      options={options}
      value={String(preview.current)}
      onValueChange={(value) => {
        const level = levelOf(value);
        if (level !== null && level !== preview.current) onChange(level);
      }}
      layout={layout}
      disabled={disabled}
    />
  );
}
