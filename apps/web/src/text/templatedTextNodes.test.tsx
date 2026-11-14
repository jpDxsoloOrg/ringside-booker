import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NO_LONGER_IN_RECORDS } from '@ringside/engine';
import type { EntityLinkRenderer } from '@/components/Trace/rows/rowTypes';
import { registerTextCatalog } from './catalog';
import {
  MISSING_TEXT,
  ordinalText,
  renderTemplatedText,
  templatedTextToString,
} from './renderTemplatedText';
import type { TextNames, TextParams } from './renderTemplatedText';

const NAMES: TextNames = {
  per_0000000001: { kind: 'person', name: 'Kai Rivers' },
  per_0000000002: { kind: 'person', name: 'Nova Steele' },
  per_0000000003: { kind: 'person', name: 'Dex Marlow' },
  ttl_0000000001: { kind: 'title', name: 'Test Heavyweight Title' },
};

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function withCatalog(): void {
  cleanups.push(
    registerTextCatalog('richtext', {
      'richtext.names': '{who} won the {title}',
      'richtext.date': 'On {day:date}',
      'richtext.count': '{crowd:count} fans',
      'richtext.ordinal': 'The {place:ordinal} reign',
      'richtext.money': 'A purse of {purse:money}',
      'richtext.plain': '{word} and {missing}',
      'richtext.fn': (params) => (Number(params['n']) === 1 ? '{n:count} year' : '{n:count} years'),
    }),
  );
}

function text(key: string, params: TextParams) {
  return { key, params };
}

function asString(key: string, params: TextParams): string {
  return templatedTextToString(text(key, params), { names: NAMES });
}

describe('templatedTextToString', () => {
  it('writes each format', () => {
    withCatalog();
    expect(asString('richtext.date', { day: '2026-01-05' })).toBe('On Monday, January 5, 2026');
    expect(asString('richtext.count', { crowd: 12500 })).toBe('12,500 fans');
    expect(asString('richtext.ordinal', { place: 1 })).toBe('The 1st reign');
    expect(asString('richtext.money', { purse: 1_200_000 })).toBe('A purse of $12,000');
    expect(asString('richtext.fn', { n: 1 })).toBe('1 year');
    expect(asString('richtext.fn', { n: 3 })).toBe('3 years');
  });

  it('joins one, two and three names', () => {
    withCatalog();
    const title = 'ttl_0000000001';
    expect(asString('richtext.names', { who: 'per_0000000001', title })).toBe(
      'Kai Rivers won the Test Heavyweight Title',
    );
    expect(asString('richtext.names', { who: 'per_0000000001,per_0000000002', title })).toBe(
      'Kai Rivers and Nova Steele won the Test Heavyweight Title',
    );
    expect(
      asString('richtext.names', { who: 'per_0000000001,per_0000000002,per_0000000003', title }),
    ).toBe('Kai Rivers, Nova Steele and Dex Marlow won the Test Heavyweight Title');
  });

  it('names an unknown id as gone, and leaves plain words and missing params as written', () => {
    withCatalog();
    expect(asString('richtext.names', { who: 'per_0000000099', title: 'ttl_0000000001' })).toBe(
      `${NO_LONGER_IN_RECORDS} won the Test Heavyweight Title`,
    );
    expect(asString('richtext.plain', { word: 'Hello, world' })).toBe('Hello, world and {missing}');
    expect(asString('richtext.date', { day: 'someday' })).toBe('On someday');
  });

  it('says a key no catalog knows is missing', () => {
    expect(asString('richtext.nothing', {})).toBe(MISSING_TEXT);
  });

  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinalText)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '101st',
      '111th',
    ]);
  });
});

describe('renderTemplatedText with names', () => {
  const linked: EntityLinkRenderer = (ref, label) => (
    <a href={`#${ref.kind}-${ref.id}`}>{label}</a>
  );

  it('draws names through a custom renderEntityLink, but not unknown ids', () => {
    withCatalog();
    render(
      <p data-testid="line">
        {renderTemplatedText(
          text('richtext.names', {
            who: 'per_0000000001,per_0000000002,per_0000000099',
            title: 'ttl_0000000001',
          }),
          { names: NAMES, renderEntityLink: linked },
        )}
      </p>,
    );
    expect(screen.getByTestId('line')).toHaveTextContent(
      `Kai Rivers, Nova Steele and ${NO_LONGER_IN_RECORDS} won the Test Heavyweight Title`,
    );
    expect(screen.getByRole('link', { name: 'Kai Rivers' })).toHaveAttribute(
      'href',
      '#person-per_0000000001',
    );
    expect(screen.getByRole('link', { name: 'Test Heavyweight Title' })).toHaveAttribute(
      'href',
      '#title-ttl_0000000001',
    );
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('draws plain names without a renderer', () => {
    withCatalog();
    render(
      <p data-testid="line">
        {renderTemplatedText(text('richtext.names', { who: 'per_0000000002', title: 'x' }), {
          names: NAMES,
        })}
      </p>,
    );
    expect(screen.getByTestId('line')).toHaveTextContent('Nova Steele won the x');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('marks a missing key', () => {
    render(<p>{renderTemplatedText(text('richtext.gone', {}), { names: NAMES })}</p>);
    expect(screen.getByText(MISSING_TEXT)).toHaveAttribute('data-missing-key', 'richtext.gone');
  });
});
