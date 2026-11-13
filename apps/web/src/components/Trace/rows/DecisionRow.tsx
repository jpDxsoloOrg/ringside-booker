import type { DecisionNode } from '@ringside/engine';
import styles from '../Trace.module.css';
import { decisionLine } from '../wording';
import { TraceLineView } from './TraceLineView';
import type { TraceRowProps } from './rowTypes';

/**
 * A choice: the option taken and why, then every option weighed with its score, chosen first. The
 * options are plain lines, not a list: they sit inside the row's label, and a list there drops
 * out of the tree item's computed name (axe's label in name, WCAG 2.5.3).
 */
export function DecisionRow({ node }: TraceRowProps<DecisionNode>) {
  const line = decisionLine(node);
  return (
    <>
      <TraceLineView line={line} />
      <span className={styles['options']} data-part="options">
        {line.items.map((item) => (
          <span key={item} className={styles['option']} data-part="option">
            {item}
          </span>
        ))}
      </span>
    </>
  );
}
