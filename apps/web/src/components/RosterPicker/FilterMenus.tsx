import { forwardRef, useId } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import type { Push } from '@ringside/engine';
import { Icon } from '../Icon';
import { Popover } from '../Popover';
import { GENDER_CHOICES, genderChipLabel, PUSH_CHOICES, pushChipLabel } from './rosterFilters';
import type { GenderChoice } from './rosterFilters';
import styles from './RosterPicker.module.css';

interface MenuChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** True when the filter narrows the list: the chip is marked and its words say how. */
  readonly narrowed: boolean;
  readonly children: string;
}

/**
 * A filter chip that opens a small menu. It forwards its ref and the props Radix gives a popover
 * trigger (`aria-expanded`, the click handler), so it can be the Popover's trigger.
 */
const MenuChip = forwardRef<HTMLButtonElement, MenuChipProps>(function MenuChip(
  { narrowed, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={styles['filter']}
      data-narrowed={narrowed ? '' : undefined}
      {...rest}
    >
      {narrowed && <Icon name="check" size="sm" decorative />}
      {children}
      <Icon name="chevron-down" size="sm" decorative />
    </button>
  );
});

export interface GenderFilterMenuProps {
  readonly value: GenderChoice;
  readonly onChange: (value: GenderChoice) => void;
}

/** "Gender": All, Men, Women and any other gender, one at a time. */
export function GenderFilterMenu({ value, onChange }: GenderFilterMenuProps) {
  const name = useId();
  return (
    <Popover
      title="Show by gender"
      trigger={<MenuChip narrowed={value !== 'all'}>{genderChipLabel(value)}</MenuChip>}
    >
      <fieldset className={styles['menuList']}>
        <legend className={styles['menuLegend']}>Gender</legend>
        {GENDER_CHOICES.map((choice) => (
          <label key={choice.value} className={styles['menuItem']}>
            <input
              type="radio"
              name={name}
              className={styles['menuInput']}
              checked={value === choice.value}
              onChange={() => {
                onChange(choice.value);
              }}
            />
            {choice.label}
          </label>
        ))}
      </fieldset>
    </Popover>
  );
}

export interface PushFilterMenuProps {
  readonly value: ReadonlySet<Push>;
  readonly onChange: (value: ReadonlySet<Push>) => void;
}

/** "Push": one or more card positions, all of them to begin with. */
export function PushFilterMenu({ value, onChange }: PushFilterMenuProps) {
  const everything = value.size === PUSH_CHOICES.length;
  return (
    <Popover
      title="Show by push"
      trigger={<MenuChip narrowed={!everything}>{pushChipLabel(value)}</MenuChip>}
    >
      <fieldset className={styles['menuList']}>
        <legend className={styles['menuLegend']}>Push</legend>
        {PUSH_CHOICES.map((choice) => (
          <label key={choice.value} className={styles['menuItem']}>
            <input
              type="checkbox"
              className={styles['menuInput']}
              checked={value.has(choice.value)}
              onChange={(event) => {
                const next = new Set(value);
                if (event.target.checked) next.add(choice.value);
                else next.delete(choice.value);
                onChange(next);
              }}
            />
            {choice.label}
          </label>
        ))}
        <button
          type="button"
          className={styles['menuReset']}
          disabled={everything}
          onClick={() => {
            onChange(new Set(PUSH_CHOICES.map((choice) => choice.value)));
          }}
        >
          Show every push
        </button>
      </fieldset>
    </Popover>
  );
}
