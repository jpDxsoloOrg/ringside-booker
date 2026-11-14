import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { Cents } from '@ringside/engine';
import { MoneyField, moneyFieldText, parseMoneyField } from './MoneyField';

function Harness({ start = 4_130_000 }: { readonly start?: number }) {
  const [value, setValue] = useState<number>(start);
  return (
    <>
      <MoneyField
        label="Monthly wage"
        value={value}
        onValueChange={(next: Cents) => {
          setValue(next);
        }}
        hint="They ask $41,300"
      />
      <output aria-label="Cents">{value}</output>
    </>
  );
}

describe('MoneyField', () => {
  it('reads whole units in any shape as cents', () => {
    expect(parseMoneyField('41300')).toBe(4_130_000);
    expect(parseMoneyField('$41,300')).toBe(4_130_000);
    expect(parseMoneyField('41,300.75')).toBe(4_130_000);
    expect(parseMoneyField('')).toBe(0);
    expect(moneyFieldText(4_130_000)).toBe('$41,300');
  });

  it('shows the amount, takes typed units and opens the number keypad', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness />);
    const input = screen.getByRole('textbox', { name: 'Monthly wage' });
    expect(input).toHaveValue('$41,300');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAccessibleDescription('They ask $41,300');
    await user.clear(input);
    await user.type(input, '24000');
    expect(screen.getByRole('status', { name: 'Cents' })).toHaveTextContent('2400000');
    await user.tab();
    expect(input).toHaveValue('$24,000');
  });

  it('ties an error to the field', () => {
    render(
      <MoneyField
        label="Signing bonus"
        value={0}
        onValueChange={() => undefined}
        error="Must be a whole amount"
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Signing bonus' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Must be a whole amount');
  });
});
