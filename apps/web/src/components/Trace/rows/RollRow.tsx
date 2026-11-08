import type { RollNode } from '@ringside/engine';
import { rollLine } from '../wording';
import { TraceLineView } from './TraceLineView';
import type { TraceRowProps } from './rowTypes';

/**
 * A random roll with its exact range or odds and what came up, and the random stream it drew
 * from in muted text: `Rolled 37 on 0–100 (both ends possible)`.
 */
export function RollRow({ node }: TraceRowProps<RollNode>) {
  return <TraceLineView line={rollLine(node)} />;
}
