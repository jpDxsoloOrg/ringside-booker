import { useState } from 'react';
import type { ReactNode } from 'react';
import { cents } from '@ringside/engine';
import type { Cents } from '@ringside/engine';
import { formatMoney } from '../format';
import { TextField } from '../TextField';

/** Cents in one whole unit. */
const CENTS_PER_UNIT = 100;

/** The most whole units the field takes ($999,999,999): far above any wage, well inside a number. */
export const MONEY_FIELD_MAX_UNITS = 999_999_999;

/** "$41,300": the amount as the field writes it while you are not typing (always in full). */
export function moneyFieldText(value: number): string {
  return formatMoney(cents(Math.round(value / CENTS_PER_UNIT) * CENTS_PER_UNIT), { style: 'full' });
}

/**
 * Whole units typed in any shape ("41300", "$41,300", "41 300") as cents; empty means 0. Anything
 * after a decimal point is dropped: offers are made in whole units.
 */
export function parseMoneyField(text: string): Cents {
  const whole = text.split('.')[0] ?? '';
  const digits = whole.replace(/\D/gu, '');
  if (digits === '') return cents(0);
  const units = Math.min(Number.parseInt(digits, 10), MONEY_FIELD_MAX_UNITS);
  return cents(units * CENTS_PER_UNIT);
}

export interface MoneyFieldProps {
  /** The visible label: "Monthly wage". */
  readonly label: string;
  /** The amount in cents. The field shows and takes whole units. */
  readonly value: number;
  readonly onValueChange: (value: Cents) => void;
  /** A line under the field, such as "They ask $41,300". */
  readonly hint?: ReactNode;
  /** The field's problem, shown under it and read out with it. */
  readonly error?: string | undefined;
  readonly disabled?: boolean;
  readonly name?: string;
  readonly className?: string | undefined;
}

/**
 * A money input in whole units: it shows "$41,300", opens the number keypad on a phone
 * (`inputMode="numeric"`) and hands back cents. While you type it keeps your text as it is and
 * reports every change; when you leave it, it writes the amount out again. Built on `TextField`,
 * so it is a finger tall on touch screens and phones, and its text is 16px there (no iOS zoom).
 */
export function MoneyField({
  label,
  value,
  onValueChange,
  hint,
  error,
  disabled = false,
  name,
  className,
}: MoneyFieldProps) {
  // Null while not typing: then the field shows the value as it is now (a reset from outside, such
  // as "Use their ask", shows at once).
  const [typing, setTyping] = useState<string | null>(null);
  return (
    <TextField
      label={label}
      value={typing ?? moneyFieldText(value)}
      onValueChange={(text) => {
        setTyping(text);
        onValueChange(parseMoneyField(text));
      }}
      onFocus={() => {
        setTyping(moneyFieldText(value));
      }}
      onBlur={() => {
        setTyping(null);
      }}
      inputMode="numeric"
      autoComplete="off"
      disabled={disabled}
      {...(name === undefined ? {} : { name })}
      {...(hint === undefined ? {} : { hint })}
      error={error}
      className={className}
    />
  );
}
