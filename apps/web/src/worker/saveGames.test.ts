import { describe, expect, it } from 'vitest';
import { engineSaveSchemaFingerprint } from '@ringside/engine';
import { damagedGoldenSave, goldenSaveBytes, olderBuildSaveBytes } from '@/test/goldenSave';
import { decodeSaveBytes, stageFailure, storageLoadFailure, withCompat } from './saveGames';

describe('decodeSaveBytes: older builds', () => {
  it('reads the frozen older-build save as made with an older build', async () => {
    const decoded = await decodeSaveBytes(olderBuildSaveBytes());

    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.stage).toBe('validate');
    expect(decoded.issues.some((issue) => issue.path.startsWith('state.world.tables.people'))).toBe(
      true,
    );
    expect(decoded.compat).toEqual({
      kind: 'olderBuild',
      savedFingerprint: null,
      currentFingerprint: engineSaveSchemaFingerprint(),
    });
  });

  it("keeps a broken save with this build's fingerprint as a plain failure", async () => {
    const decoded = await decodeSaveBytes(
      damagedGoldenSave(['state', 'world', 'tables', 'people'], [1]),
    );

    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.stage).toBe('validate');
    expect(decoded.compat).toBeNull();
  });

  it('loads the current golden save', async () => {
    expect((await decodeSaveBytes(await goldenSaveBytes())).ok).toBe(true);
  });
});

describe('withCompat', () => {
  it('marks a build-stage failure of a save without a fingerprint', async () => {
    const failure = await withCompat(stageFailure('build', 'boom'), olderBuildSaveBytes());
    expect(failure.compat?.kind).toBe('olderBuild');
    expect(failure.issues).toEqual([{ path: '', message: 'boom' }]);
  });

  it('leaves a failure at a stage that is not guarded alone', async () => {
    expect(
      (await withCompat(stageFailure('version', 'newer'), olderBuildSaveBytes())).compat,
    ).toBeNull();
    const storageFailure = storageLoadFailure({
      code: 'notFound',
      message: 'gone',
      slotId: 'missing',
      kind: null,
    });
    expect((await withCompat(storageFailure, olderBuildSaveBytes())).compat).toBeNull();
  });

  it('leaves the failure alone when the header cannot be read', async () => {
    const failure = await withCompat(stageFailure('build', 'boom'), new Uint8Array([1, 2, 3]));
    expect(failure.compat).toBeNull();
  });
});
