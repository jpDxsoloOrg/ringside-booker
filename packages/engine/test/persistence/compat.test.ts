// "Made with an older build" or a real bug. Design: docs/design/save-format.md#older-builds-until-the-format-freezes
import { describe, expect, it } from 'vitest';
import { classifyLoadFailure, COMPAT_GUARDED_STAGES } from '../../src/persistence/compat';
import { LOAD_STAGES, type LoadStage } from '../../src/persistence/report';

const CURRENT = '0123456789abcdef0123456789abcdef';
const OTHER = 'fedcba9876543210fedcba9876543210';

function isGuarded(stage: LoadStage | 'storage'): boolean {
  return COMPAT_GUARDED_STAGES.some((guarded) => guarded === stage);
}

describe('classifyLoadFailure', () => {
  it('guards the validate, build and integrity stages', () => {
    expect(COMPAT_GUARDED_STAGES).toEqual(['validate', 'build', 'integrity']);
  });

  it.each([...LOAD_STAGES, 'storage'] as const)(
    'stage %s: never an older build with the current fingerprint',
    (stage) => {
      expect(
        classifyLoadFailure({ stage, savedFingerprint: CURRENT, currentFingerprint: CURRENT }),
      ).toBeNull();
    },
  );

  it.each([...LOAD_STAGES, 'storage'] as const)(
    'stage %s: a different fingerprint is an older build only at a guarded stage',
    (stage) => {
      const compat = classifyLoadFailure({
        stage,
        savedFingerprint: OTHER,
        currentFingerprint: CURRENT,
      });
      expect(compat).toEqual(
        isGuarded(stage)
          ? { kind: 'olderBuild', savedFingerprint: OTHER, currentFingerprint: CURRENT }
          : null,
      );
    },
  );

  it.each([...LOAD_STAGES, 'storage'] as const)(
    'stage %s: a missing fingerprint counts as different',
    (stage) => {
      const compat = classifyLoadFailure({
        stage,
        savedFingerprint: null,
        currentFingerprint: CURRENT,
      });
      expect(compat).toEqual(
        isGuarded(stage)
          ? { kind: 'olderBuild', savedFingerprint: null, currentFingerprint: CURRENT }
          : null,
      );
    },
  );
});
