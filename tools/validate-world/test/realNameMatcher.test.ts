import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BlocklistError,
  COMMITTED_BLOCKLIST_PATH,
  findBlockedName,
  parseBlocklist,
  readBlocklistFile,
  type Blocklist,
} from '../src/blocklist';
import { matchesEntry, parseTermLine, textPattern, TermLineError } from '../src/realNameMatcher';
import { REPO_ROOT } from './helpers';

function testBlocklist(...lines: string[]): Blocklist {
  return { entries: parseBlocklist(lines.join('\n'), 'test-blocklist.txt') };
}

async function committedBlocklist(): Promise<Blocklist> {
  const entries = await readBlocklistFile(
    join(REPO_ROOT, COMMITTED_BLOCKLIST_PATH),
    COMMITTED_BLOCKLIST_PATH,
  );
  return { entries };
}

/** Every match of `term` in `text`, as written in the text. */
function textMatches(text: string, name: string, caseSensitive: boolean): string[] {
  return [...text.matchAll(textPattern({ name, caseSensitive }))].map((match) => match[0]);
}

describe('parseTermLine', () => {
  it('reads a plain name and a [case] name', () => {
    expect(parseTermLine('  Velvet Hammerlock  ')).toEqual({
      name: 'Velvet Hammerlock',
      caseSensitive: false,
    });
    expect(parseTermLine('Nightjar [case]')).toEqual({ name: 'Nightjar', caseSensitive: true });
    expect(parseTermLine('Nightjar [ case ]')).toEqual({ name: 'Nightjar', caseSensitive: true });
  });

  it('skips blank lines and comments', () => {
    expect(parseTermLine('   ')).toBeNull();
    expect(parseTermLine('# Nightjar [case]')).toBeNull();
  });

  it('rejects an unknown flag, a flag on its own and [case] on a longer name', () => {
    expect(() => parseTermLine('Nightjar [caps]')).toThrow(TermLineError);
    expect(() => parseTermLine('[case]')).toThrow(/needs a name/);
    expect(() => parseTermLine('Velvet Hammerlock [case]')).toThrow(/only for one-word names/);
  });
});

describe('a [case] entry in a name field', () => {
  const blocklist = testBlocklist('Nightjar [case]', 'GPG');

  it('matches the name as written or in capitals, with the usual one-word allowances', () => {
    for (const variant of [
      'Nightjar',
      'NIGHTJAR',
      'The Nightjar',
      'the Nightjar',
      'Nightjar 40',
      'Nightjar XX',
      'Níghtjar',
      'Night-jar',
      'N.I.G.H.T.J.A.R.',
    ]) {
      expect(findBlockedName(variant, blocklist)?.name, variant).toBe('Nightjar');
    }
  });

  it('does not match other capitalisations or a longer name', () => {
    for (const variant of ['nightjar', 'the nightjar', 'NightJar', 'Nightjar Arena', 'Nightjars']) {
      expect(findBlockedName(variant, blocklist), variant).toBeNull();
    }
  });

  it('keeps the entry name without its flag for messages', () => {
    const [entry] = blocklist.entries;
    expect(entry).toMatchObject({ name: 'Nightjar', caseSensitive: true, line: 1 });
  });

  it('leaves plain entries matching whatever their case', () => {
    const plain = testBlocklist('Nightjar', 'Velvet Hammerlock');
    expect(findBlockedName('nightjar', plain)?.name).toBe('Nightjar');
    expect(findBlockedName('the velvet hammerlock show', plain)?.name).toBe('Velvet Hammerlock');
  });

  it('reports an unusable flag with the file and line', () => {
    expect(() => testBlocklist('Velvet Hammerlock', 'Gravel Pit [case]')).toThrow(BlocklistError);
    expect(() => testBlocklist('Velvet Hammerlock', 'Gravel Pit [case]')).toThrow(
      'test-blocklist.txt:2: "Gravel Pit [case]": [case] is only for one-word names',
    );
    expect(() => testBlocklist('Nightjar [nocase]')).toThrow(
      'test-blocklist.txt:1: "Nightjar [nocase]": unknown flag',
    );
  });
});

describe('textPattern', () => {
  it('finds a plain name as whole words whatever its case, across a line break', () => {
    expect(
      textMatches(
        'Velvet Hammerlock, velvet\nhammerlock, VelvetHammerlocks',
        'Velvet Hammerlock',
        false,
      ),
    ).toEqual(['Velvet Hammerlock', 'velvet\nhammerlock']);
  });

  it('finds a [case] name only as written or in capitals', () => {
    expect(
      textMatches('Nightjar, NIGHTJAR, nightjar, NightJar, Nightjars', 'Nightjar', true),
    ).toEqual(['Nightjar', 'NIGHTJAR']);
  });
});

describe('the committed list', () => {
  it('flags the capitalised name but not the everyday word', async () => {
    const blocklist = await committedBlocklist();
    expect(findBlockedName('Sting', blocklist)?.name).toBe('Sting');
    expect(findBlockedName('STING', blocklist)?.name).toBe('Sting');
    expect(findBlockedName('sting', blocklist)).toBeNull();
    expect(findBlockedName('Edge', blocklist)?.name).toBe('Edge');
    expect(findBlockedName('edge', blocklist)).toBeNull();
    expect(findBlockedName('Stardom', blocklist)?.name).toBe('Stardom');
    expect(findBlockedName('stardom', blocklist)).toBeNull();
  });

  it('still blocks every entry written the way the list writes it, in a field and in text', async () => {
    const { entries } = await committedBlocklist();
    for (const entry of entries) {
      expect(matchesEntry(entry.name, entry), entry.name).toBe(true);
      expect(matchesEntry(entry.name.toUpperCase(), entry), entry.name).toBe(true);
      expect(textPattern(entry).test(`Last night ${entry.name} wrestled.`), entry.name).toBe(true);
    }
  });

  it('agrees between fields and text on every [case] entry written in lower case', async () => {
    const { entries } = await committedBlocklist();
    const flagged = entries.filter((entry) => entry.caseSensitive);
    expect(flagged.length).toBeGreaterThan(0);
    for (const entry of flagged) {
      const lower = entry.name.toLowerCase();
      expect(matchesEntry(lower, entry), entry.name).toBe(false);
      expect(textPattern(entry).test(`a ${lower} in the night`), entry.name).toBe(false);
    }
  });
});
