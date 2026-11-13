/**
 * The preview extension seam (MTCH4-05): another feature adds its own numbers to the Match lab's
 * previews without a query of its own, so the lab still makes one engine round-trip per Run.
 *
 * An extension registers `{ id, args, run, summarise }`. A caller asks for it by id in the
 * preview arguments' optional `extensions` field (`match.preview`, `match.previewBatch`,
 * `match.simulate` and `match.simulateBatch` all take it); each extension's arguments are checked
 * with its own schema, and an unknown id is refused as `invalidArgs`. A single preview returns
 * `extensions: { [id]: run(...) }`; a batch runs every extension on every run and returns
 * `extensionSummaries: { [id]: summarise(values) }`.
 *
 * Like the rest of a preview, an extension never writes and never draws from the world's RNG:
 * `ctx.rng(streamName)` is `detachedStream(meta.seed, streamName, String(previewSeed + runIndex))`,
 * so the same seed always gives the same numbers, and run 0 of a batch is the single preview with
 * the same seed.
 *
 * Typing: an extension declares its shapes on {@link PreviewExtensionMap} by declaration merging,
 * so `result.extensions?.physical` is typed for the web.
 *
 * Design: docs/design/match-rating.md#preview-extensions.
 */

import { z } from 'zod';
import type { QueryContext } from '../../core/api/query';
import { INVALID_ARGS, refuseQuery, type Reason } from '../../core/api/result';
import { RegistryError } from '../../core/errors';
import type { PromotionId } from '../../core/ids';
import { detachedStream, type RngStream } from '../../core/rng/registry';
import type { StreamName } from '../../core/rng/streams';
import type { MatchOutcome } from '../../model/entities/segment';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';
import type { PreviewArgs } from './previewArgs';

/**
 * Every extension's argument, single-run result and batch summary types, by id. Extensions add
 * their entry with `declare module`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled by declaration merging
export interface PreviewExtensionMap {}

/** The id of a registered extension. */
export type PreviewExtensionId = Extract<keyof PreviewExtensionMap, string>;

type ArgsOf<K extends PreviewExtensionId> = PreviewExtensionMap[K] extends { args: infer A }
  ? A
  : never;
type ResultOf<K extends PreviewExtensionId> = PreviewExtensionMap[K] extends { result: infer R }
  ? R
  : never;
type SummaryOf<K extends PreviewExtensionId> = PreviewExtensionMap[K] extends {
  summary: infer S;
}
  ? S
  : never;

/** The `extensions` field of the preview arguments: each asked-for extension's arguments. */
export type PreviewExtensionArgs = { [K in PreviewExtensionId]?: ArgsOf<K> };

/** A single preview's `extensions`: each asked-for extension's result. */
export type PreviewExtensionResults = { [K in PreviewExtensionId]?: ResultOf<K> };

/** A batch's `extensionSummaries`: each asked-for extension's summary over every run. */
export type PreviewExtensionSummaries = { [K in PreviewExtensionId]?: SummaryOf<K> };

/** What one extension run sees. */
export interface PreviewExtensionContext {
  readonly read: GameWorldView;
  readonly tunables: EngineTunables;
  readonly query: QueryContext;
  /** The lab draft as the caller sent it. */
  readonly draft: PreviewArgs;
  /** The promotion running the show (`labPromotionOf`). */
  readonly promotionId: PromotionId;
  /** The simulated outcome; null for `match.preview` / `match.previewBatch`. */
  readonly outcome: MatchOutcome | null;
  /** 0 for a single preview; run `i` of a batch. */
  readonly runIndex: number;
  /** True inside a batch: only the summary survives, so a run may skip traces nobody reads. */
  readonly batch: boolean;
  /** A detached stream keyed by this run's seed. Same seed, same numbers. */
  readonly rng: (streamName: StreamName) => RngStream;
}

/** One extension. */
export interface PreviewExtensionDefinition<K extends PreviewExtensionId = PreviewExtensionId> {
  readonly id: K;
  /** Checks the extension's own arguments; its messages reach the player as refusal reasons. */
  readonly args: z.ZodType<ArgsOf<K>>;
  readonly run: (ctx: PreviewExtensionContext, args: ArgsOf<K>) => ResultOf<K>;
  readonly summarise: (values: readonly ResultOf<K>[]) => SummaryOf<K>;
}

/** Extension ids are one lower camel word: `physical`. */
const EXTENSION_ID_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

/** One run of a checked extension, keeping its own values typed inside the closure. */
interface ExtensionRunner {
  readonly id: string;
  /** Runs once and keeps the value for the summary. */
  readonly add: (ctx: PreviewExtensionContext) => void;
  /** Runs once and returns the value (a single preview). */
  readonly single: (ctx: PreviewExtensionContext) => unknown;
  /** The summary of every value added. */
  readonly summary: () => unknown;
}

/** Checks one extension's arguments: a runner, or the schema's issues. */
interface StoredExtension {
  readonly id: string;
  readonly prepare: (
    raw: unknown,
  ) =>
    | { readonly ok: true; readonly runner: ExtensionRunner }
    | { readonly ok: false; readonly issues: readonly z.core.$ZodIssue[] };
}

const registry = new Map<string, StoredExtension>();

/**
 * Adds a preview extension. Returns a function that removes it again (for tests).
 *
 * @throws RegistryError for a malformed id or an id that is already taken.
 */
export function registerPreviewExtension<K extends PreviewExtensionId>(
  definition: PreviewExtensionDefinition<K>,
): () => void {
  const { id } = definition;
  if (!EXTENSION_ID_PATTERN.test(id)) {
    throw new RegistryError(
      `Preview extension "${id}": the id must be one lower camel word, for example "physical"`,
      { extensionId: id },
    );
  }
  if (registry.has(id)) {
    throw new RegistryError(`Preview extension "${id}" is already registered`, {
      extensionId: id,
    });
  }
  const stored: StoredExtension = {
    id,
    prepare: (raw) => {
      const parsed = definition.args.safeParse(raw);
      if (!parsed.success) {
        return { ok: false, issues: parsed.error.issues };
      }
      const args = parsed.data;
      const values: ResultOf<K>[] = [];
      return {
        ok: true,
        runner: {
          id,
          add: (ctx) => {
            values.push(definition.run(ctx, args));
          },
          single: (ctx) => definition.run(ctx, args),
          summary: () => definition.summarise(values),
        },
      };
    },
  };
  registry.set(id, stored);
  return () => {
    if (registry.get(id) === stored) {
      registry.delete(id);
    }
  };
}

/** Every registered extension id, sorted. */
export function previewExtensionIds(): string[] {
  return [...registry.keys()].sort();
}

/** Zod schema of the `extensions` field: a plain object; each entry is checked when the query runs. */
export const zPreviewExtensionArgs = z.custom<PreviewExtensionArgs>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  { message: 'extensions must be an object of extension arguments by id' },
);

/**
 * The extensions a preview asked for, with their checked arguments, in id order. `start` gives
 * fresh runners, so a batch never sees the values of another.
 */
export interface CheckedExtensions {
  readonly start: () => readonly ExtensionRunner[];
}

const NO_EXTENSIONS: CheckedExtensions = { start: () => [] };

/**
 * Checks the `extensions` field: refuses (as `invalidArgs`) an id nobody registered or arguments
 * the extension's schema refuses, with every reason at once.
 */
export function checkPreviewExtensions(
  requested: PreviewExtensionArgs | undefined,
): CheckedExtensions {
  if (requested === undefined) {
    return NO_EXTENSIONS;
  }
  const reasons: Reason[] = [];
  const raws = new Map<string, unknown>(Object.entries(requested));
  const accepted: { extension: StoredExtension; raw: unknown }[] = [];
  for (const [id, raw] of [...raws.entries()].sort(([left], [right]) => (left < right ? -1 : 1))) {
    const extension = registry.get(id);
    if (extension === undefined) {
      reasons.push({
        code: INVALID_ARGS,
        message: `extensions.${id}: the lab has no extension called "${id}"`,
        field: `extensions.${id}`,
      });
      continue;
    }
    const prepared = extension.prepare(raw);
    if (!prepared.ok) {
      for (const issue of prepared.issues) {
        const field = ['extensions', id, ...issue.path.map(String)].join('.');
        reasons.push({ code: INVALID_ARGS, message: issue.message, field });
      }
      continue;
    }
    accepted.push({ extension, raw });
  }
  if (reasons.length > 0) {
    return refuseQuery(reasons);
  }
  return {
    start: () =>
      accepted.flatMap(({ extension, raw }) => {
        const prepared = extension.prepare(raw);
        return prepared.ok ? [prepared.runner] : [];
      }),
  };
}

/** What every run of one preview shares. */
export interface ExtensionRunBase {
  readonly query: QueryContext;
  readonly draft: PreviewArgs;
  readonly promotionId: PromotionId;
  readonly batch: boolean;
}

function contextFor(
  base: ExtensionRunBase,
  run: { readonly key: number; readonly runIndex: number; readonly outcome: MatchOutcome | null },
): PreviewExtensionContext {
  const { query } = base;
  const streams = new Map<StreamName, RngStream>();
  return {
    read: query.read,
    tunables: query.tunables,
    query,
    draft: base.draft,
    promotionId: base.promotionId,
    outcome: run.outcome,
    runIndex: run.runIndex,
    batch: base.batch,
    rng: (streamName) => {
      let stream = streams.get(streamName);
      if (stream === undefined) {
        stream = detachedStream(query.read.meta.seed, streamName, String(run.key));
        streams.set(streamName, stream);
      }
      return stream;
    },
  };
}

/** Runs every checked extension once, for a single preview. */
export function runPreviewExtensions(
  checked: CheckedExtensions,
  base: ExtensionRunBase,
  run: { readonly key: number; readonly outcome: MatchOutcome | null },
): PreviewExtensionResults {
  const results: Record<string, unknown> = {};
  for (const runner of checked.start()) {
    results[runner.id] = runner.single(contextFor(base, { ...run, runIndex: 0 }));
  }
  return results;
}

/** Collects every checked extension's value over a batch and summarises them. */
export interface ExtensionTally {
  readonly add: (run: {
    readonly key: number;
    readonly runIndex: number;
    readonly outcome: MatchOutcome | null;
  }) => void;
  readonly summaries: () => PreviewExtensionSummaries;
}

/** A new, empty {@link ExtensionTally} for a batch. */
export function extensionTally(checked: CheckedExtensions, base: ExtensionRunBase): ExtensionTally {
  const runners = checked.start();
  return {
    add: (run) => {
      for (const runner of runners) {
        runner.add(contextFor(base, run));
      }
    },
    summaries: () => {
      const summaries: Record<string, unknown> = {};
      for (const runner of runners) {
        summaries[runner.id] = runner.summary();
      }
      return summaries;
    },
  };
}
