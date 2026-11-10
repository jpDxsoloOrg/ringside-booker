/**
 * A breakdown as indented plain text, for bug reports: two spaces per level and one line per row,
 * in the same words the panel shows. Checks that changed nothing are included, since a report
 * should hold everything.
 */
import type { TraceNode, TraceSummary } from '@ringside/engine';
import { formatGameDate } from '../format';
import { formatTraceDelta, formatTraceValue } from './formatTraceValue';
import { describeTraceNode, traceLineText, traceValueText } from './wording';

const INDENT = '  ';

/** The notice shown in place of a breakdown that has been summarised. */
export const SUMMARISED_NOTICE = 'Full breakdown is only kept for recent results';

/** The big line at the top of the panel: what the number is and its value. */
export function traceHeadline(root: TraceNode): string {
  return `${root.label}: ${traceValueText(root)}`;
}

/**
 * The rows under the headline. A formula's steps are its children; any other root (a decision,
 * say) is a row of its own, so its details are not lost.
 */
export function traceTopLevelNodes(root: TraceNode): readonly TraceNode[] {
  return root.kind === 'formula' ? root.children : [root];
}

function appendNode(lines: string[], node: TraceNode, level: number): void {
  const line = describeTraceNode(node);
  lines.push(`${INDENT.repeat(level)}${traceLineText(line)}`);
  for (const item of line.items) {
    lines.push(`${INDENT.repeat(level + 1)}${item}`);
  }
  for (const child of node.children ?? []) {
    appendNode(lines, child, level + 1);
  }
}

/** The whole trace as text: the headline, then every row indented under its parent. */
export function traceToText(root: TraceNode): string {
  const lines = [traceHeadline(root)];
  for (const node of traceTopLevelNodes(root)) {
    appendNode(lines, node, 1);
  }
  return lines.join('\n');
}

/** One of a summary's top contributors: `−2,100 Promotion popularity`. */
export function contributorText(
  contributor: TraceSummary['topContributors'][number],
  unit: TraceSummary['unit'],
): string {
  return `${formatTraceDelta(contributor.effect, unit)} ${contributor.label}`;
}

/** The headline of a summarised result. */
export function summaryHeadline(summary: TraceSummary): string {
  return `${summary.label}: ${formatTraceValue(summary.value, summary.unit)}`;
}

/** The date line of a summarised result. */
export function summaryDateText(summary: TraceSummary): string {
  return `Recorded ${formatGameDate(summary.date)}`;
}

/** A summarised result as text: headline, the notice, the date and what moved it most. */
export function summaryToText(summary: TraceSummary): string {
  const lines = [summaryHeadline(summary), `${INDENT}${SUMMARISED_NOTICE}`];
  lines.push(`${INDENT}${summaryDateText(summary)}`);
  for (const contributor of summary.topContributors) {
    lines.push(`${INDENT}${contributorText(contributor, summary.unit)}`);
  }
  return lines.join('\n');
}
