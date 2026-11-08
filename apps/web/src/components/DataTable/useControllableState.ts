import { useCallback, useState } from 'react';

/**
 * A value that a parent may control (pass `controlledValue` and listen to `onChange`) or leave to
 * the component (it starts from `initialValue` and keeps its own copy). Either way `setValue`
 * reports the change; only the uncontrolled copy is updated here.
 */
export function useControllableState<Value>(
  controlledValue: Value | undefined,
  initialValue: Value,
  onChange: ((value: Value) => void) | undefined,
): readonly [Value, (value: Value) => void] {
  const [ownValue, setOwnValue] = useState<Value>(initialValue);
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : ownValue;

  const setValue = useCallback(
    (nextValue: Value) => {
      if (!isControlled) setOwnValue(nextValue);
      onChange?.(nextValue);
    },
    [isControlled, onChange],
  );

  return [value, setValue] as const;
}
