import { useId } from 'react';
import { IconButton } from '../Button';
import { classNames } from '../classNames';
import { formatNumber } from '../format';
import { SegmentedMeter } from '../SegmentedMeter';
import { Tooltip } from '../Tooltip';
import styles from './LevelStepper.module.css';

/** The levels a stepper covers when no `max` is given: production areas run 0 to 10. */
export const DEFAULT_STEPPER_MAX = 10;

/** What a button says when the level is already at the top or the bottom of its range. */
export const AT_MAX_REASON = 'Already at the highest level';
export const AT_MIN_REASON = 'Already at the lowest level';

export interface LevelStepperProps {
  /** What the level is for, such as "Camera". Names the group and both buttons. */
  readonly label: string;
  /** The level shown. */
  readonly level: number;
  /** The lowest level allowed, 0 by default. A TV deal's camera floor raises it. */
  readonly min?: number;
  /** The highest level allowed, {@link DEFAULT_STEPPER_MAX} by default. */
  readonly max?: number;
  /** Why − is held back at `min` (above 0), such as the TV deal. {@link AT_MIN_REASON} otherwise. */
  readonly minReason?: string;
  /** Why + is held back at `max`. {@link AT_MAX_REASON} by default. */
  readonly maxReason?: string;
  /** Holds both buttons back, for example while a change is on its way. */
  readonly disabled?: boolean;
  /** Why both buttons are held back, when `disabled`. */
  readonly disabledReason?: string;
  /** Asked for the level one below or one above. The stepper keeps no level of its own. */
  readonly onRequestChange: (level: number) => void;
  readonly className?: string | undefined;
}

interface StepButtonProps {
  readonly icon: 'decrease' | 'add';
  readonly label: string;
  /** Why the button is held back, or null when it works. */
  readonly blockedBy: string | null;
  readonly onPress: () => void;
}

/**
 * One − or + button. A held-back button stays focusable (`aria-disabled`, not `disabled`), so the
 * keyboard reaches it and its tooltip can say why it does nothing.
 */
function StepButton({ icon, label, blockedBy, onPress }: StepButtonProps) {
  const button = (
    <IconButton
      icon={icon}
      label={label}
      variant="secondary"
      className={styles['step']}
      aria-disabled={blockedBy === null ? undefined : true}
      onClick={() => {
        if (blockedBy === null) onPress();
      }}
    />
  );
  return blockedBy === null ? button : <Tooltip content={blockedBy}>{button}</Tooltip>;
}

/**
 * A 0–10 level as ten ticks between a − and a + button ("Lower Camera", "Raise Camera"), with
 * "Level 4 of 10" beside it: a `group` named "Camera level" holding the two buttons and a `meter`
 * that carries the level as `aria-valuenow` on the 0..`max` scale (ARIA does not allow value
 * attributes on a group itself). Purely presentational: a press calls `onRequestChange` with the level one below or
 * one above, and the screen decides what happens (the Production screen opens its change dialog).
 * The buttons are 44px on a touch screen and below `--bp-mobile`.
 */
export function LevelStepper({
  label,
  level,
  min = 0,
  max = DEFAULT_STEPPER_MAX,
  minReason,
  maxReason = AT_MAX_REASON,
  disabled = false,
  disabledReason,
  onRequestChange,
  className,
}: LevelStepperProps) {
  const valueId = useId();
  const held = disabled ? (disabledReason ?? 'Not available right now') : null;
  const atMinReason = min > 0 ? (minReason ?? AT_MIN_REASON) : AT_MIN_REASON;
  const lowerBlockedBy = held ?? (level <= min ? atMinReason : null);
  const raiseBlockedBy = held ?? (level >= max ? maxReason : null);
  const valueText = `Level ${formatNumber(level)} of ${formatNumber(max)}`;

  return (
    <div
      role="group"
      aria-label={`${label} level`}
      aria-describedby={valueId}
      className={classNames(styles['stepper'], className)}
      data-disabled={disabled || undefined}
    >
      <StepButton
        icon="decrease"
        label={`Lower ${label}`}
        blockedBy={lowerBlockedBy}
        onPress={() => {
          onRequestChange(level - 1);
        }}
      />
      <SegmentedMeter
        label={`${label} level`}
        value={level}
        max={max}
        segments={max}
        // Levels have no danger zone: a high level is simply more production.
        dangerFrom={max + 1}
        hideLabel
        showValue={false}
        valueText={valueText}
        className={styles['meter']}
      />
      <StepButton
        icon="add"
        label={`Raise ${label}`}
        blockedBy={raiseBlockedBy}
        onPress={() => {
          onRequestChange(level + 1);
        }}
      />
      <span id={valueId} className={classNames(styles['value'], 'tabular')}>
        {valueText}
      </span>
    </div>
  );
}
