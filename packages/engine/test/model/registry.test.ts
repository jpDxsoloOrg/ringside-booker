/**
 * The production table registry is complete and its reference specs match the schemas: every
 * entity kind has exactly one table, every table's rows carry IDs of its own kind, and every
 * `RefSpec.path` walks to a real field of the row schema.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ENTITY_KIND_LIST, ENTITY_KINDS } from '../../src/core/ids';
import { parseRefPath } from '../../src/model/ref-path';
import type { RefSpec, TableDef } from '../../src/model/table-def';
import { TABLES } from '../../src/model/tables';
import { testId } from '../support/ids';

const TABLE_DEFS: readonly TableDef[] = Object.values(TABLES);

/** The schema inside any `.nullable()`, `.optional()` and `.default()` wrappers. */
function unwrap(schema: z.core.$ZodType): z.core.$ZodType {
  if (
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodDefault
  ) {
    return unwrap(schema.unwrap());
  }
  return schema;
}

/** The object schemas a value can be: the object itself, or each object option of a union. */
function objectVariants(schema: z.core.$ZodType): z.ZodObject[] {
  const inner = unwrap(schema);
  if (inner instanceof z.ZodObject) {
    return [inner];
  }
  if (inner instanceof z.ZodUnion) {
    return inner.options.flatMap((option: z.core.$ZodType) => objectVariants(option));
  }
  return [];
}

function fieldOf(variant: z.ZodObject, field: string): z.core.$ZodType | undefined {
  const shape: Readonly<Record<string, unknown>> = variant.shape;
  const fieldSchema = shape[field];
  return fieldSchema instanceof z.ZodType ? fieldSchema : undefined;
}

/**
 * The schemas a reference path ends at, following every union option that has the next field.
 * `[]` steps into an array's element and `{}` into a record's key. Throws naming the first
 * segment that no option has, or that has the wrong shape for its marker.
 */
function resolvePathSchemas(rowSchema: z.core.$ZodType, path: string): z.core.$ZodType[] {
  let current: z.core.$ZodType[] = [rowSchema];
  for (const segment of parseRefPath(path)) {
    const next: z.core.$ZodType[] = [];
    for (const schema of current) {
      for (const variant of objectVariants(schema)) {
        const fieldSchema = fieldOf(variant, segment.field);
        if (fieldSchema === undefined) {
          continue;
        }
        const inner = unwrap(fieldSchema);
        if (segment.fanOut === 'array') {
          if (!(inner instanceof z.ZodArray)) {
            throw new Error(`${path}: ${segment.field} is not an array`);
          }
          next.push(inner.element);
        } else if (segment.fanOut === 'recordKeys') {
          if (!(inner instanceof z.ZodRecord)) {
            throw new Error(`${path}: ${segment.field} is not a record`);
          }
          next.push(inner.keyType);
        } else {
          next.push(fieldSchema);
        }
      }
    }
    if (next.length === 0) {
      throw new Error(`${path}: no field ${segment.field} in the schema`);
    }
    current = next;
  }
  return current;
}

function refCases(): [string, TableDef, RefSpec][] {
  return TABLE_DEFS.flatMap((def) =>
    def.refs.map((spec): [string, TableDef, RefSpec] => [`${def.name}.${spec.path}`, def, spec]),
  );
}

describe('the production table registry', () => {
  it('registers every entity kind exactly once', () => {
    const kindsInRegistry = TABLE_DEFS.map((def) => def.kind).sort();
    expect(kindsInRegistry).toEqual([...ENTITY_KIND_LIST].sort());
    expect(TABLE_DEFS).toHaveLength(31);
  });

  it('registers the season table', () => {
    expect(TABLE_DEFS.filter((def) => def.kind === 'season').map((def) => def.name)).toEqual([
      'seasons',
    ]);
  });

  it.each(TABLE_DEFS.map((def) => [def.name, def] as const))(
    '%s rows carry IDs with their own kind prefix',
    (_name, def) => {
      const [idSchema] = resolvePathSchemas(def.schema, 'id');
      expect(idSchema).toBeDefined();
      expect(z.safeParse(idSchema!, testId(def.kind)).success).toBe(true);
      expect(testId(def.kind).startsWith(`${ENTITY_KINDS[def.kind]}_`)).toBe(true);
      const otherKind = ENTITY_KIND_LIST.find((kind) => kind !== def.kind)!;
      expect(z.safeParse(idSchema!, testId(otherKind)).success).toBe(false);
    },
  );

  it.each(refCases())('ref %s resolves against the row schema', (_label, def, spec) => {
    const leaves = resolvePathSchemas(def.schema, spec.path);
    expect(leaves.length).toBeGreaterThan(0);
    const acceptsNull = leaves.some((leaf) => z.safeParse(leaf, null).success);
    expect(acceptsNull, `nullable flag of ${def.name}.${spec.path}`).toBe(spec.nullable);
  });

  it('rejects a path with an unknown segment', () => {
    expect(() => resolvePathSchemas(TABLES.people.schema, 'birthRegion')).toThrow(
      /no field birthRegion/,
    );
    expect(() => resolvePathSchemas(TABLES.mail.schema, 'from.teamId')).toThrow(/no field teamId/);
    expect(() => resolvePathSchemas(TABLES.people.schema, 'birthRegionId[]')).toThrow(
      /not an array/,
    );
  });
});
