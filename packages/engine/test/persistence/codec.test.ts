import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { NotSerialisableError } from '../../src/core/errors';
import {
  decodeSave,
  encodeSave,
  MAX_SAVE_BYTES,
  serialiseSaveDocument,
} from '../../src/persistence/codec';
import type { SaveDocument } from '../../src/persistence/save-document';
import { gzipJson } from '../support/gzip-json';
import { tinySaveDocument } from '../support/saves';

/** The same document with its keys created in a different order, at the top and inside a row. */
function reorderedKeys(doc: SaveDocument): SaveDocument {
  const [firstPerson, ...otherPeople] = doc.state.world.tables.people;
  if (firstPerson === undefined) {
    throw new Error('the document has no people');
  }
  // Destructuring and spreading back moves the field to the end of the object.
  const { fatigue, ...personRest } = firstPerson;
  const people = [{ ...personRest, fatigue }, ...otherPeople];
  const { label, ...headerRest } = doc.header;
  return {
    state: {
      ...doc.state,
      world: { ...doc.state.world, tables: { ...doc.state.world.tables, people } },
    },
    header: { ...headerRest, label },
    savedAt: doc.savedAt,
    formatVersion: doc.formatVersion,
    format: doc.format,
    engineVersion: doc.engineVersion,
  };
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function decodedText(bytes: Uint8Array): Promise<string> {
  const result = await decodeSave(bytes);
  if (!result.ok) {
    throw new Error(`decode failed: ${JSON.stringify(result.issues)}`);
  }
  return result.value;
}

describe('encodeSave', () => {
  it('writes gzip', async () => {
    const bytes = await encodeSave(tinySaveDocument());
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
  });

  it('gives byte-identical output for the same document', async () => {
    const first = await encodeSave(tinySaveDocument());
    const second = await encodeSave(tinySaveDocument());
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it('gives the same bytes whatever order the keys were created in', async () => {
    const doc = tinySaveDocument();
    const reordered = reorderedKeys(doc);
    expect(Object.keys(reordered)).not.toEqual(Object.keys(doc));
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(doc));
    const first = await encodeSave(doc);
    const second = await encodeSave(reordered);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });

  it('writes canonical JSON with sorted keys', async () => {
    const bytes = await encodeSave(tinySaveDocument());
    const text = gunzipSync(bytes).toString('utf8');
    expect(text.startsWith('{"engineVersion":"0.1.0","format":"ringside-booker/save"')).toBe(true);
    expect(text).toBe(serialiseSaveDocument(tinySaveDocument()));
  });

  it('refuses a non-finite number and names its path', async () => {
    const doc: SaveDocument = { ...tinySaveDocument() };
    const broken: SaveDocument = { ...doc, state: { ...doc.state, rng: { position: Number.NaN } } };
    await expect(encodeSave(broken)).rejects.toThrow(NotSerialisableError);
    await expect(encodeSave(broken)).rejects.toThrow('save.state.rng.position');
  });

  it('refuses an infinite number inside a row', async () => {
    const doc = structuredClone(tinySaveDocument());
    doc.state.world.tables.people[0]!.fatigue = Number.POSITIVE_INFINITY;
    await expect(encodeSave(doc)).rejects.toThrow('save.state.world.tables.people[0].fatigue');
  });
});

describe('decodeSave', () => {
  it('round-trips an encoded document', async () => {
    const doc = tinySaveDocument();
    const text = await decodedText(await encodeSave(doc));
    expect(JSON.parse(text)).toEqual(JSON.parse(serialiseSaveDocument(doc)));
  });

  it('accepts uncompressed JSON, with or without a BOM and leading whitespace', async () => {
    const text = serialiseSaveDocument(tinySaveDocument());
    expect(await decodedText(utf8(text))).toBe(text);
    expect(await decodedText(utf8(`\n  ${text}`))).toBe(`\n  ${text}`);
    expect(await decodedText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(text)]))).toBe(text);
  });

  it('refuses an empty file', async () => {
    const result = await decodeSave(new Uint8Array());
    expect(result).toMatchObject({ ok: false, stage: 'decode' });
  });

  it('refuses bytes that are neither gzip nor JSON', async () => {
    const result = await decodeSave(utf8('PK\u0003\u0004 a zip file'));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues[0]?.message).toMatch(/not a Ringside Booker save/);
  });

  it('refuses truncated gzip at the decode stage', async () => {
    const bytes = await encodeSave(tinySaveDocument());
    const result = await decodeSave(bytes.slice(0, Math.floor(bytes.length / 2)));
    expect(result).toMatchObject({ ok: false, stage: 'decode' });
    expect(!result.ok && result.issues[0]?.message).toMatch(/damaged or incomplete/);
  });

  it('refuses text that is not UTF-8', async () => {
    const result = await decodeSave(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]));
    expect(result).toMatchObject({ ok: false, stage: 'decode' });
    expect(!result.ok && result.issues[0]?.message).toMatch(/UTF-8/);
  });

  it('refuses a save over the size limit once unpacked, compressed or not', async () => {
    const big = `{"padding":"${'x'.repeat(5000)}"}`;
    const compressed = await decodeSave(gzipJson(big), { maxBytes: 1000 });
    expect(compressed).toMatchObject({ ok: false, stage: 'decode' });
    expect(!compressed.ok && compressed.issues[0]?.message).toMatch(/larger than/);
    const raw = await decodeSave(utf8(big), { maxBytes: 1000 });
    expect(raw).toMatchObject({ ok: false, stage: 'decode' });
    expect(await decodeSave(gzipJson(big), { maxBytes: 10_000 })).toMatchObject({ ok: true });
  });

  it('limits saves to 128 MB by default', () => {
    expect(MAX_SAVE_BYTES).toBe(128 * 1024 * 1024);
  });
});
