import type { TunableNode } from '@ringside/engine';
import { tunableLine } from '../wording';
import { TraceLineView } from './TraceLineView';
import type { TraceRowProps } from './rowTypes';

/**
 * A balance setting and its value. When the save changes it, a "Custom setting" badge and the
 * default show beside it.
 */
export function TunableRow({ node }: TraceRowProps<TunableNode>) {
  return <TraceLineView line={tunableLine(node)} />;
}
