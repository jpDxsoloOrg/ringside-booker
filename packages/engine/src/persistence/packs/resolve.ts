/**
 * Pack dependency resolution: which packs load, and in what order.
 *
 * `resolvePacks` starts from the root packs (the world and any add-ons the player picked), follows
 * every `dependsOn` entry, checks that each dependency was passed in and that its version is in the
 * range asked for, and returns the packs in dependency order: every pack after all the packs it
 * depends on. Packs that no root reaches are left out.
 *
 * When two packs could go next, the one with the lower pack ID goes first, so the order depends
 * only on the packs themselves and never on the order they were passed in.
 *
 * Format doc: docs/design/data-packs.md, "Loading".
 */

import type { RawPack } from './index';
import { packError, type PackIssue, type Result } from './issues';
import { packManifestSchema, type PackManifest } from './manifest';
import { satisfiesRange } from './semver';

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function describeId(manifest: unknown): string {
  if (typeof manifest === 'object' && manifest !== null) {
    const id: unknown = Reflect.get(manifest, 'id');
    if (typeof id === 'string' && id.length > 0) {
      return id;
    }
  }
  return '(no id)';
}

/** Checks every manifest against the schema; packs with a broken manifest are left out. */
function checkManifests(packs: readonly RawPack[], issues: PackIssue[]): Map<string, RawPack> {
  const byId = new Map<string, RawPack>();
  const duplicateIds = new Set<string>();
  for (const pack of packs) {
    const parsed = packManifestSchema.safeParse(pack.manifest);
    if (!parsed.success) {
      const packId = describeId(pack.manifest);
      for (const problem of parsed.error.issues) {
        issues.push(
          packError({
            code: 'manifest',
            packId,
            file: 'pack.json',
            path: problem.path.map((segment) =>
              typeof segment === 'number' ? segment : String(segment),
            ),
            message: problem.message,
          }),
        );
      }
      continue;
    }
    const manifest: PackManifest = parsed.data;
    // `files` usually comes straight from parsed JSON, so check its shape rather than trust the type.
    const files: unknown = pack.files;
    if (typeof files !== 'object' || files === null || Array.isArray(files)) {
      issues.push(
        packError({
          code: 'schema',
          packId: manifest.id,
          path: ['files'],
          message: `Expected the record files of ${manifest.id} as an object keyed by record kind`,
        }),
      );
      continue;
    }
    if (byId.has(manifest.id)) {
      duplicateIds.add(manifest.id);
      continue;
    }
    byId.set(manifest.id, { manifest, files: pack.files });
  }
  for (const packId of [...duplicateIds].sort(compareText)) {
    issues.push(
      packError({
        code: 'duplicate-pack',
        packId,
        path: ['id'],
        message: `More than one pack has the ID ${packId}`,
      }),
    );
  }
  return byId;
}

/**
 * Every pack the roots reach, with its dependency edges. Reports missing dependencies and versions
 * outside the asked-for range.
 */
function collectReachable(
  byId: ReadonlyMap<string, RawPack>,
  rootIds: readonly string[],
  issues: PackIssue[],
): Map<string, string[]> {
  const dependenciesById = new Map<string, string[]>();
  const queue: string[] = [];
  for (const rootId of [...new Set(rootIds)].sort(compareText)) {
    if (byId.has(rootId)) {
      queue.push(rootId);
    } else {
      issues.push(
        packError({
          code: 'missing-dependency',
          packId: rootId,
          path: [],
          message: `Pack ${rootId} was asked for but not passed in`,
        }),
      );
    }
  }
  while (queue.length > 0) {
    const packId = queue.shift();
    const pack = packId === undefined ? undefined : byId.get(packId);
    if (packId === undefined || pack === undefined || dependenciesById.has(packId)) {
      continue;
    }
    const dependencies: string[] = [];
    pack.manifest.dependsOn.forEach((dependency, index) => {
      const target = byId.get(dependency.id);
      if (target === undefined) {
        issues.push(
          packError({
            code: 'missing-dependency',
            packId,
            file: 'pack.json',
            path: ['dependsOn', index, 'id'],
            message: `Pack ${packId} depends on ${dependency.id} ${dependency.version}, which was not passed in`,
          }),
        );
        return;
      }
      if (!satisfiesRange(target.manifest.version, dependency.version)) {
        issues.push(
          packError({
            code: 'version-mismatch',
            packId,
            file: 'pack.json',
            path: ['dependsOn', index, 'version'],
            message: `Pack ${packId} needs ${dependency.id} ${dependency.version}, but version ${target.manifest.version} was passed in`,
          }),
        );
      }
      dependencies.push(dependency.id);
      queue.push(dependency.id);
    });
    dependenciesById.set(packId, dependencies.sort(compareText));
  }
  return dependenciesById;
}

/** Kahn's algorithm, always taking the lowest ready pack ID. Returns the order and what is left. */
function topologicalOrder(dependenciesById: ReadonlyMap<string, readonly string[]>): {
  order: string[];
  remaining: Set<string>;
} {
  const waitingOn = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const [packId, dependencies] of dependenciesById) {
    waitingOn.set(packId, dependencies.length);
    for (const dependencyId of dependencies) {
      dependents.set(dependencyId, [...(dependents.get(dependencyId) ?? []), packId]);
    }
  }
  const ready = [...waitingOn].filter(([, count]) => count === 0).map(([packId]) => packId);
  const order: string[] = [];
  while (ready.length > 0) {
    ready.sort(compareText);
    const next = ready.shift();
    if (next === undefined) {
      break;
    }
    order.push(next);
    waitingOn.delete(next);
    for (const dependentId of dependents.get(next) ?? []) {
      const count = (waitingOn.get(dependentId) ?? 0) - 1;
      waitingOn.set(dependentId, count);
      if (count === 0) {
        ready.push(dependentId);
      }
    }
  }
  return { order, remaining: new Set(waitingOn.keys()) };
}

/** The strongly connected components among `nodes` (Tarjan), each sorted by pack ID. */
function stronglyConnected(
  nodes: ReadonlySet<string>,
  dependenciesById: ReadonlyMap<string, readonly string[]>,
): string[][] {
  let nextIndex = 0;
  const indexOf = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  function visit(node: string): void {
    indexOf.set(node, nextIndex);
    lowLink.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of dependenciesById.get(node) ?? []) {
      if (!nodes.has(next)) {
        continue;
      }
      if (!indexOf.has(next)) {
        visit(next);
        lowLink.set(node, Math.min(lowLink.get(node) ?? 0, lowLink.get(next) ?? 0));
      } else if (onStack.has(next)) {
        lowLink.set(node, Math.min(lowLink.get(node) ?? 0, indexOf.get(next) ?? 0));
      }
    }
    if (lowLink.get(node) === indexOf.get(node)) {
      const component: string[] = [];
      let member: string | undefined;
      do {
        member = stack.pop();
        if (member !== undefined) {
          onStack.delete(member);
          component.push(member);
        }
      } while (member !== undefined && member !== node);
      components.push(component.sort(compareText));
    }
  }

  for (const node of [...nodes].sort(compareText)) {
    if (!indexOf.has(node)) {
      visit(node);
    }
  }
  return components;
}

/** The shortest loop from `start` back to itself inside `component`, as `[start, ..., start]`. */
function shortestCycle(
  start: string,
  component: ReadonlySet<string>,
  dependenciesById: ReadonlyMap<string, readonly string[]>,
): string[] {
  const previous = new Map<string, string>();
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) {
      break;
    }
    for (const next of dependenciesById.get(node) ?? []) {
      if (!component.has(next)) {
        continue;
      }
      if (next === start) {
        // Walk back from `node` to `start` through the BFS parents, then read it forwards.
        const chain: string[] = [];
        let step: string | undefined = node;
        while (step !== undefined && step !== start) {
          chain.push(step);
          step = previous.get(step);
        }
        return [start, ...chain.reverse(), start];
      }
      if (!previous.has(next)) {
        previous.set(next, node);
        queue.push(next);
      }
    }
  }
  return [start, start];
}

function reportCycles(
  remaining: ReadonlySet<string>,
  dependenciesById: ReadonlyMap<string, readonly string[]>,
  issues: PackIssue[],
): void {
  const components = stronglyConnected(remaining, dependenciesById).filter(
    (component) => component.length > 1,
  );
  components.sort((left, right) => compareText(left[0] ?? '', right[0] ?? ''));
  for (const component of components) {
    const start = component[0];
    if (start === undefined) {
      continue;
    }
    const cycle = shortestCycle(start, new Set(component), dependenciesById);
    issues.push(
      packError({
        code: 'dependency-cycle',
        packId: start,
        file: 'pack.json',
        path: ['dependsOn'],
        message: `Packs depend on each other in a loop: ${cycle.join(' → ')}`,
      }),
    );
  }
}

/**
 * Orders the packs the roots need so that every pack comes after its dependencies. Fails with
 * `manifest`, `duplicate-pack`, `missing-dependency`, `version-mismatch` or `dependency-cycle`
 * issues. The returned packs carry their checked manifests.
 */
export function resolvePacks(
  packs: readonly RawPack[],
  rootIds: readonly string[],
): Result<RawPack[]> {
  const issues: PackIssue[] = [];
  const byId = checkManifests(packs, issues);
  const dependenciesById = collectReachable(byId, rootIds, issues);
  const { order, remaining } = topologicalOrder(dependenciesById);
  if (remaining.size > 0) {
    reportCycles(remaining, dependenciesById, issues);
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  const resolved: RawPack[] = [];
  for (const packId of order) {
    const pack = byId.get(packId);
    if (pack !== undefined) {
      resolved.push(pack);
    }
  }
  return { ok: true, value: resolved, issues };
}
