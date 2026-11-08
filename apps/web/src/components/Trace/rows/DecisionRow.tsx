import type { DecisionNode } from '@ringside/engine';
import styles from '../Trace.module.css';
import { decisionLine } from '../wording';
import { TraceLineView } from './TraceLineView';
import type { TraceRowProps } from './rowTypes';

/** A choice: the option taken and why, then every option weighed with its score, chosen first. */
export function DecisionRow({ node }: TraceRowProps<DecisionNode>) {
  const line = decisionLine(node);
  return (
    <>
      <TraceLineView line={line} />
      <ul className={styles['options']}>
        {line.items.map((item) => (
          <li key={item} className={styles['option']}>
            {item}
          </li>
        ))}
      </ul>
    </>
  );
}
