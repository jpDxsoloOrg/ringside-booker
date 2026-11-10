import type { ReactNode } from 'react';
import type { EntityRef, TraceNode } from '@ringside/engine';

/**
 * Draws the name of an entity a trace points at. Inside the game the shell provides one that
 * links people to their profiles (`app/entityLinks.tsx`); everywhere else the label is plain text.
 */
export type EntityLinkRenderer = (ref: EntityRef, label: string) => ReactNode;

/** Shows the label as plain text: the default outside the game. */
export const plainEntityLabel: EntityLinkRenderer = (_ref, label) => label;

/** What every row renderer gets. */
export interface TraceRowProps<Node extends TraceNode = TraceNode> {
  readonly node: Node;
  readonly renderEntityLink: EntityLinkRenderer;
}
