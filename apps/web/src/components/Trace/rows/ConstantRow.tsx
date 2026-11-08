import type { ConstantNode } from '@ringside/engine';
import { constantLine } from '../wording';
import { TraceLineView } from './TraceLineView';
import type { TraceRowProps } from './rowTypes';

/** A fixed number with the reason it is fixed. */
export function ConstantRow({ node }: TraceRowProps<ConstantNode>) {
  return <TraceLineView line={constantLine(node)} />;
}
