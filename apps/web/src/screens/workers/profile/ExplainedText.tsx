import type { TraceNode } from '@ringside/engine';
import { classNames } from '@/components/classNames';
import { WhyButton } from '@/components/Trace';
import styles from './WorkerProfile.module.css';

export interface ExplainedTextProps {
  /** What the answer is: names the Why? button and heads the panel ("Weight class"). */
  readonly label: string;
  /** The answer as the screen words it ("Light heavyweight", "72"). */
  readonly text: string;
  /** How the answer was reached. */
  readonly trace: TraceNode;
  readonly className?: string | undefined;
}

/**
 * A derived answer shown in the screen's own words with its Why? button beside it. `Explained`
 * formats a raw value; this is for answers the profile words itself, such as a weight class by
 * its label or a rating rounded to the whole number the grade is read from.
 */
export function ExplainedText({ label, text, trace, className }: ExplainedTextProps) {
  return (
    <span className={classNames(styles['explainedText'], className)}>
      <span className="tabular">{text}</span>
      <WhyButton label={label} value={text} source={{ trace }} />
    </span>
  );
}
