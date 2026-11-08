import type { NoteNode } from '@ringside/engine';
import { noteLine } from '../wording';
import { TraceLineView } from './TraceLineView';
import type { TraceRowProps } from './rowTypes';

/** Plain text. */
export function NoteRow({ node }: TraceRowProps<NoteNode>) {
  return <TraceLineView line={noteLine(node)} />;
}
