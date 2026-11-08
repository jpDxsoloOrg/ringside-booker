import type { BranchNode } from '@ringside/engine';
import { branchLine } from '../wording';
import { TraceLineView } from './TraceLineView';
import type { TraceRowProps } from './rowTypes';

/** A condition that was checked: `Because <condition>`. Branches not taken are hidden until asked. */
export function BranchRow({ node }: TraceRowProps<BranchNode>) {
  return <TraceLineView line={branchLine(node)} />;
}
