import { describe, expect, it } from 'vitest';
import { parseGameDate } from '../../src/core/date';
import { WorldMetaSchema, type WorldMeta } from '../../src/model/world-meta';
import { toyMeta } from '../support/toy-registry';

function withSeasonLength(lengthDays: number): WorldMeta {
  const meta = toyMeta();
  return { ...meta, settings: { ...meta.settings, season: { lengthDays } } };
}

describe('WorldMetaSchema', () => {
  it('accepts valid metadata', () => {
    expect(WorldMetaSchema.safeParse(toyMeta()).success).toBe(true);
  });

  it('accepts season lengths from 28 to 730 days', () => {
    expect(WorldMetaSchema.safeParse(withSeasonLength(28)).success).toBe(true);
    expect(WorldMetaSchema.safeParse(withSeasonLength(730)).success).toBe(true);
  });

  it('rejects season lengths outside 28..730 and fractional lengths', () => {
    expect(WorldMetaSchema.safeParse(withSeasonLength(27)).success).toBe(false);
    expect(WorldMetaSchema.safeParse(withSeasonLength(731)).success).toBe(false);
    expect(WorldMetaSchema.safeParse(withSeasonLength(91.5)).success).toBe(false);
  });

  it('rejects settings without levelPlayingField', () => {
    const { agingEnabled, sandbox, generationLevel, season, extra } = toyMeta().settings;
    const settings = { agingEnabled, sandbox, generationLevel, season, extra };
    expect(WorldMetaSchema.safeParse({ ...toyMeta(), settings }).success).toBe(false);
  });

  it('rejects a currentDate before the startDate', () => {
    const result = WorldMetaSchema.safeParse(
      toyMeta({
        startDate: parseGameDate('2026-03-01'),
        currentDate: parseGameDate('2026-02-28'),
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['currentDate']);
  });

  it('accepts a currentDate equal to or after the startDate', () => {
    const later = toyMeta({ currentDate: parseGameDate('2027-06-15'), daysSimulated: 530 });
    expect(WorldMetaSchema.safeParse(later).success).toBe(true);
  });

  it('rejects duplicate playerIds', () => {
    const meta = toyMeta({
      players: [
        { playerId: 'player-1', displayName: 'One' },
        { playerId: 'player-1', displayName: 'Also one' },
      ],
    });
    expect(WorldMetaSchema.safeParse(meta).success).toBe(false);
  });

  it('accepts several distinct players and no players at all', () => {
    const twoPlayers = toyMeta({
      players: [
        { playerId: 'player-1', displayName: 'One' },
        { playerId: 'player-2', displayName: 'Two' },
      ],
    });
    expect(WorldMetaSchema.safeParse(twoPlayers).success).toBe(true);
    expect(WorldMetaSchema.safeParse(toyMeta({ players: [] })).success).toBe(true);
  });

  it('checks the length of names and the seed', () => {
    expect(WorldMetaSchema.safeParse(toyMeta({ worldName: '' })).success).toBe(false);
    expect(WorldMetaSchema.safeParse(toyMeta({ worldName: 'x'.repeat(81) })).success).toBe(false);
    expect(WorldMetaSchema.safeParse(toyMeta({ seed: '' })).success).toBe(false);
    expect(WorldMetaSchema.safeParse(toyMeta({ seed: 's'.repeat(65) })).success).toBe(false);
    const longDisplayName = toyMeta({ players: [{ playerId: 'p', displayName: 'n'.repeat(41) }] });
    expect(WorldMetaSchema.safeParse(longDisplayName).success).toBe(false);
  });

  it('rejects a negative or fractional daysSimulated', () => {
    expect(WorldMetaSchema.safeParse(toyMeta({ daysSimulated: -1 })).success).toBe(false);
    expect(WorldMetaSchema.safeParse(toyMeta({ daysSimulated: 1.5 })).success).toBe(false);
  });

  it('accepts extra settings of the three allowed value types only', () => {
    const meta = toyMeta();
    const withExtras = {
      ...meta,
      settings: { ...meta.settings, extra: { 'draft.enabled': true, 'brandWars.weeks': 12 } },
    };
    expect(WorldMetaSchema.safeParse(withExtras).success).toBe(true);
    const withObject = {
      ...meta,
      settings: { ...meta.settings, extra: { nested: { value: 1 } } },
    };
    expect(WorldMetaSchema.safeParse(withObject).success).toBe(false);
  });

  it('requires contentKeys values to be entity IDs', () => {
    const valid = toyMeta({ contentKeys: { base: { 'worker.ace': 'per_0000000001' } } });
    expect(WorldMetaSchema.safeParse(valid).success).toBe(true);
    const invalid = toyMeta({ contentKeys: { base: { 'worker.ace': 'ace' } } });
    expect(WorldMetaSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects unknown fields so typos in a save are caught', () => {
    expect(WorldMetaSchema.safeParse({ ...toyMeta(), playerPromotionId: 'pro_x' }).success).toBe(
      false,
    );
  });
});
