import type { FormulaNode } from '@ringside/engine';
import styles from '../Trace.module.css';
import { formulaLine } from '../wording';
import { TraceLineView } from './TraceLineView';
import type { TraceRowProps } from './rowTypes';

/** A calculation inside the calculation: its label and result. The tree makes it collapsible. */
export function FormulaRow({ node }: TraceRowProps<FormulaNode>) {
  return <TraceLineView line={formulaLine(node)} textClassName={styles['formulaText']} />;
}
