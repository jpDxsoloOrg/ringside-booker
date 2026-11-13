/**
 * Where a save's bytes go (POL4-06): the canonical JSON size of a save document split by world
 * table, by trace kind (full traces and summaries apart) and by simulation part, plus the gzipped
 * size `encodeSave` writes to IndexedDB and `.rbsave` files.
 *
 * Used by the year-long save budget test (`test/persistence/yearSaveBudget.test.ts`) and handy in
 * any test that wants to see why a save grew: `console.log(formatSaveSizeReport(report))`.
 */

import { serialiseSaveDocument, encodeSave } from '../../src/persistence/codec';
import type { SaveDocument } from '../../src/persistence/save-document';

/** Bytes and entries of one part of a save. */
export interface SizeLine {
  readonly name: string;
  readonly bytes: number;
  readonly count: number;
}

export interface SaveSizeReport {
  /** The canonical JSON, in UTF-8 bytes. */
  readonly jsonBytes: number;
  /** What `encodeSave` writes: the gzipped JSON. */
  readonly gzipBytes: number;
  /** Each world table, largest first. */
  readonly tables: readonly SizeLine[];
  /** Each trace kind's full traces, largest first. */
  readonly fullTraces: readonly SizeLine[];
  /** Each trace kind's summaries, largest first. */
  readonly traceSummaries: readonly SizeLine[];
  /** The simulation parts other than traces (rng, events, ...), and the world metadata. */
  readonly parts: readonly SizeLine[];
}

const encoder = new TextEncoder();

function byteLength(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

function largestFirst(lines: Map<string, { bytes: number; count: number }>): SizeLine[] {
  return [...lines.entries()]
    .map(([name, line]) => ({ name, bytes: line.bytes, count: line.count }))
    .sort((left, right) => right.bytes - left.bytes || left.name.localeCompare(right.name));
}

function add(
  lines: Map<string, { bytes: number; count: number }>,
  name: string,
  bytes: number,
): void {
  const line = lines.get(name) ?? { bytes: 0, count: 0 };
  line.bytes += bytes;
  line.count += 1;
  lines.set(name, line);
}

interface TraceEntryLike {
  readonly ref: { readonly kind: string };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTraceEntryLike(value: unknown): value is TraceEntryLike {
  return isRecord(value) && isRecord(value['ref']) && typeof value['ref']['kind'] === 'string';
}

function traceEntries(traces: unknown, field: 'full' | 'summaries'): TraceEntryLike[] {
  const entries: unknown = isRecord(traces) ? traces[field] : undefined;
  return Array.isArray(entries) ? entries.filter(isTraceEntryLike) : [];
}

/** Measures a save document. */
export async function saveSizeReport(doc: SaveDocument): Promise<SaveSizeReport> {
  const json = encoder.encode(serialiseSaveDocument(doc));
  const gzipped = await encodeSave(doc);

  const tables = new Map<string, { bytes: number; count: number }>();
  for (const [name, rows] of Object.entries(doc.state.world.tables)) {
    tables.set(name, { bytes: byteLength(rows), count: rows.length });
  }

  const fullTraces = new Map<string, { bytes: number; count: number }>();
  for (const entry of traceEntries(doc.state.traces, 'full')) {
    add(fullTraces, entry.ref.kind, byteLength(entry));
  }
  const summaries = new Map<string, { bytes: number; count: number }>();
  for (const entry of traceEntries(doc.state.traces, 'summaries')) {
    add(summaries, entry.ref.kind, byteLength(entry));
  }

  const parts = new Map<string, { bytes: number; count: number }>();
  parts.set('world.meta', { bytes: byteLength(doc.state.world.meta), count: 1 });
  for (const part of ['rng', 'tunableOverrides', 'events', 'failureLog', 'commandLog'] as const) {
    const value = doc.state[part];
    parts.set(part, { bytes: byteLength(value), count: Array.isArray(value) ? value.length : 1 });
  }

  return {
    jsonBytes: json.length,
    gzipBytes: gzipped.length,
    tables: largestFirst(tables),
    fullTraces: largestFirst(fullTraces),
    traceSummaries: largestFirst(summaries),
    parts: largestFirst(parts),
  };
}

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

function kilobytes(bytes: number): string {
  return `${(bytes / 1_000).toFixed(1)} KB`;
}

function section(title: string, lines: readonly SizeLine[], top: number): string[] {
  const total = lines.reduce((sum, line) => sum + line.bytes, 0);
  const shown = lines.slice(0, top).filter((line) => line.bytes > 0);
  return [
    `${title}: ${megabytes(total)}`,
    ...shown.map(
      (line) =>
        `  ${line.name.padEnd(36)} ${kilobytes(line.bytes).padStart(10)}  ${String(line.count).padStart(6)} x`,
    ),
  ];
}

/** The report as text: totals, then the largest lines of each section. */
export function formatSaveSizeReport(report: SaveSizeReport, top = 15): string {
  return [
    `save: ${megabytes(report.jsonBytes)} JSON, ${megabytes(report.gzipBytes)} gzipped`,
    ...section('tables', report.tables, top),
    ...section('full traces', report.fullTraces, top),
    ...section('trace summaries', report.traceSummaries, top),
    ...section('other parts', report.parts, top),
  ].join('\n');
}
