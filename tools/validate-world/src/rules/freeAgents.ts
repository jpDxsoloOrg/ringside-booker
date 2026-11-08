/**
 * `free-agents`: a promotion founded on day one has someone to hire. Warns when fewer than 30
 * active wrestlers are without a contract on the start date.
 */

import type { GameWorldView, MergedContent } from '@ringside/engine';
import { validationWarning } from '../issues';
import {
  activeEmployments,
  isActivePerson,
  isWrestler,
  refKey,
  sortedRecords,
  worldStartDate,
  type ContentRule,
} from './helpers';

/** Fewest unsigned wrestlers the world should start with. */
export const MIN_FREE_AGENTS = 30;

/** The keys of active wrestlers with no contract running on the start date, sorted. */
export function freeAgentKeys(world: GameWorldView, content: MergedContent): string[] {
  const employed = new Set(
    activeEmployments(content, worldStartDate(world)).map(([, merged]) =>
      refKey(merged.record.personKey),
    ),
  );
  return sortedRecords(content, 'person')
    .filter(
      ([key, merged]) =>
        isWrestler(merged.record) && isActivePerson(merged.record) && !employed.has(key),
    )
    .map(([key]) => key);
}

export const freeAgents: ContentRule = {
  id: 'free-agents',
  description: `At least ${String(MIN_FREE_AGENTS)} active wrestlers start without a contract, so a new promotion can hire`,
  check(world, content) {
    const count = freeAgentKeys(world, content).length;
    if (count >= MIN_FREE_AGENTS) {
      return [];
    }
    const packId = content.packs.at(-1)?.id ?? '';
    return [
      validationWarning({
        code: 'free-agents',
        packId,
        kind: 'person',
        path: ['person'],
        message: `Only ${String(count)} active wrestlers are without a contract on ${worldStartDate(world)}; at least ${String(MIN_FREE_AGENTS)} are needed so a newly founded promotion can hire`,
      }),
    ];
  },
};
