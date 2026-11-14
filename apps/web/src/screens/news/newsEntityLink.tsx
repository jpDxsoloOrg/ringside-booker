/**
 * How the News screen links names (DAY1-06, wiring WRK1): a person through WRK1's `WorkerLink`,
 * which goes to `routes.game.worker(id)` like every other worker name in the game, and anything
 * else through the game's own entity links. Outside a game (the component gallery) the renderer
 * in force draws plain text, and this keeps it that way.
 */
import { useMemo } from 'react';
import { isId } from '@ringside/engine';
import { useEntityLinkRenderer } from '@/app/entityLinks';
import { plainEntityLabel } from '@/components/Trace/rows/rowTypes';
import type { EntityLinkRenderer } from '@/components/Trace/rows/rowTypes';
import { WorkerLink } from '@/components/WorkerLink';

/** `base` with people drawn as `WorkerLink`s; plain text stays plain text. */
export function newsEntityLink(base: EntityLinkRenderer): EntityLinkRenderer {
  if (base === plainEntityLabel) return base;
  return (ref, label) =>
    ref.kind === 'person' && isId('person', ref.id) ? (
      <WorkerLink personId={ref.id} name={label} />
    ) : (
      base(ref, label)
    );
}

/** The renderer the News screen, its cards, its story sheet and the Office panel use. */
export function useNewsEntityLink(): EntityLinkRenderer {
  const base = useEntityLinkRenderer();
  return useMemo(() => newsEntityLink(base), [base]);
}
