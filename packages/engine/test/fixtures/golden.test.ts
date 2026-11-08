/**
 * Golden fixtures: the serialised form of the canned worlds, kept in files next to this test.
 *
 * A schema or builder change that alters a fixture fails here until the file is regenerated on
 * purpose with `npm run fixtures:write -w @ringside/engine`, so the change shows up in review.
 * Before the save format is frozen that churn is expected; after it, it means a migration is due.
 */

import { describe, expect, it } from 'vitest';
import { serialiseSaveDocument } from '../../src/persistence/codec';
import { tinySaveDocument } from '../support/saves';
import { serialiseWorld } from '../support/serialise';
import { tinyWorld } from '../support/worlds';

describe('golden fixtures', () => {
  it('tinyWorld matches worlds/tiny-world.json', async () => {
    await expect(serialiseWorld(tinyWorld().world)).toMatchFileSnapshot('./worlds/tiny-world.json');
  });

  // The current-version save of tinyWorld. While format v1 is unfrozen this is regenerated with
  // the world fixture. Once a format version is frozen its fixture is frozen too: the next version
  // gets its own file here, and the old one stays to test the migration from it.
  it('a v1 save of tinyWorld matches saves/v1-tiny.json', async () => {
    await expect(`${serialiseSaveDocument(tinySaveDocument(), 2)}\n`).toMatchFileSnapshot(
      './saves/v1-tiny.json',
    );
  });
});
