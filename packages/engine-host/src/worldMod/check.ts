/**
 * Checks a converted world mod pack with the same pack loader a new game runs, and skips the
 * records the loader refuses instead of failing the whole import.
 *
 * Mods carry data the engine's cross-record rules do not allow (two live contracts with one
 * promotion, an active team with a member who has died, …). The converter fixes the shapes it
 * knows; anything else the loader names by record (`kind` + `recordKey` in this pack) is left out
 * and reported as a warning grouped by the rule's code, then the pack is checked again. Records
 * that pointed at a skipped record are refused by the next round and skipped the same way. Only a
 * problem that is not tied to one of the mod's records (a manifest or resolution problem, a world
 * with no start), or one that keeps coming back after `MAX_ROUNDS`, fails the import.
 */

import { loadWorldFromPacks } from '@ringside/engine';
import type { PackIssue, RawPack, RecordKind } from '@ringside/engine';
import type { WorldModReport } from './convert';
import type { ConversionWarning } from './report';

/** Load-and-skip rounds before giving up. Each skipped record's dependants fall out a round later. */
export const MAX_ROUNDS = 8;

/** Examples kept per skip warning, as in the conversion report. */
const MAX_EXAMPLES = 5;

export type WorldModCheck =
  | {
      readonly ok: true;
      readonly pack: RawPack;
      readonly report: WorldModReport;
      /** The loader's remaining warnings. */
      readonly issues: readonly PackIssue[];
    }
  | {
      readonly ok: false;
      readonly report: WorldModReport;
      /** The errors (first) and warnings of the last round. */
      readonly issues: readonly PackIssue[];
      readonly errorCount: number;
    };

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The engine rule behind an issue: `teams.deceasedMember` from its message, else the issue code. */
export function ruleOf(issue: PackIssue): string {
  const match = /^([A-Za-z]+\.[A-Za-z]+):/.exec(issue.message);
  return match?.[1] ?? issue.code;
}

function errorsFirst(issues: readonly PackIssue[]): PackIssue[] {
  return [...issues].sort((left, right) =>
    left.severity === right.severity ? 0 : left.severity === 'error' ? -1 : 1,
  );
}

/**
 * Loads `pack` on top of `others` and skips refused records until it loads (or cannot be fixed by
 * skipping). The input pack is not changed.
 */
export function checkWorldModPack(
  others: readonly RawPack[],
  pack: RawPack,
  report: WorldModReport,
  seed = 'world-mod-import-check',
): WorldModCheck {
  const packId = pack.manifest.id;
  const files: Partial<Record<RecordKind, unknown>> = { ...pack.files };
  const counts = { ...report.counts };
  const skipped = new Map<
    string,
    { kind: RecordKind; rule: string; count: number; examples: string[] }
  >();

  const reportNow = (): WorldModReport => {
    const extra: ConversionWarning[] = [...skipped.entries()].map(([code, group]) => ({
      code,
      message: `A ${group.kind} record the game's checks refused (${group.rule}) was left out`,
      count: group.count,
      examples: group.examples,
    }));
    return { ...report, counts, warnings: [...report.warnings, ...extra] };
  };

  for (let round = 0; ; round += 1) {
    const current: RawPack = { manifest: pack.manifest, files };
    const loaded = loadWorldFromPacks([...others, current], [packId], { seed });
    if (loaded.ok) return { ok: true, pack: current, report: reportNow(), issues: loaded.issues };

    const errors = loaded.issues.filter((issue) => issue.severity === 'error');
    // Every error must name a record of this pack, or skipping cannot help.
    const toSkip = new Map<RecordKind, Map<string, string>>();
    let fixable = round < MAX_ROUNDS && errors.length > 0;
    for (const issue of errors) {
      const { kind, recordKey } = issue;
      if (issue.packId !== packId || kind === undefined || recordKey === undefined) {
        fixable = false;
        break;
      }
      const list = files[kind];
      if (
        !Array.isArray(list) ||
        !list.some((record) => isRec(record) && record['key'] === recordKey)
      ) {
        fixable = false;
        break;
      }
      let keys = toSkip.get(kind);
      if (keys === undefined) {
        keys = new Map();
        toSkip.set(kind, keys);
      }
      if (!keys.has(recordKey)) keys.set(recordKey, ruleOf(issue));
    }
    if (!fixable) {
      return {
        ok: false,
        report: reportNow(),
        issues: errorsFirst(loaded.issues),
        errorCount: errors.length,
      };
    }

    for (const [kind, keys] of toSkip) {
      const list = files[kind];
      if (!Array.isArray(list)) continue;
      const kept = list.filter((record) => !(isRec(record) && keys.has(String(record['key']))));
      files[kind] = kept;
      counts[kind] = Math.max(0, (counts[kind] ?? list.length) - (list.length - kept.length));
      for (const [recordKey, rule] of keys) {
        const code = `check-${rule}`;
        let group = skipped.get(code);
        if (group === undefined) {
          group = { kind, rule, count: 0, examples: [] };
          skipped.set(code, group);
        }
        group.count += 1;
        if (group.examples.length < MAX_EXAMPLES) group.examples.push(`${kind}:${recordKey}`);
      }
    }
  }
}
