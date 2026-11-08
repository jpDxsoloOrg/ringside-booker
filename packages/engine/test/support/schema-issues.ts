import type { z } from 'zod';

/** The issues of a failed parse as `path: message` lines, or an empty list when it passed. */
export function parseIssues(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  if (result.success) {
    return [];
  }
  return result.error.issues.map(
    (issue) => `${issue.path.map(String).join('.')}: ${issue.message}`,
  );
}

/** The dotted paths of a failed parse's issues. */
export function issuePaths(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.map(String).join('.'));
}
