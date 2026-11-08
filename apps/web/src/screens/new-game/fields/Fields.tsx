import { forwardRef, useId } from 'react';
import type { ChangeEvent, InputHTMLAttributes, ReactNode } from 'react';
import { classNames } from '@/components/classNames';
import { Icon } from '@/components/Icon';
import styles from './Fields.module.css';

export interface FieldErrorProps {
  readonly id: string;
  readonly message: string | undefined;
}

/** A field's problem, under it: a warning icon and the message, never colour alone. */
export function FieldError({ id, message }: FieldErrorProps) {
  if (message === undefined) return null;
  return (
    <p id={id} className={styles['error']} data-field-error="">
      <Icon name="warning" size="sm" className={styles['errorIcon']} decorative />
      {message}
    </p>
  );
}

type ManagedInputAttribute =
  'id' | 'value' | 'onChange' | 'style' | 'aria-invalid' | 'aria-describedby' | 'className';

export interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  ManagedInputAttribute
> {
  /** The visible label. */
  readonly label: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  /** A line under the field, such as the allowed length. */
  readonly hint?: ReactNode;
  /** The field's problem, shown under it and read out with it. */
  readonly error?: string | undefined;
  /** Shows the text upper-cased as it is typed (the value keeps what was typed). */
  readonly uppercase?: boolean;
  /** Controls after the input on the same row, such as a "New seed" button. */
  readonly trailing?: ReactNode;
  readonly className?: string | undefined;
}

/** A labelled text input with an optional hint and an inline error tied to it for screen readers. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  {
    label,
    value,
    onValueChange,
    hint,
    error,
    uppercase = false,
    trailing,
    className,
    type = 'text',
    ...inputAttributes
  },
  ref,
) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const describedBy =
    [hint === undefined ? null : hintId, error === undefined ? null : errorId]
      .filter((id): id is string => id !== null)
      .join(' ') || undefined;

  const input = (
    <input
      {...inputAttributes}
      ref={ref}
      id={inputId}
      type={type}
      value={value}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        onValueChange(event.target.value);
      }}
      aria-invalid={error === undefined ? undefined : true}
      aria-describedby={describedBy}
      className={classNames(styles['input'], uppercase && styles['uppercase'])}
    />
  );

  return (
    <div className={classNames(styles['field'], className)}>
      <label htmlFor={inputId} className={styles['label']}>
        {label}
      </label>
      {trailing === undefined ? (
        input
      ) : (
        <div className={styles['inputRow']}>
          {input}
          {trailing}
        </div>
      )}
      {hint !== undefined && (
        <p id={hintId} className={styles['hint']}>
          {hint}
        </p>
      )}
      <FieldError id={errorId} message={error} />
    </div>
  );
});

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
