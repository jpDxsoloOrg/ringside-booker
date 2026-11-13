import { afterEach, describe, expect, it } from 'vitest';
import { decisionSummaryText, parseContentKey } from '@ringside/engine';
import { AIP_TEXT_CATALOG } from './catalogs/aip';
import {
  fillTemplate,
  registerTextCatalog,
  renderTemplatedText,
  textNamespaceOf,
} from './renderTemplatedText';
import type { TemplatedText } from './renderTemplatedText';

type EngineText = Parameters<typeof decisionSummaryText>[0];

function templated(key: string, params: TemplatedText['params'] = {}): EngineText {
  return { key: parseContentKey(key), params: { ...params } };
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('renderTemplatedText', () => {
  it('fills placeholders and leaves unknown ones as written', () => {
    expect(fillTemplate('{a} of {b}, {c}', { a: 2, b: 'four' })).toBe('2 of four, {c}');
  });

  it('renders a key no catalog knows as the key itself', () => {
    expect(renderTemplatedText(templated('nobody.knows-this'))).toBe('nobody.knows-this');
    expect(renderTemplatedText(templated('aip.decision.card'))).toBe('aip.decision.card');
  });

  it('uses a registered catalog, template or function, until it is removed', () => {
    cleanups.push(
      registerTextCatalog('testtext', {
        'testtext.plain': 'Hello {name}',
        'testtext.fn': (params) => `Count ${String(params['count'])}`,
      }),
    );
    expect(renderTemplatedText(templated('testtext.plain', { name: 'Ada' }))).toBe('Hello Ada');
    expect(renderTemplatedText(templated('testtext.fn', { count: 3 }))).toBe('Count 3');
    cleanups.pop()?.();
    expect(renderTemplatedText(templated('testtext.plain'))).toBe('testtext.plain');
  });

  it('refuses a key outside its namespace and a second catalog for a namespace', () => {
    expect(() => registerTextCatalog('testtext', { 'other.key': 'x' })).toThrow(/outside/);
    cleanups.push(registerTextCatalog('testtext', { 'testtext.a': 'a' }));
    expect(() => registerTextCatalog('testtext', { 'testtext.b': 'b' })).toThrow(/already/);
    expect(textNamespaceOf('aip.need.depth')).toBe('aip');
  });
});

describe('the aip catalog', () => {
  const samples: readonly EngineText[] = [
    templated('aip.decision.roster-review', { count: 0 }),
    templated('aip.decision.roster-review', { name: 'Test Promotion B' }),
    templated('aip.decision.roster-review', { count: 1, top: 'Short on heels' }),
    templated('aip.decision.roster-review', { count: 3, top: 'Thin at main event: 2 of 4' }),
    templated('aip.need.depth', { band: 'Main event', have: 2, target: 4 }),
    templated('aip.need.alignment.heels', { faces: 9, heels: 3 }),
    templated('aip.need.alignment.faces', { faces: 3, heels: 9 }),
    templated('aip.need.gender', { division: "Women's division", have: 2, target: 4 }),
    templated('aip.need.champion-gone', { title: 'World Title' }),
    templated('aip.need.champion-unfit', { title: 'World Title', names: 'Ada', reason: 'injured' }),
    templated('aip.need.champion-ending', {
      title: 'World Title',
      names: 'Ada',
      date: '2026-05-01',
    }),
    templated('aip.need.crew', { role: 'referees', have: 1, target: 2 }),
    templated('aip.decision.card-booked', {
      show: 'Monday Night Brawl',
      matches: 5,
      talking: 2,
      titles: 1,
    }),
    templated('aip.decision.card-booked', {
      show: 'House Show',
      matches: 1,
      talking: 1,
      titles: 0,
    }),
    templated('aip.decision.show-cancelled', {
      show: 'Thin Weekly',
      reason: 'Only 3 wrestlers available, needs 5',
    }),
  ];

  it('has a string for every rival desk key', () => {
    expect(Object.keys(AIP_TEXT_CATALOG).sort()).toEqual(
      [...new Set(samples.map((sample) => sample.key))].sort(),
    );
  });

  it.each(samples)('says $key the way the engine does', (sample) => {
    expect(renderTemplatedText(sample)).toBe(decisionSummaryText(sample));
  });
});
