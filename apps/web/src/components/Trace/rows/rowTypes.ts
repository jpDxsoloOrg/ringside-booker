import type { ReactNode } from 'react';
import type { EntityRef, TraceNode } from '@ringside/engine';

/**
 * Draws the name of an entity a trace points at. Feature screens pass one that links to the
 * profile; until they exist the default shows the label as plain text.
 */
export type EntityLinkRenderer = (ref: EntityRef, label: string) => ReactNode;

/** Shows the label as plain text: the default until entity profile screens exist. */
export const plainEntityLabel: EntityLinkRenderer = (_ref, label) => label;

/** What every row renderer gets. */
export interface TraceRowProps<Node extends TraceNode = TraceNode> {
  readonly node: Node;
  readonly renderEntityLink: EntityLinkRenderer;
}
