import { describe, expect, it } from 'vitest';
import { newsTopics } from '@ringside/engine';
import type { NewsTopic } from '@ringside/engine';
import { textFor } from '../catalog';
import type { TextParams, TextTemplate } from '../catalog';
import { NEWS_TEXT_CATALOG } from './news.en';

/** No story mentions a length of time on the clock (D-10). */
const CLOCK_WORDS = /\bminutes?\b|\bmins?\b|\bhours?\b/i;
const PLACEHOLDER = /\{([A-Za-z0-9_]+)(?::[A-Za-z]+)?\}/g;

/**
 * The texts a template can produce: a string as written; a function called with every declared
 * param, with each one left out in turn, and with one and with several people in id params, so
 * every branch it takes is checked.
 */
function variantsOf(template: TextTemplate, declared: readonly string[]): string[] {
  if (typeof template === 'string') return [template];
  const full = (value: string | number): Record<string, string | number> =>
    Object.fromEntries(declared.map((name) => [name, value]));
  const paramSets: TextParams[] = [full(1), full(2), full('per_0000000001,per_0000000002')];
  for (const name of declared) {
    const without = full(2);
    delete without[name];
    paramSets.push(without);
  }
  return paramSets.map((params) => template(params));
}

function placeholdersOf(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '');
}

const topics: readonly NewsTopic[] = newsTopics();

describe('the news text catalog', () => {
  it('covers the topics DAY1 posts', () => {
    expect(topics.map((topic) => topic.topic)).toEqual(
      expect.arrayContaining([
        'season-start',
        'reign-milestone',
        'reign-record',
        'career-anniversary',
        'promotion-anniversary',
      ]),
    );
  });

  it.each(topics.map((topic) => [topic.topic, topic] as const))(
    'has a headline and a body for %s, using only its declared params',
    (_name, topic) => {
      for (const key of [topic.headlineKey, topic.bodyKey]) {
        const template = textFor(key);
        expect(template, key).toBeDefined();
        if (template === undefined) continue;
        for (const text of variantsOf(template, topic.params)) {
          for (const param of placeholdersOf(text)) {
            expect(topic.params, `${key} uses {${param}}`).toContain(param);
          }
          expect(text, key).not.toMatch(CLOCK_WORDS);
        }
      }
    },
  );

  it('holds no key for a topic nobody registers', () => {
    const known = new Set(topics.flatMap((topic) => [topic.headlineKey, topic.bodyKey]));
    for (const key of Object.keys(NEWS_TEXT_CATALOG)) {
      expect(known.has(key), key).toBe(true);
    }
  });
});
