import { useId } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { classNames } from '../classNames';
import styles from './RadioGroup.module.css';

export interface RadioOption<Value extends string> {
  readonly value: Value;
  /** The option's name, such as "Compact". Clicking anywhere on the option picks it. */
  readonly label: ReactNode;
  /** A line under the label, read out as the option's description. */
  readonly description?: ReactNode;
  /** A small picture of the option drawn after the text, such as a colour swatch. Decorative. */
  readonly preview?: ReactNode;
  /**
   * Shows the option but refuses it: it stays reachable by keyboard and is announced as
   * unavailable (`aria-disabled`), so put the reason in `description`. Picking it does nothing.
   */
  readonly unavailable?: boolean;
}

export interface RadioGroupProps<Value extends string> {
  /** Names the group. Rendered as the fieldset's legend. */
  readonly legend: ReactNode;
  /** A line under the legend explaining the choice. */
  readonly description?: ReactNode;
  readonly options: readonly RadioOption<Value>[];
  readonly value: Value;
  readonly onValueChange: (value: Value) => void;
  /** `column` (the default) stacks the options; `row` puts them side by side on wide screens. */
  readonly layout?: 'column' | 'row';
  readonly disabled?: boolean;
  readonly className?: string;
}

/**
 * One choice from a short list that applies straight away, such as a setting. Native radio inputs
 * in a fieldset: Tab reaches the group, the arrow keys move and pick, and screen readers announce
 * the legend as the group's name. Each option is a full-width card that is at least a finger tall
 * on touch screens. Use a `Select` for long lists.
 */
export function RadioGroup<Value extends string>({
  legend,
  description,
  options,
  value,
  onValueChange,
  layout = 'column',
  disabled = false,
  className,
}: RadioGroupProps<Value>) {
  const groupName = useId();
  const descriptionId = useId();
  const optionIdPrefix = useId();

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = options.find((option) => option.value === event.target.value);
    if (picked !== undefined && picked.unavailable !== true) onValueChange(picked.value);
  };

  return (
    <fieldset
      className={classNames(styles['group'], className)}
      aria-describedby={description === undefined ? undefined : descriptionId}
      disabled={disabled}
    >
      <legend className={styles['legend']}>{legend}</legend>
      {description !== undefined && (
        <p id={descriptionId} className={styles['description']}>
          {description}
        </p>
      )}
      <div className={classNames(styles['options'], styles[`layout-${layout}`])}>
        {options.map((option) => {
          const optionId = `${optionIdPrefix}-${option.value}`;
          const optionLabelId = `${optionId}-label`;
          const optionDescriptionId = `${optionId}-description`;
          return (
            <label
              key={option.value}
              htmlFor={optionId}
              className={classNames(
                styles['option'],
                option.unavailable === true && styles['optionUnavailable'],
              )}
            >
              <input
                id={optionId}
                type="radio"
                name={groupName}
                value={option.value}
                checked={option.value === value}
                onChange={handleChange}
                aria-disabled={option.unavailable === true ? true : undefined}
                // Named by the label text alone; the description is read out as a description.
                aria-labelledby={optionLabelId}
                aria-describedby={
                  option.description === undefined ? undefined : optionDescriptionId
                }
                className={styles['input']}
              />
              <span className={styles['text']}>
                <span id={optionLabelId} className={styles['label']}>
                  {option.label}
                </span>
                {option.description !== undefined && (
                  <span id={optionDescriptionId} className={styles['optionDescription']}>
                    {option.description}
                  </span>
                )}
              </span>
              {option.preview !== undefined && (
                <span className={styles['preview']} aria-hidden="true">
                  {option.preview}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
