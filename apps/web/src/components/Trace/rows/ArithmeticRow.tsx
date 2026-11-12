import type { ArithmeticNode } from '@ringside/engine';
import { arithmeticLine } from '../wording';
import { TraceLineView } from './TraceLineView';
import type { TraceRowProps } from './rowTypes';

/** An add, subtract, multiply, divide or power step: `+6 Main event bonus`, `×1.15 Hot crowd`. */
export function ArithmeticRow({ node }: TraceRowProps<ArithmeticNode>) {
  return <TraceLineView line={arithmeticLine(node)} />;
}
