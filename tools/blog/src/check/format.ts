import type { CheckIssue } from './types';

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/** `N errors, M warnings` for a list of issues. */
export function summarizeIssues(issues: readonly CheckIssue[]): string {
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  return `${plural(errors, 'error')}, ${plural(issues.length - errors, 'warning')}`;
}

/**
 * The checker's report: one line per issue as `path:line  severity  rule  message`, a blank line
 * between files, then the summary line. Issues keep their order, so pass them sorted.
 */
export function formatReport(issues: readonly CheckIssue[]): string {
  const lines: string[] = [];
  let currentFile: string | null = null;
  for (const issue of issues) {
    if (currentFile !== null && issue.file !== currentFile) {
      lines.push('');
    }
    currentFile = issue.file;
    const location = issue.line === undefined ? issue.file : `${issue.file}:${String(issue.line)}`;
    lines.push(`${location}  ${issue.severity}  ${issue.rule}  ${issue.message}`);
  }
  if (lines.length > 0) {
    lines.push('');
  }
  lines.push(summarizeIssues(issues));
  return `${lines.join('\n')}\n`;
}
