/**
 * The trace store: where calculation traces live after the formula that made them returns.
 *
 * Each result a system wants to explain later (a segment rating, an attendance figure, a contract
 * ask) is recorded under a {@link TraceRef}. The newest results of each kind keep their full trace,
 * so the "Why?" panel can open them. Older ones are demoted to a {@link TraceSummary} (label,
 * value, date and the three steps that mattered most), and the oldest summaries are dropped, so a
 * save never fills up with trace trees. Both limits are tunables: `sim.traceRetentionPerKind` and
 * `sim.traceSummaryLimit`.
 *
 * Writes go through a {@link TraceStaging} that belongs to one pipeline step or command. Nothing
 * is visible until the staging commits, so a step that is rolled back leaves no trace of a result
 * that never happened.
 *
 * Ordering uses a store-wide sequence number that is part of the saved state, never wall-clock
 * time or `Map` insertion order, so demotion is the same before and after a save and load.
 *
 * See the "Retention" section of docs/design/calculation-traces.md.
 */

import { z } from 'zod';
import { isGameDate, type GameDate } from '../date';
import {
  InvalidArgumentError,
  InvalidStatePartError,
  SchemaViolationError,
  TraceStoreMisuseError,
} from '../errors';
import { assertJsonValue, formatPath } from '../json';
import type { TunableReader } from '../tunables/resolver';
import type { simTunables } from '../tunables/simTunables';
import { limitTrace } from './limits';
import { traceNodeSchema, traceNumberSchema, traceUnitSchema, traceValueSchema } from './schema';
import type { TraceNode, TraceUnit, Traced, TraceValue } from './types';

/**
 * What a trace explains: a kind of result and the ID of the thing it belongs to, for example
 * `{ kind: 'segment.rating', id: 'seg_...' }`. Retention limits are counted per kind.
 */
export interface TraceRef {
  /** Dot-separated camelCase words, such as `segment.rating` or `contract.ask`. */
  readonly kind: string;
  /** Usually an entity ID; any non-empty text. */
  readonly id: string;
}

/** A trace ref kind: dot-separated camelCase words, such as `segment.rating`. */
export const TRACE_REF_KIND_PATTERN = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)*$/;

/** The map key of a ref: `${kind}:${id}`. Kinds cannot contain `:`, so keys never collide. */
export function refKey(ref: TraceRef): string {
  return `${ref.kind}:${ref.id}`;
}

/** A recent result with its full trace. */
export interface StoredTrace {
  readonly ref: TraceRef;
  /** The game date the result was recorded on. */
  readonly date: GameDate;
  /** Store-wide order: a higher `seq` was committed later. */
  readonly seq: number;
  readonly trace: TraceNode;
  readonly value: TraceNode['value'];
}

/** One of the steps that moved a result the most, for a summary. */
export interface TraceContributor {
  readonly label: string;
  /** How far the step moved the running value: `after - before`. */
  readonly effect: number;
}

/** How many contributors a summary keeps. */
export const TRACE_SUMMARY_CONTRIBUTORS = 3;

/**
 * What is left of an older result once its full trace is dropped: enough for a history screen to
 * say what the number was and what mattered most.
 */
export interface TraceSummary {
  readonly ref: TraceRef;
  readonly date: GameDate;
  /** The `seq` of the full trace this summarises, so summaries keep their order. */
  readonly seq: number;
  /** The root label of the trace, such as "Match rating". */
  readonly label: string;
  readonly value: TraceValue;
  readonly unit?: TraceUnit;
  /** The (up to) three steps with the largest absolute effect, largest first. */
  readonly topContributors: readonly TraceContributor[];
}

/** What {@link TraceStore.get} returns: a full trace for recent results, a summary for older ones. */
export type StoredTraceEntry = StoredTrace | TraceSummary;

/** True when the entry still has its full trace. */
export function isFullTrace(entry: StoredTraceEntry): entry is StoredTrace {
  return 'trace' in entry;
}

/** The limits a store enforces. The engine reads them from the `sim.*` tunables. */
export interface TraceStoreLimits {
  /** Full traces kept per ref kind (`sim.traceRetentionPerKind`). 0 summarises everything at once. */
  readonly retentionPerKind: number;
  /** Summaries kept across all kinds (`sim.traceSummaryLimit`). 0 keeps none. */
  readonly summaryLimit: number;
}

/** Reads the store limits from the engine tunables. */
export function traceStoreLimitsFrom(
  tunables: Pick<TunableReader<typeof simTunables>, 'get'>,
): TraceStoreLimits {
  return {
    retentionPerKind: tunables.get('sim.traceRetentionPerKind'),
    summaryLimit: tunables.get('sim.traceSummaryLimit'),
  };
}

/** The trace store part of a save. Both arrays are sorted by `seq`, oldest first. */
export interface TraceStoreState {
  version: 1;
  /** The last sequence number handed out; the next committed trace gets `seq + 1`. */
  seq: number;
  full: StoredTrace[];
  summaries: TraceSummary[];
}

/** Trace writes made by one step or command, waiting for it to finish. */
export interface TraceStaging {
  /**
   * Stages a result's trace. Recording the same ref again replaces the earlier staged entry. The
   * trace is fitted into the size limits, checked to be plain JSON and validated with the same
   * schema a load uses (which also copies it, so the caller's objects are never frozen).
   */
  record(ref: TraceRef, date: GameDate, traced: Traced<TraceValue>): void;
  /** Adds every staged trace to the store, then applies the retention limits. Closes the staging. */
  commit(): void;
  /** Drops every staged trace without using up any sequence numbers. Closes the staging. */
  discard(): void;
}

interface StagedTraceContent {
  readonly trace: TraceNode;
  readonly value: TraceValue;
}

interface StagedTrace extends StagedTraceContent {
  readonly ref: TraceRef;
  readonly date: GameDate;
}

const stagedTraceContentSchema: z.ZodType<StagedTraceContent> = z.strictObject({
  trace: traceNodeSchema,
  value: traceValueSchema,
});

export class TraceStore {
  #retentionPerKind: number;
  #summaryLimit: number;
  /** The last sequence number handed out. Saved. */
  #seq = 0;
  /**
   * Full traces per ref kind, by ref key. Each inner map is kept in `seq` order: an entry is always
   * deleted before it is set again, and every new entry has the highest `seq` so far.
   */
  readonly #fullByKind = new Map<string, Map<string, StoredTrace>>();
  /** Summaries by ref key. */
  readonly #summaries = new Map<string, TraceSummary>();
  /** The same summaries sorted by `seq`, oldest first, so the oldest can be dropped cheaply. */
  #summaryOrder: TraceSummary[] = [];

  /** Creates an empty store. */
  constructor(limits: TraceStoreLimits) {
    const checked = checkLimits('TraceStore', limits);
    this.#retentionPerKind = checked.retentionPerKind;
    this.#summaryLimit = checked.summaryLimit;
  }

  /**
   * Loads a store from a saved state (validated with {@link traceStoreStateSchema}; throws
   * {@link InvalidStatePartError} naming every bad field). The limits are applied straight away,
   * so a save made with higher limits is trimmed the same way a commit would trim it.
   */
  static fromState(state: unknown, limits: TraceStoreLimits): TraceStore {
    const valid = parseTraceStoreState(state);
    const store = new TraceStore(limits);
    store.#seq = valid.seq;
    for (const entry of valid.full) {
      store.#kindMap(entry.ref.kind).set(refKey(entry.ref), deepFreeze(entry));
    }
    for (const summary of valid.summaries) {
      const frozen = deepFreeze(summary);
      store.#summaries.set(refKey(summary.ref), frozen);
      store.#summaryOrder.push(frozen);
    }
    store.#enforceLimits(store.#fullByKind.keys());
    return store;
  }

  /** The last sequence number handed out (0 before the first commit). */
  get seq(): number {
    return this.#seq;
  }

  /** The limits this store enforces. */
  get limits(): TraceStoreLimits {
    return { retentionPerKind: this.#retentionPerKind, summaryLimit: this.#summaryLimit };
  }

  /** Changes the limits (after a tunable change) and applies them straight away. */
  setLimits(limits: TraceStoreLimits): void {
    const checked = checkLimits('TraceStore.setLimits', limits);
    this.#retentionPerKind = checked.retentionPerKind;
    this.#summaryLimit = checked.summaryLimit;
    this.#enforceLimits(this.#fullByKind.keys());
  }

  /** The full trace of a recent result, the summary of an older one, or undefined. */
  get(ref: TraceRef): StoredTraceEntry | undefined {
    const key = refKey(ref);
    return this.#fullByKind.get(ref.kind)?.get(key) ?? this.#summaries.get(key);
  }

  /** True when the store holds a full trace or a summary for this ref. */
  has(ref: TraceRef): boolean {
    return this.get(ref) !== undefined;
  }

  /**
   * The entries of one kind, newest first: full traces, then summaries. With `limit`, at most that
   * many. Within a kind every summary is older than every full trace, because demotion always
   * takes the oldest.
   */
  listByKind(kind: string, limit?: number): StoredTraceEntry[] {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
      throw new InvalidArgumentError(
        'TraceStore.listByKind',
        'limit',
        limit,
        'a whole number of 0 or more',
      );
    }
    const wanted = limit ?? Number.POSITIVE_INFINITY;
    const entries: StoredTraceEntry[] = [];
    const full = [...(this.#fullByKind.get(kind)?.values() ?? [])];
    for (let i = full.length - 1; i >= 0 && entries.length < wanted; i--) {
      const entry = full[i];
      if (entry !== undefined) {
        entries.push(entry);
      }
    }
    for (let i = this.#summaryOrder.length - 1; i >= 0 && entries.length < wanted; i--) {
      const summary = this.#summaryOrder[i];
      if (summary?.ref.kind === kind) {
        entries.push(summary);
      }
    }
    return entries;
  }

  /** Opens a staging for one step or command. */
  stage(): TraceStaging {
    let staged = new Map<string, StagedTrace>();
    let closedBy: 'commit' | 'discard' | null = null;

    const assertOpen = (action: string): void => {
      if (closedBy !== null) {
        throw new TraceStoreMisuseError(
          `cannot ${action}: this trace staging was already closed by ${closedBy}()`,
        );
      }
    };

    return {
      record: (ref, date, traced) => {
        assertOpen('record a trace');
        checkRef(ref);
        if (!isGameDate(date)) {
          throw new InvalidArgumentError(
            'TraceStaging.record',
            'date',
            date,
            'a game date (YYYY-MM-DD)',
          );
        }
        const key = refKey(ref);
        const { trace, value } = checkRecordedTrace(key, traced);
        // Deleted first, so a re-recorded ref takes the position of its latest record.
        staged.delete(key);
        staged.set(key, { ref: { kind: ref.kind, id: ref.id }, date, trace, value });
      },
      commit: () => {
        assertOpen('commit');
        closedBy = 'commit';
        const entries = [...staged.values()];
        staged = new Map();
        this.#commit(entries);
      },
      discard: () => {
        assertOpen('discard');
        closedBy = 'discard';
        staged = new Map();
      },
    };
  }

  /** The store's save state. Entries are plain JSON, so this is safe to serialise. */
  toState(): TraceStoreState {
    const full = [...this.#fullByKind.values()]
      .flatMap((byKey) => [...byKey.values()])
      .sort((left, right) => left.seq - right.seq);
    return { version: 1, seq: this.#seq, full, summaries: [...this.#summaryOrder] };
  }

  #kindMap(kind: string): Map<string, StoredTrace> {
    let byKey = this.#fullByKind.get(kind);
    if (byKey === undefined) {
      byKey = new Map();
      this.#fullByKind.set(kind, byKey);
    }
    return byKey;
  }

  #commit(entries: readonly StagedTrace[]): void {
    const touchedKinds = new Set<string>();
    for (const entry of entries) {
      this.#seq += 1;
      const key = refKey(entry.ref);
      this.#removeSummary(key);
      const byKey = this.#kindMap(entry.ref.kind);
      byKey.delete(key);
      byKey.set(key, deepFreeze({ ...entry, seq: this.#seq }));
      touchedKinds.add(entry.ref.kind);
    }
    this.#enforceLimits(touchedKinds);
  }

  /** Demotes the oldest full traces of each kind beyond retention, then drops the oldest summaries. */
  #enforceLimits(kinds: Iterable<string>): void {
    for (const kind of [...kinds]) {
      const byKey = this.#fullByKind.get(kind);
      if (byKey === undefined) {
        continue;
      }
      let excess = byKey.size - this.#retentionPerKind;
      for (const [key, entry] of byKey) {
        if (excess <= 0) {
          break;
        }
        byKey.delete(key);
        this.#addSummary(key, summariseTrace(entry));
        excess -= 1;
      }
      if (byKey.size === 0) {
        this.#fullByKind.delete(kind);
      }
    }
    const overflow = this.#summaryOrder.length - this.#summaryLimit;
    if (overflow > 0) {
      for (const dropped of this.#summaryOrder.splice(0, overflow)) {
        this.#summaries.delete(refKey(dropped.ref));
      }
    }
  }

  #addSummary(key: string, summary: TraceSummary): void {
    this.#summaries.set(key, summary);
    this.#summaryOrder.splice(insertionIndex(this.#summaryOrder, summary.seq), 0, summary);
  }

  #removeSummary(key: string): void {
    const summary = this.#summaries.get(key);
    if (summary === undefined) {
      return;
    }
    this.#summaries.delete(key);
    const index = insertionIndex(this.#summaryOrder, summary.seq) - 1;
    if (this.#summaryOrder[index] === summary) {
      this.#summaryOrder.splice(index, 1);
    }
  }
}

/**
 * The step's effect on the running value, or null for a node that did not change it: `after -
 * before` for an arithmetic step, and for a limit (`min`, `max`, `clamp`) that applied.
 */
function effectOf(node: TraceNode): number | null {
  switch (node.kind) {
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
    case 'power':
      return stepEffect(node.before, node.after);
    case 'min':
    case 'max':
    case 'clamp':
      return node.applied ? stepEffect(node.before, node.after) : null;
    case 'formula':
    case 'input':
    case 'constant':
    case 'tunable':
    case 'round':
    case 'roll':
    case 'branch':
    case 'decision':
    case 'note':
      return null;
  }
}

/**
 * `after - before`, held to the largest finite number either way: two finite values far apart can
 * differ by more than a number can hold, and an infinite effect would not survive a save.
 */
function stepEffect(before: number, after: number): number {
  return Math.min(Number.MAX_VALUE, Math.max(-Number.MAX_VALUE, after - before));
}

/**
 * The trace and value of a recorded result, ready to store: fitted into the size limits, checked to
 * be plain JSON (naming the bad path) and validated with the schema a load uses, so whatever is
 * committed can be saved and loaded again. The parsed copy is what gets stored (and frozen).
 */
function checkRecordedTrace(key: string, traced: Traced<TraceValue>): StagedTraceContent {
  const trace = limitTrace(traced.trace);
  assertJsonValue(trace, `traces["${key}"].trace`);
  assertJsonValue(traced.value, `traces["${key}"].value`);
  const result = stagedTraceContentSchema.safeParse({ trace, value: traced.value });
  if (!result.success) {
    throw new SchemaViolationError(
      `traces["${key}"]`,
      result.error.issues.map((issue) => ({
        path: formatPath('$', issue.path),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

/**
 * The steps of a trace that moved its value the most: the root's direct children with the largest
 * absolute effect, largest first, at most {@link TRACE_SUMMARY_CONTRIBUTORS}. Steps with no
 * effect are left out; ties keep trace order.
 */
export function topContributors(trace: TraceNode): TraceContributor[] {
  const candidates: { label: string; effect: number; index: number }[] = [];
  for (const [index, child] of (trace.children ?? []).entries()) {
    const effect = effectOf(child);
    if (effect !== null && effect !== 0) {
      candidates.push({ label: child.label, effect, index });
    }
  }
  return candidates
    .sort(
      (left, right) => Math.abs(right.effect) - Math.abs(left.effect) || left.index - right.index,
    )
    .slice(0, TRACE_SUMMARY_CONTRIBUTORS)
    .map(({ label, effect }) => ({ label, effect }));
}

/** The summary a full trace is demoted to. */
export function summariseTrace(entry: StoredTrace): TraceSummary {
  const summary: TraceSummary = {
    ref: entry.ref,
    date: entry.date,
    seq: entry.seq,
    label: entry.trace.label,
    value: entry.value,
    topContributors: topContributors(entry.trace),
  };
  return deepFreeze(
    entry.trace.unit === undefined ? summary : { ...summary, unit: entry.trace.unit },
  );
}

/** Where an entry with `seq` goes in a list sorted by `seq`: after every lower or equal seq. */
function insertionIndex(sorted: readonly { readonly seq: number }[], seq: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const middleSeq = sorted[middle]?.seq ?? Number.POSITIVE_INFINITY;
    if (middleSeq <= seq) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function checkLimits(functionName: string, limits: TraceStoreLimits): TraceStoreLimits {
  for (const name of ['retentionPerKind', 'summaryLimit'] as const) {
    const value = limits[name];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new InvalidArgumentError(
        functionName,
        `limits.${name}`,
        value,
        'a whole number of 0 or more',
      );
    }
  }
  return { retentionPerKind: limits.retentionPerKind, summaryLimit: limits.summaryLimit };
}

function checkRef(ref: TraceRef): void {
  if (!TRACE_REF_KIND_PATTERN.test(ref.kind)) {
    throw new InvalidArgumentError(
      'TraceStaging.record',
      'ref.kind',
      ref.kind,
      'a trace kind such as "segment.rating"',
    );
  }
  if (ref.id === '') {
    throw new InvalidArgumentError('TraceStaging.record', 'ref.id', ref.id, 'a non-empty id');
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze(Object.getOwnPropertyDescriptor(value, key)?.value as unknown);
    }
  }
  return value;
}

// ---------------------------------------------------------------------------------------------
// Saved state
// ---------------------------------------------------------------------------------------------

// Core does not import from model/, so the game date check is spelled out here.
const gameDateSchema = z.custom<GameDate>(isGameDate, {
  error: 'must be a game date in the form YYYY-MM-DD',
});

const traceRefSchema: z.ZodType<TraceRef> = z.strictObject({
  kind: z
    .string()
    .regex(TRACE_REF_KIND_PATTERN, { error: 'must be a trace kind such as "segment.rating"' }),
  id: z.string().min(1, { error: 'must not be empty' }),
});

const seqSchema = z.number().int().min(1);

const storedTraceSchema = z.strictObject({
  ref: traceRefSchema,
  date: gameDateSchema,
  seq: seqSchema,
  trace: traceNodeSchema,
  value: traceValueSchema,
});

const traceSummarySchema = z.strictObject({
  ref: traceRefSchema,
  date: gameDateSchema,
  seq: seqSchema,
  label: z.string(),
  value: traceValueSchema,
  unit: traceUnitSchema.exactOptional(),
  topContributors: z
    .array(z.strictObject({ label: z.string(), effect: traceNumberSchema }))
    .max(TRACE_SUMMARY_CONTRIBUTORS, {
      error: `a summary keeps at most ${String(TRACE_SUMMARY_CONTRIBUTORS)} contributors`,
    }),
});

/** Adds an issue for every entry whose `seq` is not above the one before it or above the store seq. */
function checkSeqOrder(
  entries: readonly { readonly seq: number }[],
  field: 'full' | 'summaries',
  storeSeq: number,
  ctx: z.RefinementCtx,
): void {
  let previousSeq = 0;
  entries.forEach((entry, index) => {
    if (entry.seq <= previousSeq) {
      ctx.addIssue({
        code: 'custom',
        message: 'seq must be greater than the previous entry seq',
        path: [field, index, 'seq'],
      });
    }
    if (entry.seq > storeSeq) {
      ctx.addIssue({
        code: 'custom',
        message: `seq must not be greater than the store seq (${String(storeSeq)})`,
        path: [field, index, 'seq'],
      });
    }
    previousSeq = entry.seq;
  });
}

/**
 * Zod schema for {@link TraceStoreState}. Every trace is checked with {@link traceNodeSchema}
 * (node kinds, fields and the size limits). Each array must be sorted by `seq`, no `seq` may be
 * above the store's, and a ref may appear only once across both arrays.
 */
export const traceStoreStateSchema: z.ZodType<TraceStoreState> = z
  .strictObject({
    version: z.literal(1, { error: 'unsupported trace store state version (expected 1)' }),
    seq: z.number().int().min(0),
    full: z.array(storedTraceSchema),
    summaries: z.array(traceSummarySchema),
  })
  .superRefine((state, ctx) => {
    checkSeqOrder(state.full, 'full', state.seq, ctx);
    checkSeqOrder(state.summaries, 'summaries', state.seq, ctx);
    const seenRefs = new Set<string>();
    const seenSeqs = new Set<number>();
    for (const field of ['full', 'summaries'] as const) {
      state[field].forEach((entry, index) => {
        const key = refKey(entry.ref);
        if (seenRefs.has(key)) {
          ctx.addIssue({
            code: 'custom',
            message: `ref "${key}" is stored more than once`,
            path: [field, index, 'ref'],
          });
        }
        if (seenSeqs.has(entry.seq)) {
          ctx.addIssue({
            code: 'custom',
            message: `seq ${String(entry.seq)} is used more than once`,
            path: [field, index, 'seq'],
          });
        }
        seenRefs.add(key);
        seenSeqs.add(entry.seq);
      });
    }
  });

/**
 * Validates an unknown value (for example straight from `JSON.parse`) as a {@link TraceStoreState}.
 * Throws {@link InvalidStatePartError} naming every bad field.
 */
export function parseTraceStoreState(input: unknown): TraceStoreState {
  const result = traceStoreStateSchema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  throw new InvalidStatePartError(
    'trace store',
    result.error.issues.map((issue) => `${formatPath('$', issue.path)}: ${issue.message}`),
  );
}
