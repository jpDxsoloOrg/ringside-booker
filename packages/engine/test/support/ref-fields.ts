import { z } from 'zod';

/** Field names that hold entity IDs by convention: `promotionId`, `memberIds`, ... */
const REFERENCE_FIELD_PATTERN = /Ids?$/;

function walk(
  schema: z.core.$ZodType,
  prefix: string,
  isReferenceField: boolean,
  found: Set<string>,
): void {
  if (schema instanceof z.ZodNullable || schema instanceof z.ZodOptional) {
    walk(schema.unwrap(), prefix, isReferenceField, found);
    return;
  }
  if (schema instanceof z.ZodArray) {
    walk(schema.element, `${prefix}[]`, isReferenceField, found);
    return;
  }
  if (schema instanceof z.ZodUnion) {
    for (const option of schema.options) {
      walk(option, prefix, isReferenceField, found);
    }
    return;
  }
  if (schema instanceof z.ZodObject) {
    const shape: Readonly<Record<string, unknown>> = schema.shape;
    for (const [field, fieldSchema] of Object.entries(shape)) {
      if (!(fieldSchema instanceof z.ZodType)) {
        throw new Error(`Field ${field} is not a zod schema`);
      }
      walk(
        fieldSchema,
        prefix === '' ? field : `${prefix}.${field}`,
        REFERENCE_FIELD_PATTERN.test(field),
        found,
      );
    }
    return;
  }
  if (isReferenceField) {
    found.add(prefix);
  }
}

/**
 * Every reference path a row schema implies by field name: each field named `...Id` or `...Ids`,
 * with `[]` for arrays and dots for nested objects, in the `RefSpec.path` syntax.
 */
export function referenceFieldPaths(schema: z.core.$ZodType): string[] {
  const found = new Set<string>();
  walk(schema, '', false, found);
  return [...found].sort();
}
