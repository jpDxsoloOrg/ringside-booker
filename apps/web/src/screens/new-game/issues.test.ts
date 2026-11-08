import { describe, expect, it } from 'vitest';
import type { PackIssue } from '@ringside/engine';
import {
  announcementFor,
  fieldMessage,
  firstStepWithIssue,
  issueFromPackIssue,
  issueFromReason,
  stepLevelIssues,
} from './issues';

describe('issueFromReason', () => {
  it.each([
    ['player.shortName', 'promotion', 'shortName'],
    ['player.name', 'promotion', 'name'],
    ['player.homeRegionKey', 'promotion', 'homeRegionKey'],
    ['player.promotionKey', 'promotion', 'promotionKey'],
    ['seasonLength.customWeeks', 'options', 'customWeeks'],
    ['settings.equalStart', 'options', 'setting.equalStart'],
    ['seed', 'options', 'seed'],
    ['startDate', 'options', 'startDate'],
    ['playerName', 'review', 'playerName'],
    ['saveName', 'review', 'saveName'],
    ['rootPackId', 'world', 'rootPackId'],
  ] as const)('puts a reason about %s on the %s step, field %s', (field, step, wizardField) => {
    expect(issueFromReason({ code: 'invalidArgs', message: 'Nope', field })).toEqual({
      step,
      field: wizardField,
      message: 'Nope',
    });
  });

  it('puts pack problems on the World step and other fieldless reasons on Review', () => {
    expect(issueFromReason({ code: 'packIssue', message: 'Broken pack' }).step).toBe('world');
    expect(issueFromReason({ code: 'setupStepFailed', message: 'A step broke' })).toEqual({
      step: 'review',
      field: null,
      message: 'A step broke',
    });
    expect(
      issueFromReason({
        code: 'invalidTunableOverride',
        message: 'x',
        field: 'tunableOverrides.a',
      }),
    ).toEqual({ step: 'options', field: null, message: 'x' });
  });
});

describe('issue helpers', () => {
  const packIssue: PackIssue = {
    severity: 'error',
    code: 'missing-file',
    packId: 'default-world',
    file: 'people.json',
    path: ['files', 'person'],
    message: 'people.json was not bundled',
  };

  it('describes a pack issue on the World step with its pack and file', () => {
    const issue = issueFromPackIssue(packIssue);
    expect(issue.step).toBe('world');
    expect(issue.message).toContain('default-world/people.json');
  });

  it('finds the earliest step with a problem and announces it', () => {
    const issues = [
      issueFromReason({ code: 'x', message: 'Name your save.', field: 'saveName' }),
      issueFromReason({ code: 'x', message: 'Short name taken.', field: 'player.shortName' }),
      issueFromReason({ code: 'x', message: 'Name taken.', field: 'player.name' }),
    ];
    expect(firstStepWithIssue(issues)).toBe('promotion');
    expect(firstStepWithIssue([])).toBeNull();
    expect(fieldMessage(issues, 'shortName')).toBe('Short name taken.');
    expect(announcementFor(issues)).toBe(
      '2 problems to fix on the Promotion step. Short name taken.',
    );
  });
});

describe('stepLevelIssues', () => {
  it('lists the problems no field of the step shows, and leaves out the ones a field shows', () => {
    const issues = [
      issueFromReason({ code: 'packIssue', message: 'The people file is broken.' }),
      issueFromReason({ code: 'x', message: 'No world.', field: 'rootPackId' }),
      issueFromReason({ code: 'x', message: 'Bad override.', field: 'tunableOverrides.cash' }),
      issueFromReason({ code: 'x', message: 'Bad setting.', field: 'settings.equalStart' }),
      issueFromReason({ code: 'x', message: 'Bad size.', field: 'player.size' }),
      issueFromReason({ code: 'x', message: 'Short name taken.', field: 'player.shortName' }),
    ];
    expect(stepLevelIssues(issues, 'world').map((issue) => issue.message)).toEqual([
      'The people file is broken.',
    ]);
    expect(stepLevelIssues(issues, 'options').map((issue) => issue.message)).toEqual([
      'Bad override.',
    ]);
    expect(stepLevelIssues(issues, 'promotion').map((issue) => issue.message)).toEqual([
      'Bad size.',
    ]);
    expect(stepLevelIssues(issues, 'review')).toEqual([]);
  });
});
