/**
 * Lists of IDs inside a row.
 *
 * Most ID lists are sets in disguise: listing the same region twice in a network's coverage, or the
 * same person twice in a mail's references, is always a mistake. `zUniqueIdList` rejects
 * duplicates and names the index of each repeat.
 */

import { z } from 'zod';
import type { EntityKind, IdOf } from '../../core/ids';
import { zId } from '../primitives';

/** An array of IDs of one kind with no duplicates. Order is kept as given. */
export function zUniqueIdList<K extends EntityKind>(kind: K): z.ZodType<IdOf<K>[]> {
  return z.array(zId(kind)).superRefine((ids, context) => {
    const seen = new Set<string>();
    ids.forEach((id, index) => {
      if (seen.has(id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate ${kind} ID ${id}`,
          path: [index],
        });
      }
      seen.add(id);
    });
  });
}
