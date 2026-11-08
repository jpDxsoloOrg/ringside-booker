// @vitest-environment node
// Node's File, Blob and CompressionStream match the browser's; jsdom's File has no arrayBuffer().
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  countAllBlobs,
  countSlotBlobs,
  expectOk,
  makeTestSave,
  readSlotBlobs,
  resetSaveDb,
  type TestSave,
} from '@/test/saves';
import {
  createSlot,
  deleteSlot,
  duplicateSlot,
  getSlot,
  listSlots,
  loadFromSlot,
  renameSlot,
  saveToSlot,
  writeAutosave,
} from './save-slots';

afterEach(async () => {
  vi.restoreAllMocks();
  await resetSaveDb();
});

/** A slot created on 2027-01-01, then saved manually on each of `gameDates` in order. */
async function slotWithManualSaves(gameDates: readonly string[]): Promise<string> {
  const first = await makeTestSave({ label: 'Save 0', gameDate: '2027-01-01' });
  const slot = expectOk(await createSlot('Career', first.bytes, first.header, first.meta));
  for (const [index, gameDate] of gameDates.entries()) {
    const save = await makeTestSave({
      label: `Save ${String(index + 1)}`,
      gameDate,
      savedAt: `2026-11-08T12:0${String(index + 1)}:00.000Z`,
    });
    expectOk(await saveToSlot(slot.slotId, save.bytes, save.header, save.meta));
  }
  return slot.slotId;
}

function gameDatesByKind(
  blobs: Awaited<ReturnType<typeof readSlotBlobs>>,
): Record<string, string | undefined> {
  return Object.fromEntries([...blobs].map(([kind, record]) => [kind, record.gameDate]));
}

describe('createSlot and listSlots', () => {
  it('lists a new slot with its header', async () => {
    const save = await makeTestSave({ label: 'Opening night' });
    const created = expectOk(await createSlot('My career', save.bytes, save.header, save.meta));

    const slots = expectOk(await listSlots());
    expect(slots).toHaveLength(1);
    expect(slots[0]).toEqual(created);
    expect(slots[0]?.label).toBe('My career');
    expect(slots[0]?.header).toEqual(save.header);
    expect(slots[0]?.sizes).toEqual({ current: save.bytes.byteLength, autosave: null });
    expect(slots[0]?.backups).toEqual([]);
    expect(await countSlotBlobs(created.slotId)).toBe(1);
  });

  it('lists the most recently written slot first', async () => {
    const older = await makeTestSave({ savedAt: '2026-11-01T10:00:00.000Z' });
    const newer = await makeTestSave({ savedAt: '2026-11-02T10:00:00.000Z' });
    const first = expectOk(await createSlot('Older', older.bytes, older.header, older.meta));
    const second = expectOk(await createSlot('Newer', newer.bytes, newer.header, newer.meta));
    expect(expectOk(await listSlots()).map((slot) => slot.slotId)).toEqual([
      second.slotId,
      first.slotId,
    ]);

    const later = await makeTestSave({ savedAt: '2026-11-03T10:00:00.000Z' });
    expectOk(await saveToSlot(first.slotId, later.bytes, later.header, later.meta));
    expect(expectOk(await listSlots()).map((slot) => slot.slotId)).toEqual([
      first.slotId,
      second.slotId,
    ]);
  });
});

describe('saveToSlot backup rotation', () => {
  it('keeps current and three backups after four manual saves, dropping the oldest', async () => {
    const slotId = await slotWithManualSaves([
      '2027-01-08',
      '2027-01-15',
      '2027-01-22',
      '2027-01-29',
    ]);

    const blobs = await readSlotBlobs(slotId);
    expect(gameDatesByKind(blobs)).toEqual({
      current: '2027-01-29',
      'backup-1': '2027-01-22',
      'backup-2': '2027-01-15',
      'backup-3': '2027-01-08',
    });
    // The 2027-01-01 save fell off the end.
    expect(blobs.size).toBe(4);

    const fourth = await makeTestSave({
      label: 'Save 4',
      gameDate: '2027-01-29',
      savedAt: '2026-11-08T12:04:00.000Z',
    });
    const third = await makeTestSave({
      label: 'Save 3',
      gameDate: '2027-01-22',
      savedAt: '2026-11-08T12:03:00.000Z',
    });
    expect(blobs.get('current')?.bytes).toEqual(fourth.bytes);
    expect(blobs.get('backup-1')?.bytes).toEqual(third.bytes);

    const slot = expectOk(await getSlot(slotId));
    expect(slot.header.gameDate).toBe('2027-01-29');
    expect(slot.backups.map((meta) => [meta.kind, meta.gameDate, meta.reason])).toEqual([
      ['backup-1', '2027-01-22', 'manualSave'],
      ['backup-2', '2027-01-15', 'manualSave'],
      ['backup-3', '2027-01-08', 'manualSave'],
    ]);
  });

  it('reports notFound for a slot that does not exist', async () => {
    const save = await makeTestSave();
    const result = await saveToSlot('missing', save.bytes, save.header, save.meta);
    expect(result).toMatchObject({ ok: false, error: { code: 'notFound', slotId: 'missing' } });
  });

  it.each([
    ['in the middle of the backup shift', 3],
    ['when writing the new current save', 4],
    ['when updating the slot record', 5],
  ])('leaves current and backups untouched when a write fails %s', async (_case, failingPut) => {
    const slotId = await slotWithManualSaves([
      '2027-01-08',
      '2027-01-15',
      '2027-01-22',
      '2027-01-29',
    ]);
    const before = await readSlotBlobs(slotId);
    const slotBefore = expectOk(await getSlot(slotId));

    // eslint-disable-next-line @typescript-eslint/unbound-method -- called below with the store as `this`
    const originalPut = IDBObjectStore.prototype.put;
    let putCalls = 0;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      putCalls += 1;
      if (putCalls === failingPut) {
        throw new DOMException('The disk went away.', 'UnknownError');
      }
      return originalPut.apply(this, args);
    });

    const fifth = await makeTestSave({ label: 'Save 5', gameDate: '2027-02-05' });
    const result = await saveToSlot(slotId, fifth.bytes, fifth.header, fifth.meta);
    vi.restoreAllMocks();

    expect(result).toMatchObject({ ok: false, error: { code: 'writeFailed' } });
    expect(putCalls).toBeGreaterThanOrEqual(failingPut);
    expect(await readSlotBlobs(slotId)).toEqual(before);
    expect(expectOk(await getSlot(slotId))).toEqual(slotBefore);
  });
});

describe('writeAutosave', () => {
  it('writes the autosave and records it on the slot', async () => {
    const manual = await makeTestSave({ gameDate: '2027-03-01' });
    const slot = expectOk(await createSlot('Career', manual.bytes, manual.header, manual.meta));
    const auto = await makeTestSave({
      label: 'Autosave',
      gameDate: '2027-03-08',
      savedAt: '2026-11-08T13:00:00.000Z',
    });

    const updated = expectOk(
      await writeAutosave(slot.slotId, auto.bytes, auto.header, auto.meta, {
        monthlyBackup: false,
      }),
    );

    expect(updated.lastAutosaveAt).toBe('2026-11-08T13:00:00.000Z');
    expect(updated.sizes.autosave).toBe(auto.bytes.byteLength);
    expect(updated.header.gameDate).toBe('2027-03-08');
    expect(updated.backups).toEqual([]);
    expect(gameDatesByKind(await readSlotBlobs(slot.slotId))).toEqual({
      current: '2027-03-01',
      autosave: '2027-03-08',
    });
  });

  it('rotates the newest of current and autosave into the backups for a monthly backup', async () => {
    const manual = await makeTestSave({ gameDate: '2027-03-01' });
    const slot = expectOk(await createSlot('Career', manual.bytes, manual.header, manual.meta));
    const firstAuto = await makeTestSave({
      label: 'March autosave',
      gameDate: '2027-03-29',
      savedAt: '2026-11-08T13:00:00.000Z',
    });
    expectOk(
      await writeAutosave(slot.slotId, firstAuto.bytes, firstAuto.header, firstAuto.meta, {
        monthlyBackup: false,
      }),
    );
    const aprilAuto = await makeTestSave({
      label: 'April autosave',
      gameDate: '2027-04-02',
      savedAt: '2026-11-08T14:00:00.000Z',
    });

    const updated = expectOk(
      await writeAutosave(slot.slotId, aprilAuto.bytes, aprilAuto.header, aprilAuto.meta, {
        monthlyBackup: true,
      }),
    );

    const blobs = await readSlotBlobs(slot.slotId);
    expect(gameDatesByKind(blobs)).toEqual({
      current: '2027-03-01',
      autosave: '2027-04-02',
      'backup-1': '2027-03-29',
    });
    expect(blobs.get('backup-1')?.bytes).toEqual(firstAuto.bytes);
    expect(updated.backups).toMatchObject([
      { kind: 'backup-1', gameDate: '2027-03-29', reason: 'monthly' },
    ]);
  });
});

describe('loadFromSlot', () => {
  async function slotWithCurrentAndAutosave(
    currentSavedAt: string,
    autosaveSavedAt: string,
  ): Promise<{ slotId: string; manual: TestSave; auto: TestSave }> {
    const manual = await makeTestSave({ label: 'Manual', savedAt: currentSavedAt });
    const slot = expectOk(await createSlot('Career', manual.bytes, manual.header, manual.meta));
    const auto = await makeTestSave({ label: 'Auto', savedAt: autosaveSavedAt });
    expectOk(
      await writeAutosave(slot.slotId, auto.bytes, auto.header, auto.meta, {
        monthlyBackup: false,
      }),
    );
    return { slotId: slot.slotId, manual, auto };
  }

  it('picks the autosave for latest when it is newer', async () => {
    const { slotId, auto } = await slotWithCurrentAndAutosave(
      '2026-11-08T12:00:00.000Z',
      '2026-11-08T12:30:00.000Z',
    );
    const loaded = expectOk(await loadFromSlot(slotId, 'latest'));
    expect(loaded.kind).toBe('autosave');
    expect(loaded.savedAt).toBe('2026-11-08T12:30:00.000Z');
    expect(loaded.bytes).toEqual(auto.bytes);
  });

  it('picks the current save for latest when it is newer', async () => {
    const { slotId, manual } = await slotWithCurrentAndAutosave(
      '2026-11-08T12:00:00.000Z',
      '2026-11-08T11:00:00.000Z',
    );
    const loaded = expectOk(await loadFromSlot(slotId));
    expect(loaded.kind).toBe('current');
    expect(loaded.bytes).toEqual(manual.bytes);
  });

  it('loads a named kind and reports notFound for one that is missing', async () => {
    const slotId = await slotWithManualSaves(['2027-01-08']);
    const backup = expectOk(await loadFromSlot(slotId, 'backup-1'));
    expect(backup.kind).toBe('backup-1');
    expect(await loadFromSlot(slotId, 'backup-2')).toMatchObject({
      ok: false,
      error: { code: 'notFound', slotId, kind: 'backup-2' },
    });
    expect(await loadFromSlot('missing')).toMatchObject({
      ok: false,
      error: { code: 'notFound', slotId: 'missing', kind: null },
    });
  });
});

describe('renameSlot, duplicateSlot and deleteSlot', () => {
  it('renames a slot without touching its saves', async () => {
    const slotId = await slotWithManualSaves(['2027-01-08']);
    const before = await readSlotBlobs(slotId);
    const renamed = expectOk(await renameSlot(slotId, 'Renamed'));
    expect(renamed.label).toBe('Renamed');
    expect(expectOk(await getSlot(slotId)).label).toBe('Renamed');
    expect(await readSlotBlobs(slotId)).toEqual(before);
  });

  it('duplicates a slot with every blob under a new ID', async () => {
    const slotId = await slotWithManualSaves(['2027-01-08', '2027-01-15']);
    const original = await readSlotBlobs(slotId);

    const copy = expectOk(await duplicateSlot(slotId));
    expect(copy.slotId).not.toBe(slotId);
    expect(copy.label).toBe('Career (copy)');

    const copied = await readSlotBlobs(copy.slotId);
    expect(copied.size).toBe(original.size);
    for (const [kind, record] of original) {
      expect(copied.get(kind)).toEqual({ ...record, slotId: copy.slotId });
    }
    expect(expectOk(await listSlots())).toHaveLength(2);
  });

  it('deletes the record and every blob of a slot and nothing else', async () => {
    const doomed = await slotWithManualSaves(['2027-01-08', '2027-01-15', '2027-01-22']);
    const kept = await slotWithManualSaves(['2027-02-01']);
    expect(await countSlotBlobs(doomed)).toBe(4);

    expectOk(await deleteSlot(doomed));

    expect(await countSlotBlobs(doomed)).toBe(0);
    expect(await countSlotBlobs(kept)).toBe(2);
    expect(await countAllBlobs()).toBe(2);
    expect(expectOk(await listSlots()).map((slot) => slot.slotId)).toEqual([kept]);
    expect(await getSlot(doomed)).toMatchObject({ ok: false, error: { code: 'notFound' } });
  });
});
