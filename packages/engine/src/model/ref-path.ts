/**
 * The reference path mini-syntax used by `RefSpec.path`.
 *
 * - `promotionId`: a plain field.
 * - `crew.announcerId`: dot segments walk into nested objects.
 * - `tagIds[]`: `[]` after a field fans out over the array's elements.
 * - `members[].personId`: fan out, then keep walking inside each element.
 * - `regionalPop{}`: `{}` after the last field uses the record's **keys** as the references (for
 *   sparse records such as `Record<RegionId, number>`). It is only allowed on the last segment.
 *
 * Resolving a path against a row yields one `ResolvedRef` per reference found, each with the
 * concrete path of the value (`tagIds[1]`, `members[0].personId`, `regionalPop{reg_0000000001}`).
 * Missing optional fields and null containers yield nothing. A null at the end of the path is
 * yielded, so the caller can decide whether the reference is nullable.
 */

import { InvalidArgumentError } from '../core/errors';

export type FanOut = 'none' | 'array' | 'recordKeys';

export interface RefPathSegment {
  readonly field: string;
  readonly fanOut: FanOut;
}

export interface ResolvedRef {
  /** The concrete path of this value inside the row, for example `members[2].personId`. */
  readonly path: string;
  /**
   * The value found there. Usually an ID string or null. When the row has the wrong shape (an
   * object where `[]` expects an array, say), it is the out-of-place value, so the caller can
   * report it instead of the reference silently disappearing.
   */
  readonly value: unknown;
}

const SEGMENT_PATTERN = /^([A-Za-z_$][A-Za-z0-9_$]*)(\[\]|\{\})?$/;

const parsedPathCache = new Map<string, readonly RefPathSegment[]>();

function invalidPath(path: string, reason: string): InvalidArgumentError {
  return new InvalidArgumentError('parseRefPath', 'path', path, reason);
}

function fanOutOf(marker: string | undefined): FanOut {
  if (marker === '[]') {
    return 'array';
  }
  return marker === '{}' ? 'recordKeys' : 'none';
}

/** Parses a reference path, throwing `InvalidArgumentError` when it breaks the syntax. */
export function parseRefPath(path: string): readonly RefPathSegment[] {
  const cached = parsedPathCache.get(path);
  if (cached !== undefined) {
    return cached;
  }
  const rawSegments = path.split('.');
  const segments: RefPathSegment[] = [];
  for (const [position, rawSegment] of rawSegments.entries()) {
    const match = SEGMENT_PATTERN.exec(rawSegment);
    const field = match?.[1];
    if (match === null || field === undefined) {
      throw invalidPath(path, 'dot-separated field names, each optionally followed by [] or {}');
    }
    const fanOut = fanOutOf(match[2]);
    if (fanOut === 'recordKeys' && position !== rawSegments.length - 1) {
      throw invalidPath(path, 'a path whose {} (record keys) marker is on the last segment only');
    }
    segments.push({ field, fanOut });
  }
  const frozen = Object.freeze(segments);
  parsedPathCache.set(path, frozen);
  return frozen;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compareKeys(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

function walk(
  container: unknown,
  segments: readonly RefPathSegment[],
  segmentIndex: number,
  prefix: string,
  found: ResolvedRef[],
): void {
  const segment = segments[segmentIndex];
  if (segment === undefined) {
    found.push({ path: prefix, value: container });
    return;
  }
  if (!isRecord(container) || !Object.hasOwn(container, segment.field)) {
    return;
  }
  const fieldValue = container[segment.field];
  const fieldPath = prefix === '' ? segment.field : `${prefix}.${segment.field}`;
  if (fieldValue === undefined) {
    return;
  }
  switch (segment.fanOut) {
    case 'none':
      walk(fieldValue, segments, segmentIndex + 1, fieldPath, found);
      return;
    case 'array':
      if (fieldValue === null) {
        return;
      }
      if (!Array.isArray(fieldValue)) {
        found.push({ path: fieldPath, value: fieldValue });
        return;
      }
      fieldValue.forEach((element: unknown, elementIndex) => {
        walk(element, segments, segmentIndex + 1, `${fieldPath}[${String(elementIndex)}]`, found);
      });
      return;
    case 'recordKeys':
      if (fieldValue === null) {
        return;
      }
      if (!isRecord(fieldValue)) {
        found.push({ path: fieldPath, value: fieldValue });
        return;
      }
      for (const key of Object.keys(fieldValue).sort(compareKeys)) {
        found.push({ path: `${fieldPath}{${key}}`, value: key });
      }
      return;
  }
}

/** Every reference `path` finds in `row`, in path order (array index, then sorted record key). */
export function resolveRefPath(row: unknown, path: string): ResolvedRef[] {
  const found: ResolvedRef[] = [];
  walk(row, parseRefPath(path), 0, '', found);
  return found;
}
