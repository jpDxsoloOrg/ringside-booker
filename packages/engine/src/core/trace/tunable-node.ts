/** Builds the `tunable` node that records one read from a tunables reader. */

import { InvalidArgumentError } from '../errors';
import type { TunableDefinitions, TunableRawValue } from '../tunables/define';
import type { TunableReader } from '../tunables/resolver';
import type { TunableNode } from './types';

function asRawValue(key: string, value: unknown): TunableRawValue {
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  throw new InvalidArgumentError('tunableNode', key, value, 'a number, true/false or text');
}

/**
 * The trace node for reading `key` from `reader`: the value in use, the default, whether the save
 * overrides it (an override of 0 is still an override), plus the tunable's unit and doc anchor.
 * `label` defaults to the tunable's description.
 */
export function tunableNode<Defs extends TunableDefinitions>(
  reader: TunableReader<Defs>,
  key: keyof Defs & string,
  label?: string,
): TunableNode {
  const definition = reader.def(key);
  return {
    kind: 'tunable',
    label: label ?? definition.description,
    key,
    value: asRawValue(key, reader.get(key)),
    defaultValue: asRawValue(key, reader.defaultOf(key)),
    overridden: reader.isOverridden(key),
    unit: definition.unit,
    ...(definition.docRef === undefined ? {} : { docRef: definition.docRef }),
  };
}
