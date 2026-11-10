// The save schema fingerprint. Design: docs/design/save-format.md#older-builds-until-the-format-freezes
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { engineStateParts } from '../../src/core/api';
import {
  engineSaveSchemaFingerprint,
  fingerprintOf,
  SAVE_SCHEMA_FINGERPRINT_PATTERN,
} from '../../src/core/api/saveFingerprint';
import { hashWordsToHex } from '../../src/core/hash';
import { TABLES } from '../../src/model/tables';
import { encodeSave } from '../../src/persistence/codec';
import { inspectSave } from '../../src/persistence/inspect';
import { loadSave } from '../../src/persistence/load';
import { createSaveDocumentSchema } from '../../src/persistence/save-document';
import { testSaveDocument } from '../support/saves';
import { tinyWorld } from '../support/worlds';

describe('hashWordsToHex', () => {
  it('writes four words as 32 lowercase hex characters, zero padded', () => {
    expect(hashWordsToHex([0, 1, 0xabcdef, 0xffffffff])).toBe('000000000000000100abcdefffffffff');
  });
});

describe('engineSaveSchemaFingerprint', () => {
  it('is 32 lowercase hex characters and the same on every call', () => {
    const fingerprint = engineSaveSchemaFingerprint();
    expect(fingerprint).toMatch(SAVE_SCHEMA_FINGERPRINT_PATTERN);
    expect(engineSaveSchemaFingerprint()).toBe(fingerprint);
    expect(fingerprintOf(createSaveDocumentSchema(engineStateParts))).toBe(fingerprint);
  });

  it('changes when one field is added to a state part', () => {
    const rngPart = z.strictObject({ version: z.literal(1), seed: z.string() });
    const before = fingerprintOf(createSaveDocumentSchema({ ...engineStateParts, rng: rngPart }));
    const after = fingerprintOf(
      createSaveDocumentSchema({
        ...engineStateParts,
        rng: rngPart.extend({ drawsTaken: z.number().int() }),
      }),
    );
    expect(after).toMatch(SAVE_SCHEMA_FINGERPRINT_PATTERN);
    expect(after).not.toBe(before);
  });

  it("save schema changed: regenerate fixtures and add 'Start a NEW game after this deploy' to the owner test steps", async () => {
    await expect(`${engineSaveSchemaFingerprint()}\n`).toMatchFileSnapshot(
      '../fixtures/saves/schema-fingerprint.txt',
    );
  });
});

describe('the fingerprint in a save header', () => {
  it('round-trips through encodeSave and inspectSave', async () => {
    const schemaFingerprint = engineSaveSchemaFingerprint();
    const doc = testSaveDocument(tinyWorld().world, { schemaFingerprint });
    expect(doc.header.schemaFingerprint).toBe(schemaFingerprint);
    const inspected = await inspectSave(await encodeSave(doc));
    expect(inspected.ok && inspected.header.schemaFingerprint).toBe(schemaFingerprint);
  });

  it('is left out of the header when the save does not give one', async () => {
    const doc = testSaveDocument(tinyWorld().world);
    expect('schemaFingerprint' in doc.header).toBe(false);
    const bytes = await encodeSave(doc);
    const inspected = await inspectSave(bytes);
    expect(inspected.ok).toBe(true);
    expect(inspected.ok && inspected.header.schemaFingerprint).toBeUndefined();
    // A save from before fingerprints still loads when its data is valid.
    const loaded = await loadSave(bytes, TABLES);
    expect(loaded.ok).toBe(true);
  });

  it('refuses a header fingerprint that is not 32 hex characters', async () => {
    const doc = testSaveDocument(tinyWorld().world, { schemaFingerprint: 'not-a-fingerprint' });
    const inspected = await inspectSave(await encodeSave(doc));
    expect(inspected).toMatchObject({ ok: false, stage: 'validate' });
  });
});
