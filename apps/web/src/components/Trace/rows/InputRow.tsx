import type { InputNode } from '@ringside/engine';
import { formatTraceValue } from '../formatTraceValue';
import { inputLine } from '../wording';
import { TraceLineView } from './TraceLineView';
import type { TraceRowProps } from './rowTypes';

/** A named input, `label: value`. An input that points at an entity links its label there. */
export function InputRow({ node, renderEntityLink }: TraceRowProps<InputNode>) {
  const line = inputLine(node);
  if (node.ref === undefined) return <TraceLineView line={line} />;
  return (
    <TraceLineView
      line={line}
      text={
        <>
          {renderEntityLink(node.ref, node.label)}: {formatTraceValue(node.value, node.unit)}
        </>
      }
    />
  );
}
