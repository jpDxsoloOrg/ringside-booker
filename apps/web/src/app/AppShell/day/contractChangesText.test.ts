import { describe, expect, it } from 'vitest';
import { parseGameDate, parseId } from '@ringside/engine';
import type { ContractChange, ContractChanges } from '@ringside/engine';
import { routes } from '../../routes';
import {
  contractChangeLines,
  contractChangesLink,
  contractChangesNeedBanner,
} from './contractChangesText';

const DATE = parseGameDate('2027-03-12');

function change(ringName: string, extra: Partial<ContractChange> = {}): ContractChange {
  return {
    employmentId: parseId('employment', 'emp_0000000001'),
    personId: parseId('person', 'per_0000000001'),
    ringName,
    date: DATE,
    ...extra,
  };
}

function changes(extra: Partial<ContractChanges> = {}): ContractChanges {
  return {
    started: [],
    expired: [],
    released: [],
    quit: [],
    requests: [],
    renewed: [],
    ...extra,
  };
}

describe('contract changes in the Next Day summary', () => {
  it('says each change in plain words, requests and walk-outs first', () => {
    expect(
      contractChangeLines(
        changes({
          expired: [change('The Blade')],
          quit: [change('Rook Calder', { how: 'walkedOut' })],
          requests: [change('Mara Quill')],
          renewed: [
            change('Big Joe', { line: "Big Joe's contract was renewed until Mar 12, 2028." }),
          ],
        }),
      ),
    ).toEqual([
      'Mara Quill wants to leave',
      'Rook Calder walked out',
      "The Blade's contract expired",
      "Big Joe's contract was renewed until Mar 12, 2028",
    ]);
  });

  it('earns the banner for an ending or a request, not for a quiet renewal', () => {
    expect(contractChangesNeedBanner(undefined)).toBe(false);
    expect(contractChangesNeedBanner(changes({ renewed: [change('Big Joe')] }))).toBe(false);
    expect(contractChangesNeedBanner(changes({ requests: [change('Mara Quill')] }))).toBe(true);
    expect(contractChangesNeedBanner(changes({ expired: [change('The Blade')] }))).toBe(true);
  });

  it('links "and N more" to Ended when something ended, else to Active', () => {
    expect(contractChangesLink(changes({ expired: [change('The Blade')] }))).toBe(
      `${routes.game.contracts()}?tab=ended`,
    );
    expect(contractChangesLink(changes({ requests: [change('Mara Quill')] }))).toBe(
      `${routes.game.contracts()}?tab=active`,
    );
  });
});
