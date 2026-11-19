/**
 * The conversion report: what was read, what was imported, what was skipped and why. Warnings are
 * grouped by code, each with a count and a few example source ids (never names), so a report for
 * a mod with thousands of records stays short and can be logged without copying the mod's content.
 */

/** How many example ids a warning group keeps. */
const MAX_EXAMPLES = 5;

export interface ConversionWarning {
  readonly code: string;
  readonly message: string;
  readonly count: number;
  /** Source table and id of the first few records it applies to, such as `workers#118`. */
  readonly examples: readonly string[];
}

interface WarningGroup {
  message: string;
  count: number;
  examples: string[];
}

export class ReportBuilder {
  private readonly groups = new Map<string, WarningGroup>();
  readonly errors: string[] = [];
  readonly notImported: string[] = [];

  /** Adds one occurrence of warning `code`; `message` is kept from the first occurrence. */
  warn(code: string, message: string, example?: string): void {
    let group = this.groups.get(code);
    if (group === undefined) {
      group = { message, count: 0, examples: [] };
      this.groups.set(code, group);
    }
    group.count += 1;
    if (example !== undefined && group.examples.length < MAX_EXAMPLES) group.examples.push(example);
  }

  error(message: string): void {
    this.errors.push(message);
  }

  notImportedField(description: string): void {
    if (!this.notImported.includes(description)) this.notImported.push(description);
  }

  warnings(): ConversionWarning[] {
    return [...this.groups.entries()].map(([code, group]) => ({
      code,
      message: group.message,
      count: group.count,
      examples: group.examples,
    }));
  }
}

/** Counts by kind. */
export type Counts = Record<string, number>;
