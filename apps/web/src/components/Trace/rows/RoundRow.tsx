import type { RoundNode } from '@ringside/engine';
import { roundLine } from '../wording';
import { TraceLineView } from './TraceLineView';
import type { TraceRowProps } from './rowTypes';

/** A rounding step: `Rounded down 37.6 → 37`. */
export function RoundRow({ node }: TraceRowProps<RoundNode>) {
  return <TraceLineView line={roundLine(node)} />;
}
