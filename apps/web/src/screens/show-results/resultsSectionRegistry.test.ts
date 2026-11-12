import { afterEach, describe, expect, it } from 'vitest';
import { listResultsSections, registerResultsSection } from './resultsSectionRegistry';
import type { ResultsSectionDefinition } from './resultsSectionRegistry';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function section(id: string, order: number): ResultsSectionDefinition {
  return { id, label: id, order, render: () => id };
}

describe('registerResultsSection', () => {
  it('lists sections by order, then by id, and removes one again', () => {
    cleanups.push(
      registerResultsSection(section('test.money', 30)),
      registerResultsSection(section('test.popularity', 10)),
      registerResultsSection(section('test.flow', 30)),
    );
    const removeLast = registerResultsSection(section('test.awards', 40));
    expect(listResultsSections().map((entry) => entry.id)).toEqual([
      'test.popularity',
      'test.flow',
      'test.money',
      'test.awards',
    ]);
    removeLast();
    expect(listResultsSections().map((entry) => entry.id)).not.toContain('test.awards');
  });

  it('throws for an id that is taken', () => {
    cleanups.push(registerResultsSection(section('test.duplicate', 10)));
    expect(() => registerResultsSection(section('test.duplicate', 20))).toThrow(
      'A results section with id "test.duplicate" is already registered.',
    );
  });
});
