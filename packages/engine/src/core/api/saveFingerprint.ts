/**
 * The save schema fingerprint: one short hash of the whole save document schema, every simulation
 * part included.
 *
 * Any edit to a save schema changes it, so a save can say which shape of data it was written
 * with. It lives here, not in `persistence/`, because it needs the simulation schemas (see the
 * header of `saveParts.ts`). The value is not frozen: a zod upgrade can change the JSON schema
 * text and with it every fingerprint. That is safe, because the fingerprint is only read when a
 * load has already failed.
 *
 * See docs/design/save-format.md, "Older builds (until the format freezes)".
 */

import { z } from 'zod';
import { SAVE_SCHEMA_FINGERPRINT_PATTERN } from '../../persistence/save-document';
import { hashString128, hashWordsToHex, stableStringify } from '../hash';
import { createEngineSaveDocumentSchema } from './saveParts';

export { SAVE_SCHEMA_FINGERPRINT_PATTERN };

/**
 * The fingerprint of any schema: 32 lowercase hex characters.
 *
 * `reused: 'ref'` writes a schema object that appears more than once as one shared definition.
 * It is needed, not a nicety: the trace schema is built one level at a time and every node kind
 * at a level shares the same children schema, so writing each use out in full grows by a factor
 * of twelve per level and never finishes.
 */
export function fingerprintOf(schema: z.ZodType): string {
  const jsonSchema = z.toJSONSchema(schema, {
    unrepresentable: 'any',
    io: 'input',
    reused: 'ref',
  });
  return hashWordsToHex(hashString128(stableStringify(jsonSchema)));
}

let cachedFingerprint: string | null = null;

/** This build's save schema fingerprint. Computed once per process. */
export function engineSaveSchemaFingerprint(): string {
  cachedFingerprint ??= fingerprintOf(createEngineSaveDocumentSchema());
  return cachedFingerprint;
}
