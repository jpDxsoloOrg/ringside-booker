import * as RadixSelect from '@radix-ui/react-select';
import { useId } from 'react';
import { classNames } from '../classNames';
import { Icon } from '../Icon';
import { VisuallyHidden } from '../layout';
import styles from './Select.module.css';

export interface SelectOption {
  /** What `onValueChange` receives. Must not be empty. */
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
  /**
   * A heading the option is listed under, such as a country above its regions. Options with the
   * same group should sit next to each other; each run of them is drawn as one labelled group.
   */
  readonly group?: string;
}

interface OptionRun {
  readonly group: string | undefined;
  readonly options: readonly SelectOption[];
}

/** The options split into runs that share a group, in the order given. */
export function groupSelectOptions(options: readonly SelectOption[]): readonly OptionRun[] {
  const runs: { group: string | undefined; options: SelectOption[] }[] = [];
  for (const option of options) {
    const last = runs.at(-1);
    if (last !== undefined && last.group === option.group) last.options.push(option);
    else runs.push({ group: option.group, options: [option] });
  }
  return runs;
}

interface SelectSharedProps {
  /** Names the field. Shown above it unless `hideLabel` is set. */
  readonly label: string;
  /** Keep the label for screen readers only, where the context already says what it is. */
  readonly hideLabel?: boolean;
  readonly options: readonly SelectOption[];
  /** Shown while nothing is chosen. */
  readonly placeholder?: string;
  readonly disabled?: boolean;
  /** Form field name, for a select inside a `<form>`. */
  readonly name?: string;
  readonly className?: string;
}

export interface ControlledSelectProps extends SelectSharedProps {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly defaultValue?: never;
}

export interface UncontrolledSelectProps extends SelectSharedProps {
  readonly defaultValue?: string;
  readonly onValueChange?: (value: string) => void;
  readonly value?: never;
}

/** Either controlled (`value` + `onValueChange`) or uncontrolled (optional `defaultValue`). */
export type SelectProps = ControlledSelectProps | UncontrolledSelectProps;

function renderItem(option: SelectOption) {
  return (
    <RadixSelect.Item
      key={option.value}
      value={option.value}
      disabled={option.disabled ?? false}
      className={styles['item']}
    >
      <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
      <RadixSelect.ItemIndicator className={styles['indicator']}>
        <Icon name="check" decorative />
      </RadixSelect.ItemIndicator>
    </RadixSelect.Item>
  );
}

/**
 * Pick one option from a short list, styled to match the game rather than the browser. Built on
 * Radix Select: Enter, Space or the arrow keys open it, Up and Down move, typing jumps to a match,
 * Enter picks and Escape closes without changing anything.
 *
 * The list opens below the field (above when there is no room) and is never wider than the
 * screen, so it works the same on a phone. Options that name a `group` are listed under it.
 */
export function Select({
  label,
  hideLabel = false,
  options,
  placeholder,
  disabled = false,
  name,
  className,
  value,
  defaultValue,
  onValueChange,
}: SelectProps) {
  const triggerId = useId();
  const valueState = value === undefined ? {} : { value };
  const defaultState = defaultValue === undefined ? {} : { defaultValue };
  const changeHandler = onValueChange === undefined ? {} : { onValueChange };
  const nameAttribute = name === undefined ? {} : { name };
  const placeholderText = placeholder === undefined ? {} : { placeholder };

  return (
    <div className={classNames(styles['field'], className)}>
      {hideLabel ? (
        <VisuallyHidden>
          <label htmlFor={triggerId}>{label}</label>
        </VisuallyHidden>
      ) : (
        <label htmlFor={triggerId} className={styles['label']}>
          {label}
        </label>
      )}
      <RadixSelect.Root
        {...valueState}
        {...defaultState}
        {...changeHandler}
        {...nameAttribute}
        disabled={disabled}
      >
        <RadixSelect.Trigger id={triggerId} className={styles['trigger']}>
          <span className={styles['value']}>
            <RadixSelect.Value {...placeholderText} />
          </span>
          <RadixSelect.Icon className={styles['chevron']}>
            <Icon name="chevron-down" decorative />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content
            position="popper"
            sideOffset={4}
            collisionPadding={8}
            className={styles['content']}
          >
            <RadixSelect.Viewport className={styles['viewport']}>
              {groupSelectOptions(options).map((run, index) =>
                run.group === undefined ? (
                  run.options.map(renderItem)
                ) : (
                  <RadixSelect.Group
                    // A group name may repeat further down the list, so the run's place is the key.
                    key={`group-${String(index)}`}
                    className={styles['group']}
                  >
                    <RadixSelect.Label className={styles['groupLabel']}>
                      {run.group}
                    </RadixSelect.Label>
                    {run.options.map(renderItem)}
                  </RadixSelect.Group>
                ),
              )}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  );
}
