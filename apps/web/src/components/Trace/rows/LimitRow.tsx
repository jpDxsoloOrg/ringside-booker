import type { ClampNode, LimitNode } from '@ringside/engine';
import { limitLine } from '../wording';
import { TraceLineView } from './TraceLineView';
import type { TraceRowProps } from './rowTypes';

/**
 * A clamp, ceiling or floor: `Capped 112 → 100 (maximum)` when it changed the value. One that
 * changed nothing says what it was checked against; the tree hides those until asked.
 */
export function LimitRow({ node }: TraceRowProps<LimitNode | ClampNode>) {
  return <TraceLineView line={limitLine(node)} />;
}
