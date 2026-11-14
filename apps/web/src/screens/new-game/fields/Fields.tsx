import { useId } from 'react';
import type { ReactNode } from 'react';
import { classNames } from '@/components/classNames';
import styles from './Fields.module.css';

// The text field moved to `components/TextField` (ECO5-06) so other screens can use it; the
// wizard keeps importing it from here.
export { FieldError, TextField } from '@/components/TextField';
export type { FieldErrorProps, TextFieldProps } from '@/components/TextField';

export interface SegmentOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
}

export interface SegmentedChoiceProps<Value extends string> {
  /** Names the group: the fieldset's legend. */
  readonly legend: ReactNode;
  readonly description?: ReactNode;
  readonly options: readonly SegmentOption<Value>[];
  readonly value: Value;
  readonly onValueChange: (value: Value) => void;
  /** `section` (the default) for a field that heads its area; `field` for one among others. */
  readonly legendStyle?: 'section' | 'field';
  readonly className?: string | undefined;
  readonly children?: ReactNode;
}

/**
 * A short row of choices drawn as joined segments: native radios in a fieldset, so Tab reaches the
 * group and the arrow keys move between options. The segments wrap rather than widen the page.
 */
export function SegmentedChoice<Value extends string>({
  legend,
  description,
  options,
  value,
  onValueChange,
  legendStyle = 'section',
  className,
  children,
}: SegmentedChoiceProps<Value>) {
  const groupName = useId();
  const descriptionId = useId();
  return (
    <fieldset
      className={classNames(styles['segmented'], className)}
      aria-describedby={description === undefined ? undefined : descriptionId}
    >
      <legend className={legendStyle === 'section' ? styles['legend'] : styles['fieldLegend']}>
        {legend}
      </legend>
      {description !== undefined && (
        <p id={descriptionId} className={styles['segmentedDescription']}>
          {description}
        </p>
      )}
      <div className={styles['segments']}>
        {options.map((option) => {
          const optionId = `${groupName}-${option.value}`;
          return (
            <span key={option.value} className={styles['segment']}>
              <input
                id={optionId}
                type="radio"
                name={groupName}
                value={option.value}
                checked={option.value === value}
                onChange={() => {
                  onValueChange(option.value);
                }}
                className={styles['segmentInput']}
              />
              <label htmlFor={optionId} className={styles['segmentLabel']}>
                {option.label}
              </label>
            </span>
          );
        })}
      </div>
      {children}
    </fieldset>
  );
}
