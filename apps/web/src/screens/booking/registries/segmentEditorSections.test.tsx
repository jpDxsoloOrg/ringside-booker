import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  registeredSegmentEditorSections,
  registerSegmentEditorSection,
  sectionsFor,
  useSegmentEditorSections,
} from './segmentEditorSections';
import type {
  SegmentEditorSectionAppliesTo,
  SegmentEditorSectionDefinition,
} from './segmentEditorSections';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function section(
  id: string,
  order: number,
  appliesTo: SegmentEditorSectionAppliesTo = 'both',
): SegmentEditorSectionDefinition {
  return { id, order, appliesTo, title: id, render: () => id };
}

function SectionIds({ kind }: { readonly kind: 'match' | 'angle' }) {
  const sections = useSegmentEditorSections(kind);
  return <p>{sections.map((entry) => entry.id).join(',') || 'none'}</p>;
}

describe('registerSegmentEditorSection', () => {
  it('adds a section and returns a function that removes it', () => {
    const remove = registerSegmentEditorSection(section('test.finish', 10));
    expect(registeredSegmentEditorSections().map((entry) => entry.id)).toEqual(['test.finish']);
    remove();
    expect(registeredSegmentEditorSections()).toEqual([]);
  });

  it('throws for an id that is taken', () => {
    cleanups.push(registerSegmentEditorSection(section('test.crew', 10)));
    expect(() => registerSegmentEditorSection(section('test.crew', 20))).toThrow(
      'A segment editor section with id "test.crew" is already registered.',
    );
  });

  it('orders by order, then by id, and keeps only the kind asked for', () => {
    const list = [
      section('test.zeta', 10),
      section('test.beats', 5, 'angle'),
      section('test.alpha', 10, 'match'),
      section('test.first', 1),
    ];
    expect(sectionsFor(list, 'match').map((entry) => entry.id)).toEqual([
      'test.first',
      'test.alpha',
      'test.zeta',
    ]);
    expect(sectionsFor(list, 'angle').map((entry) => entry.id)).toEqual([
      'test.first',
      'test.beats',
      'test.zeta',
    ]);
  });

  it('keeps every open editor current', () => {
    cleanups.push(registerSegmentEditorSection(section('test.second', 20, 'match')));
    render(<SectionIds kind="match" />);
    expect(screen.getByText('test.second')).toBeInTheDocument();

    let removeFirst: () => void = () => undefined;
    act(() => {
      removeFirst = registerSegmentEditorSection(section('test.first', 10));
    });
    expect(screen.getByText('test.first,test.second')).toBeInTheDocument();

    act(() => {
      removeFirst();
    });
    expect(screen.getByText('test.second')).toBeInTheDocument();
  });
});
