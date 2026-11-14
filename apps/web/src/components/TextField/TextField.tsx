import { forwardRef, useId } from 'react';
import type { ChangeEvent, InputHTMLAttributes, ReactNode } from 'react';
import { classNames } from '../classNames';
import { Icon } from '../Icon';
import styles from './TextField.module.css';

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
