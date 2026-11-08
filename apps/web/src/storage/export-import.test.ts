// @vitest-environment node
// Node's File, Blob and CompressionStream match the browser's; jsdom's File has no arrayBuffer().
import { inspectSave, loadSave, TABLES } from '@ringside/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectOk, makeTestSave, resetSaveDb } from '@/test/saves';
import { MAX_IMPORT_BYTES, SAVE_FILE_MIME_TYPE } from './constants';
import { isStorageError } from './errors';
import { exportSlot, importSaveFile, saveFileName, slugifyLabel } from './export-import';
import { createSlot, listSlots, loadFromSlot } from './save-slots';

afterEach(async () => {
  vi.restoreAllMocks();
  await resetSaveDb();
});

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe('save file names', () => {
  it('slugs the label and appends the game date', () => {
    expect(saveFileName('My Save: Year 2!', '2027-03-14')).toBe('my-save-year-2-2027-03-14.rbsave');
  });

  it('drops accents, collapses separators and caps the slug at 40 characters', () => {
    expect(slugifyLabel('  Café -- Ölmütz  ')).toBe('cafe-olmutz');
    const slug = slugifyLabel('A very long label that keeps going well past the limit');
    expect(slug).toBe('a-very-long-label-that-keeps-going-well');
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slugifyLabel('!!!')).toBe('save');
  });
});

describe('exportSlot', () => {
  it('exports exactly the stored bytes with the slot label and the save game date', async () => {
    const save = await makeTestSave({ gameDate: '2027-03-14' });
    const slot = expectOk(await createSlot('My Save: Year 2!', save.bytes, save.header, save.meta));

    const exported = expectOk(await exportSlot(slot.slotId));

    expect(exported.fileName).toBe('my-save-year-2-2027-03-14.rbsave');
    expect(exported.blob.type).toBe(SAVE_FILE_MIME_TYPE);
    const stored = expectOk(await loadFromSlot(slot.slotId, 'current'));
    expect(await blobBytes(exported.blob)).toEqual(stored.bytes);
    expect(await blobBytes(exported.blob)).toEqual(save.bytes);
  });

  it('reports notFound for a missing slot', async () => {
    expect(await exportSlot('missing')).toMatchObject({ ok: false, error: { code: 'notFound' } });
  });
});

describe('importSaveFile', () => {
  it('imports an exported file as a new slot that loads to the same document', async () => {
    const save = await makeTestSave({ label: 'Before the big show' });
    const source = expectOk(await createSlot('Source', save.bytes, save.header, save.meta));
    const exported = expectOk(await exportSlot(source.slotId));
    const file = new File([exported.blob], exported.fileName, { type: exported.blob.type });

    const imported = await importSaveFile(file, inspectSave);
    if (!imported.ok) {
      throw new Error(`Import failed: ${JSON.stringify(imported.error)}`);
    }

    expect(imported.slot.slotId).not.toBe(source.slotId);
    expect(imported.slot.label).toBe('Before the big show (imported)');
    expect(imported.slot.header).toEqual(save.header);
    expect(expectOk(await listSlots())).toHaveLength(2);

    const loadedBytes = expectOk(await loadFromSlot(imported.slot.slotId)).bytes;
    expect(loadedBytes).toEqual(save.bytes);
    const report = await loadSave(loadedBytes, TABLES);
    if (!report.ok) {
      throw new Error(`Load failed at ${report.stage}`);
    }
    expect(report.doc).toEqual(save.doc);
  });

  it('refuses a file over 64 MB without reading it', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'huge.rbsave');
    Object.defineProperty(file, 'size', { value: 65 * 1024 * 1024 });
    const readSpy = vi.spyOn(file, 'arrayBuffer');
    const inspect = vi.fn(inspectSave);

    const result = await importSaveFile(file, inspect);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'tooLarge', sizeBytes: 65 * 1024 * 1024, limitBytes: MAX_IMPORT_BYTES },
    });
    expect(readSpy).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(expectOk(await listSlots())).toEqual([]);
  });

  it('returns the inspect failure for random bytes and creates no slot', async () => {
    const randomBytes = new Uint8Array(256);
    for (let i = 0; i < randomBytes.length; i += 1) {
      randomBytes[i] = (i * 73 + 41) % 256;
    }
    const file = new File([randomBytes], 'noise.rbsave');

    const result = await importSaveFile(file, inspectSave);

    if (result.ok) {
      throw new Error('Expected the import to fail');
    }
    expect(isStorageError(result.error)).toBe(false);
    expect(result.error).toMatchObject({ ok: false, stage: 'decode' });
    expect(expectOk(await listSlots())).toEqual([]);
  });

  it('reports readFailed when the inspector itself rejects', async () => {
    const save = await makeTestSave();
    const file = new File([save.bytes.slice()], 'save.rbsave');
    const result = await importSaveFile(file, async () => {
      await Promise.resolve();
      throw new Error('worker crashed');
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'readFailed' } });
  });
});
