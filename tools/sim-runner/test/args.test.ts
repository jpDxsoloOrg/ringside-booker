import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FIXTURE_PEOPLE,
  DEFAULT_SEED,
  parseRunnerArgs,
  type ArgumentError,
  type RunnerOptions,
} from '../src/args';

function optionsFor(argv: readonly string[]): RunnerOptions {
  const parsed = parseRunnerArgs(argv);
  if (parsed.kind !== 'options') {
    throw new Error(`Expected options, got ${JSON.stringify(parsed)}`);
  }
  return parsed.options;
}

function errorsFor(argv: readonly string[]): readonly ArgumentError[] {
  const parsed = parseRunnerArgs(argv);
  if (parsed.kind !== 'errors') {
    throw new Error(`Expected argument errors, got ${JSON.stringify(parsed)}`);
  }
  return parsed.errors;
}

function codesFor(argv: readonly string[]): string[] {
  return errorsFor(argv).map((error) => error.code);
}

describe('parseRunnerArgs', () => {
  it('fills in the defaults', () => {
    expect(optionsFor(['--days', '30'])).toEqual({
      days: 30,
      seed: DEFAULT_SEED,
      world: { kind: 'fixture', fixture: 'roster' },
      people: DEFAULT_FIXTURE_PEOPLE,
      tunables: [],
      json: false,
      checkDeterminism: false,
      strict: false,
      failOnEvents: ['aip.jobFailed'],
      trace: null,
    });
  });

  it('reads every option', () => {
    expect(
      optionsFor([
        '--days',
        '365',
        '--seed',
        'seven',
        '--world',
        'saves/state.json',
        '--people',
        '20',
        '--json',
        '--check-determinism',
        '--strict',
        '--trace',
        'condition.fatigueRecovery:per_0000000001',
      ]),
    ).toEqual({
      days: 365,
      seed: 'seven',
      world: { kind: 'file', path: 'saves/state.json' },
      people: 20,
      tunables: [],
      json: true,
      checkDeterminism: true,
      strict: true,
      failOnEvents: ['aip.jobFailed'],
      trace: { kind: 'condition.fatigueRecovery', id: 'per_0000000001' },
    });
  });

  it('replaces the default --strict event types with the repeated --fail-on-event', () => {
    expect(
      optionsFor(['--days', '1', '--fail-on-event', 'show.cancelled', '--fail-on-event', 'x.y'])
        .failOnEvents,
    ).toEqual(['show.cancelled', 'x.y']);
  });

  it('rejects a --fail-on-event that is not an event type', () => {
    expect(codesFor(['--days', '1', '--fail-on-event', 'jobFailed'])).toEqual(['invalidEventType']);
  });

  it('reports a missing --days', () => {
    expect(codesFor([])).toEqual(['missingDays']);
  });

  it.each(['0', '36501', '-3', '1.5', 'ten'])('rejects --days %s', (days) => {
    expect(codesFor([`--days=${days}`])).toEqual(['invalidDays']);
  });

  it('accepts both ends of the --days range', () => {
    expect(optionsFor(['--days', '1']).days).toBe(1);
    expect(optionsFor(['--days', '36500']).days).toBe(36500);
  });

  it.each(['0', '5001'])('rejects --people %s', (people) => {
    expect(codesFor(['--days', '1', '--people', people])).toEqual(['invalidPeople']);
  });

  it('parses --tunable condition.fatigueRecoveryPerDay=0 to the number 0', () => {
    expect(
      optionsFor(['--days', '1', '--tunable', 'condition.fatigueRecoveryPerDay=0']).tunables,
    ).toEqual([{ key: 'condition.fatigueRecoveryPerDay', value: 0 }]);
  });

  it('keeps every repeated --tunable in order', () => {
    expect(
      optionsFor([
        '--days',
        '1',
        '--tunable',
        'condition.fatigueRecoveryPerDay=2.5',
        '--tunable',
        'sim.eventLogSize=50',
      ]).tunables,
    ).toEqual([
      { key: 'condition.fatigueRecoveryPerDay', value: 2.5 },
      { key: 'sim.eventLogSize', value: 50 },
    ]);
  });

  it('reports --tunable nope=1 as an unknown key', () => {
    const [error, ...others] = errorsFor(['--days', '1', '--tunable', 'nope=1']);
    expect(others).toEqual([]);
    expect(error?.code).toBe('unknownKey');
    expect(error?.message).toContain('"nope"');
  });

  it('reports --tunable sim.eventLogSize=2.5 as not an integer', () => {
    const [error] = errorsFor(['--days', '1', '--tunable', 'sim.eventLogSize=2.5']);
    expect(error?.code).toBe('notInteger');
    expect(error?.message).toContain('whole number');
  });

  it('reports a value outside the tunable range and a value that is not a number', () => {
    expect(
      codesFor([
        '--days',
        '1',
        '--tunable',
        'condition.fatigueRecoveryPerDay=101',
        '--tunable',
        'condition.fatigueRecoveryPerDay=fast',
        '--tunable',
        'no-equals-sign',
      ]),
    ).toEqual(['aboveMax', 'wrongType', 'invalidTunable']);
  });

  it('lists every problem at once', () => {
    expect(codesFor(['--days', '0', '--people', '0', '--trace', 'no-colon'])).toEqual([
      'invalidDays',
      'invalidPeople',
      'invalidTrace',
    ]);
  });

  it('rejects an unknown fixture and an unknown option', () => {
    expect(codesFor(['--days', '1', '--world', 'fixture:other'])).toEqual(['invalidWorld']);
    expect(codesFor(['--days', '1', '--skip-gates'])).toEqual(['unknownOption']);
  });

  it('returns help for --help', () => {
    expect(parseRunnerArgs(['--help'])).toEqual({ kind: 'help' });
  });
});
