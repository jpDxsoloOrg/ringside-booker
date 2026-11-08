import * as RadixSwitch from '@radix-ui/react-switch';
import { useId } from 'react';
import type { ReactNode } from 'react';
import { classNames } from '../classNames';
import styles from './Switch.module.css';

interface SwitchSharedProps {
  /** What the switch turns on, such as "Autosave". Clicking it toggles the switch too. */
  readonly label: ReactNode;
  /** A line under the label explaining the setting. Read out as the switch's description. */
  readonly description?: ReactNode;
  readonly disabled?: boolean;
  /** Form field name, for a switch inside a `<form>`. */
  readonly name?: string;
  readonly className?: string;
}

export interface ControlledSwitchProps extends SwitchSharedProps {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly defaultChecked?: never;
}

export interface UncontrolledSwitchProps extends SwitchSharedProps {
  /** Off by default. */
  readonly defaultChecked?: boolean;
  readonly onCheckedChange?: (checked: boolean) => void;
  readonly checked?: never;
}

/** Either controlled (`checked` + `onCheckedChange`) or uncontrolled (`defaultChecked`). */
export type SwitchProps = ControlledSwitchProps | UncontrolledSwitchProps;

/**
 * An on/off setting that applies straight away, such as "Pause on injuries". Built on Radix
 * Switch, so it is a `role="switch"` button that Space and Enter toggle. Use a checkbox instead
 * when the choice only applies after a Save.
 */
export function Switch({
  label,
  description,
  disabled = false,
  name,
  className,
  checked,
  defaultChecked,
  onCheckedChange,
}: SwitchProps) {
  const switchId = useId();
  const descriptionId = useId();
  const checkedState = checked === undefined ? {} : { checked };
  const defaultState = defaultChecked === undefined ? {} : { defaultChecked };
  const changeHandler = onCheckedChange === undefined ? {} : { onCheckedChange };
  const nameAttribute = name === undefined ? {} : { name };

  return (
    <div
      className={classNames(styles['field'], className)}
      data-disabled={disabled ? '' : undefined}
    >
      <RadixSwitch.Root
        id={switchId}
        disabled={disabled}
        aria-describedby={description === undefined ? undefined : descriptionId}
        className={styles['track']}
        {...checkedState}
        {...defaultState}
        {...changeHandler}
        {...nameAttribute}
      >
        <RadixSwitch.Thumb className={styles['thumb']} />
      </RadixSwitch.Root>
      <div className={styles['text']}>
        <label htmlFor={switchId} className={styles['label']}>
          {label}
        </label>
        {description !== undefined && (
          <p id={descriptionId} className={styles['description']}>
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
