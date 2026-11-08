import { describe, expect, it } from 'vitest';
import { parseGameDate } from '../../../src/core/date';
import {
  InvalidIdError,
  InvalidStatePartError,
  PipelineError,
  SERIALIZED_STACK_MAX_LENGTH,
  serializeError,
} from '../../../src/core/errors';
import {
  PIPELINE_FAILURE_LOG_CAPACITY,
  PipelineFailureLog,
  pipelineFailureLogStateSchema,
  type PipelineFailure,
} from '../../../src/core/pipeline';

const DATE = parseGameDate('2026-01-05');

function failure(index: number): PipelineFailure {
  return {
    date: DATE,
    stepId: `test.step${String(index)}`,
    error: { name: 'Error', message: `#${String(index)}` },
  };
}

describe('serializeError', () => {
  it('keeps the name, message, code and stack of an engine error', () => {
    const serialized = serializeError(new InvalidIdError('person', 'nope'));
    expect(serialized).toMatchObject({
      name: 'InvalidIdError',
      message: 'Expected a person ID, got "nope"',
      code: 'INVALID_ID',
    });
    expect(serialized.stack).toContain('InvalidIdError');
  });

  it('keeps a plain error without a code', () => {
    const serialized = serializeError(new TypeError('bad'));
    expect(serialized.name).toBe('TypeError');
    expect(serialized.message).toBe('bad');
    expect(serialized).not.toHaveProperty('code');
  });

  it('trims very long stacks', () => {
    const error = new Error('deep');
    error.stack = 'x'.repeat(SERIALIZED_STACK_MAX_LENGTH * 2);
    expect(serializeError(error).stack).toHaveLength(SERIALIZED_STACK_MAX_LENGTH);
  });

  it.each([
    ['a string', 'oops', 'oops'],
    ['a number', 42, '42'],
    ['undefined', undefined, 'undefined'],
    ['null', null, 'null'],
    ['an object', { reason: 'x' }, '[object Object]'],
  ])('turns %s into NonErrorThrown', (_label, value, message) => {
    expect(serializeError(value)).toEqual({ name: 'NonErrorThrown', message });
  });

  it('copes with a thrown value that cannot be turned into a string', () => {
    const stubborn: unknown = Object.create(null);
    expect(serializeError(stubborn)).toEqual({
      name: 'NonErrorThrown',
      message: 'a value of type object',
    });
  });

  it('gives the pipeline error classes their codes', () => {
    expect(serializeError(new PipelineError('bad phase'))).toMatchObject({
      name: 'PipelineError',
      code: 'PIPELINE',
    });
  });
});

describe('PipelineFailureLog', () => {
  it('keeps only the newest 100 failures, oldest first', () => {
    const log = new PipelineFailureLog();
    for (let i = 1; i <= PIPELINE_FAILURE_LOG_CAPACITY + 5; i++) {
      log.record(failure(i));
    }
    expect(log.size).toBe(PIPELINE_FAILURE_LOG_CAPACITY);
    const entries = log.recent();
    expect(entries[0]?.stepId).toBe('test.step6');
    expect(entries.at(-1)?.stepId).toBe('test.step105');
    expect(log.recent(2).map((entry) => entry.stepId)).toEqual(['test.step104', 'test.step105']);
    expect(log.recent(0)).toEqual([]);
  });

  it('round-trips through its saved state and JSON', () => {
    const log = new PipelineFailureLog();
    log.record(failure(1));
    log.record({
      ...failure(2),
      error: { name: 'Error', message: 'x', code: 'PIPELINE', stack: 'at y' },
    });
    const state = JSON.parse(JSON.stringify(log.toState())) as unknown;
    expect(pipelineFailureLogStateSchema.safeParse(state).success).toBe(true);
    expect(PipelineFailureLog.fromState(state).toState()).toEqual(log.toState());
  });

  it('copies entries so callers cannot change the log', () => {
    const log = new PipelineFailureLog();
    const entry = failure(1);
    log.record(entry);
    entry.error.message = 'changed';
    const [stored] = log.recent();
    if (stored === undefined) {
      throw new Error('expected an entry');
    }
    stored.stepId = 'changed';
    expect(log.recent()[0]).toEqual(failure(1));
  });

  it('rejects a malformed state and names the bad field', () => {
    expect(() =>
      PipelineFailureLog.fromState({
        version: 1,
        entries: [{ date: '2026-13-01', stepId: '', error: { name: 'Error' } }],
      }),
    ).toThrow(InvalidStatePartError);
    expect(() => PipelineFailureLog.fromState({ version: 2, entries: [] })).toThrow(/version/);
    const tooMany = { version: 1, entries: Array.from({ length: 101 }, (_, i) => failure(i)) };
    expect(() => PipelineFailureLog.fromState(tooMany)).toThrow(/at most 100/);
  });

  it('keeps nothing with a capacity of 0', () => {
    const log = new PipelineFailureLog(0);
    log.record(failure(1));
    expect(log.size).toBe(0);
    expect(() => new PipelineFailureLog(-1)).toThrow(/capacity/);
  });
});
