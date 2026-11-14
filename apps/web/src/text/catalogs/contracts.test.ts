import { describe, expect, it } from 'vitest';
import {
  decisionSummaryText,
  parseContentKey,
  RELEASE_GRANTED_SUMMARY_KEY,
  RELEASE_REFUSED_SUMMARY_KEY,
} from '@ringside/engine';
import { renderTemplatedText } from '../renderTemplatedText';
import { CONTRACTS_TEXT_CATALOG } from './contracts';

const samples = [RELEASE_GRANTED_SUMMARY_KEY, RELEASE_REFUSED_SUMMARY_KEY].map((key) => ({
  key: parseContentKey(key),
  params: { name: 'Kai Rivers', reason: 'Champions are always kept' },
}));

describe('the contracts text catalog', () => {
  it('has a string for every contracts decision key', () => {
    expect(Object.keys(CONTRACTS_TEXT_CATALOG).sort()).toEqual(
      samples.map((sample) => sample.key).sort(),
    );
  });

  it.each(samples)('says $key the way the engine does', (sample) => {
    expect(renderTemplatedText(sample)).toBe(decisionSummaryText(sample));
  });
});
