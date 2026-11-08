/**
 * Reading a save's header without loading the world.
 *
 * Save-slot lists, file import and slot repair (FND-12) need the world name, date, promotion and
 * label of a save, not the world itself. `inspectSave` runs the first four load stages (decode,
 * parse, format, version) and validates only the header and the engine version, so it stays cheap
 * and never builds a World. It does not migrate: the header's shape is kept stable across format
 * versions (see `docs/design/save-format.md`).
 */

import { z } from 'zod';
import type { JsonObject } from '../core/json';
import { readSaveDocument, type ReadOptions } from './load';
import { documentPath, loadFailure, type LoadFailure } from './report';
import { SaveHeaderSchema, type SaveHeader } from './save-document';

export interface InspectSuccess {
  readonly ok: true;
  readonly header: SaveHeader;
  readonly formatVersion: number;
  /** The engine build that wrote the save. */
  readonly engineVersion: string;
}

export type InspectReport = InspectSuccess | LoadFailure;

const InspectedFieldsSchema = z.object({
  engineVersion: z.string().min(1),
  header: SaveHeaderSchema,
});

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function inspectDocument(doc: JsonObject, formatVersion: number): InspectReport {
  const result = InspectedFieldsSchema.safeParse(doc);
  if (!result.success) {
    return loadFailure(
      'validate',
      result.error.issues.map((issue) => ({
        path: documentPath(issue.path),
        message: issue.message,
      })),
    );
  }
  return {
    ok: true,
    header: result.data.header,
    formatVersion,
    engineVersion: result.data.engineVersion,
  };
}

/**
 * The header, format version and engine version of a save. Runs the decode, parse, format and
 * version stages and validates only the header; problems come back as a failure naming the stage
 * (`validate` for a bad header). Never throws.
 */
export async function inspectSave(
  bytes: Uint8Array,
  options: ReadOptions = {},
): Promise<InspectReport> {
  try {
    const read = await readSaveDocument(bytes, options);
    if (!read.ok) {
      return read;
    }
    return inspectDocument(read.value.doc, read.value.formatVersion);
  } catch (error: unknown) {
    return loadFailure('decode', [
      { path: '', message: `Reading the save failed unexpectedly: ${describeError(error)}` },
    ]);
  }
}
