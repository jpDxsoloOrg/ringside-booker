/**
 * Plain JSON values and the engine's one serialisability check.
 *
 * Saves, event payloads and calculation traces must survive `JSON.stringify` and `JSON.parse`
 * unchanged, and must cross the Web Worker boundary as plain data. `JSON.stringify` does not help
 * here: it quietly turns `NaN` into `null`, drops `undefined` object values, turns a `Map` into
 * `{}` and a `Date` into a string, so a broken value only shows up later as a corrupted save.
 * {@link assertJsonValue} fails loudly instead, and names the first bad path.
 *
 * Every serialisability check in the engine goes through this module, so the rules live in one
 * place: event publishing (debug checks), trace helpers and the save writer all call it.
 */

import { z } from 'zod';
import { NotSerialisableError } from './errors';

/** A JSON leaf. Numbers are always finite. */
export type JsonPrimitive = null | boolean | number | string;

/** A JSON array. Every slot holds a value; there are no holes or `undefined` entries. */
export type JsonArray = readonly JsonValue[];

/** A plain JSON object (prototype `Object.prototype` or `null`) with string keys only. */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** Any value that round-trips through `JSON.stringify` and `JSON.parse` unchanged. */
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

/** Where the first bad value was found and what it was. */
export interface JsonProblem {
  readonly path: string;
  readonly reason: string;
}

/** Keys that can be written as `.key` in a path; everything else uses `["key"]`. */
const IDENTIFIER_KEY = /^[A-Za-z_$][\w$]*$/;

/** Appends an object key or array index to a path such as `$.a[2]`. */
export function appendPathSegment(path: string, segment: string | number): string {
  if (typeof segment === 'number') {
    return `${path}[${String(segment)}]`;
  }
  return IDENTIFIER_KEY.test(segment)
    ? `${path}.${segment}`
    : `${path}[${JSON.stringify(segment)}]`;
}

/** Builds a path string from a root and a list of keys and indexes, for example zod issue paths. */
export function formatPath(root: string, segments: readonly PropertyKey[]): string {
  let path = root;
  for (const segment of segments) {
    path = appendPathSegment(path, typeof segment === 'number' ? segment : String(segment));
  }
  return path;
}

/**
 * Returns the first reason `value` is not a {@link JsonValue}, or null when it is one. Walks the
 * value depth first, so the reported path is the first bad value in key order.
 */
export function findJsonProblem(value: unknown, path = '$'): JsonProblem | null {
  return checkValue(value, path, new Set());
}

/** True when `value` is a {@link JsonValue}. */
export function isJsonValue(value: unknown): value is JsonValue {
  return findJsonProblem(value) === null;
}

/**
 * Throws {@link NotSerialisableError} naming the first bad path unless `value` is plain JSON:
 * null, booleans, finite numbers (including `-0`), strings, and arrays or plain objects of those.
 *
 * Rejected: functions, `Map`, `Set`, `Date`, instances of any other class, `undefined` (as an
 * array entry or an object value), array holes, `NaN`, `Infinity`, `bigint`, symbols (as values
 * or keys) and circular references.
 */
export function assertJsonValue(value: unknown, path = '$'): asserts value is JsonValue {
  const problem = findJsonProblem(value, path);
  if (problem !== null) {
    throw new NotSerialisableError(problem.path, problem.reason);
  }
}

/** True when `value` is a plain JSON object: not null and not an array. Checks one level only. */
export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A deep copy of a JSON value. Save migrations get a copy of the document through this, so a
 * migration can never change the document it was handed.
 */
export function cloneJson<T extends JsonValue>(value: T): T;
export function cloneJson(value: JsonValue): JsonValue {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (isJsonArray(value)) {
    return value.map((entry) => cloneJson(entry));
  }
  const copy: Record<string, JsonValue> = {};
  for (const key of Object.keys(value)) {
    const entry = value[key];
    if (entry !== undefined) {
      copy[key] = cloneJson(entry);
    }
  }
  return copy;
}

/** `Array.isArray` narrowed to JSON arrays (the built-in guard loses readonly array types). */
export function isJsonArray(value: JsonValue): value is JsonArray {
  return Array.isArray(value);
}

/** Zod schema for a {@link JsonValue}; the issue message names the first bad path. */
export const zJsonValue: z.ZodType<JsonValue> = z.custom<JsonValue>().superRefine((value, ctx) => {
  const problem = findJsonProblem(value);
  if (problem !== null) {
    ctx.addIssue({
      code: 'custom',
      message: `must be plain JSON (${problem.path} is ${problem.reason})`,
    });
  }
});

function checkValue(value: unknown, path: string, ancestors: Set<object>): JsonProblem | null {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return null;
    case 'number':
      if (Number.isFinite(value)) {
        return null;
      }
      return { path, reason: Number.isNaN(value) ? 'NaN' : 'an infinite number' };
    case 'undefined':
      return { path, reason: 'undefined' };
    case 'bigint':
      return { path, reason: 'a bigint' };
    case 'symbol':
      return { path, reason: 'a symbol' };
    case 'function':
      return { path, reason: 'a function' };
    case 'object':
      return value === null ? null : checkObject(value, path, ancestors);
  }
}

function checkObject(value: object, path: string, ancestors: Set<object>): JsonProblem | null {
  if (ancestors.has(value)) {
    return { path, reason: 'a circular reference' };
  }
  const kindProblem = describeNonPlainObject(value);
  if (kindProblem !== null) {
    return { path, reason: kindProblem };
  }
  ancestors.add(value);
  const problem = Array.isArray(value)
    ? checkArrayEntries(value, path, ancestors)
    : checkObjectEntries(value, path, ancestors);
  ancestors.delete(value);
  return problem;
}

/** Names what kind of non-JSON object this is, or returns null for arrays and plain objects. */
function describeNonPlainObject(value: object): string | null {
  if (value instanceof Map) {
    return 'a Map';
  }
  if (value instanceof Set) {
    return 'a Set';
  }
  if (value instanceof Date) {
    return 'a Date';
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    return prototype === Array.prototype ? null : 'an array subclass instance';
  }
  if (prototype === Object.prototype || prototype === null) {
    return Object.getOwnPropertySymbols(value).length > 0 ? 'an object with symbol keys' : null;
  }
  return `an instance of ${describeConstructor(prototype)}`;
}

function describeConstructor(prototype: unknown): string {
  const constructorFunction: unknown =
    typeof prototype === 'object' && prototype !== null && 'constructor' in prototype
      ? prototype.constructor
      : undefined;
  return typeof constructorFunction === 'function' && constructorFunction.name !== ''
    ? `class ${constructorFunction.name}`
    : 'a class';
}

function checkArrayEntries(
  entries: readonly unknown[],
  path: string,
  ancestors: Set<object>,
): JsonProblem | null {
  for (let i = 0; i < entries.length; i++) {
    const entryPath = appendPathSegment(path, i);
    if (!(i in entries)) {
      return { path: entryPath, reason: 'an empty array slot' };
    }
    const problem = checkValue(entries[i], entryPath, ancestors);
    if (problem !== null) {
      return problem;
    }
  }
  return null;
}

function checkObjectEntries(
  value: object,
  path: string,
  ancestors: Set<object>,
): JsonProblem | null {
  if (!isPlainRecord(value)) {
    return { path, reason: 'not a plain object' };
  }
  for (const key of Object.keys(value)) {
    const problem = checkValue(value[key], appendPathSegment(path, key), ancestors);
    if (problem !== null) {
      return problem;
    }
  }
  return null;
}

/** Plain objects (prototype `Object.prototype` or `null`) can be read by string key. */
function isPlainRecord(value: object): value is Readonly<Record<string, unknown>> {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
