/**
 * The draft through the host API (DRF-01/06/07): the wizard's previews, a draft-start new game and
 * the draft commands, all as JSON strings, the way the Unity game calls them.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createEmbeddedHost } from '../src/host';

const CONTENT_ROOT = fileURLToPath(new URL('../../../content', import.meta.url));

function readContent(): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.json')) {
        files[relative(CONTENT_ROOT, path).split(sep).join('/')] = JSON.parse(
          readFileSync(path, 'utf8'),
        );
      }
    }
  };
  walk(CONTENT_ROOT);
  return files;
}

/** The value at `path` inside parsed JSON, or undefined. */
function at(json: string, ...path: (string | number)[]): unknown {
  let value: unknown = JSON.parse(json);
  for (const key of path) {
    value = typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
  }
  return value;
}

describe('the draft through the host', () => {
  const host = createEmbeddedHost({ content: readContent() });

  it('previews the promotion picker and the draft for the wizard', () => {
    const page = host.previewPromotions('default-world', JSON.stringify({ limit: 3 }));
    expect(at(page, 'ok')).toBe(true);
    expect(at(page, 'value', 'total')).toBe(12);
    const setup = host.previewSetup(
      'default-world',
      JSON.stringify({
        activePromotionKeys: ['pro-ca'],
        playerPromotionKey: 'pro-flagship',
        settings: { draftStart: true },
      }),
    );
    expect(at(setup, 'ok')).toBe(true);
    expect(at(setup, 'value', 'promotions')).toEqual({ total: 12, active: 2, inactive: 10 });
    expect(at(setup, 'value', 'draft', 'promotions')).toBe(2);
    const bad = host.previewSetup('default-world', JSON.stringify({ nope: 1 }));
    expect(at(bad, 'ok')).toBe(false);
  });

  it('starts a draft game, drafts and finishes', () => {
    const created = host.newGame(
      JSON.stringify({
        rootPackId: 'default-world',
        seed: 'host-draft',
        playerName: 'Alex',
        saveName: 'Host draft',
        seasonLength: { preset: '6m' },
        player: { mode: 'existing', promotionKey: 'pro-flagship' },
        settings: { draftStart: true },
        activePromotionKeys: ['pro-ca', 'pro-au-indie'],
      }),
    );
    expect(at(created, 'ok')).toBe(true);
    // Queries and commands answer `{ revision, result: { ok, data } }`.
    expect(at(host.query('draft.state', '{}'), 'result', 'data', 'draft', 'promotions')).toBe(3);
    expect(at(host.command('draft.simToMyPick', '{}'), 'result', 'ok')).toBe(true);
    const pool = host.query('draft.pool', JSON.stringify({ limit: 1 }));
    const best = at(pool, 'result', 'data', 'rows', 0, 'personId');
    const pick = host.command('draft.pick', JSON.stringify({ personId: best }));
    expect(at(pick, 'result', 'ok')).toBe(true);
    expect(at(host.command('draft.autoPickRest', '{}'), 'result', 'ok')).toBe(true);
    const finish = host.command('draft.finish', '{}');
    expect(at(finish, 'result', 'data', 'status')).toBe('finished');
  });
});
