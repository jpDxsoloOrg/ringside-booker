// What the shipped default world airs in its opening weeks (ECO8-01), from the calendar's dated
// shows and, with the calendar's shows taken away, from the definitions' recurrence.
// Design: docs/design/broadcast.md#which-deal-airs-which-show.
import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, parseGameDate, type GameDate } from '../../../src/core/date';
import type { EngineState } from '../../../src/core/api';
import type { PromotionId } from '../../../src/core/ids';
import { TABLES, type GameWorldView } from '../../../src/model/tables';
import { documentToWorld } from '../../../src/persistence/world-document';
import { airingsDueOn } from '../../../src/systems/broadcast';
import { startDefaultGame } from '../calendar/default-game';

const START = parseGameDate('2027-01-04');
const SHOWCASE = parseGameDate('2027-01-31');

let state: EngineState;

beforeAll(() => {
  state = startDefaultGame();
});

function promotionNamed(prefix: string): PromotionId {
  const found = state.world.tables.promotions.find((row) => row.name.startsWith(prefix));
  if (found === undefined) {
    throw new Error(`No promotion named ${prefix}`);
  }
  return found.id;
}

function worldOf(withShows: boolean): GameWorldView {
  const tables = withShows
    ? state.world.tables
    : { ...state.world.tables, eventInstances: [], segments: [], participants: [] };
  return documentToWorld({ state: { world: { ...state.world, tables } } }, TABLES);
}

/** `<show> on <network> (<source>)` for each airing of the promotion due on `date`. */
function airings(read: GameWorldView, promotionId: PromotionId, date: GameDate): string[] {
  return airingsDueOn(read, date)
    .filter((due) => due.deal.promotionId === promotionId)
    .map((due) => {
      const show = due.source === 'instance' ? due.instance.name : due.definition.name;
      return `${show} on ${due.network.name} (${due.source})`;
    });
}

function week(read: GameWorldView, promotionId: PromotionId, from: GameDate): string[] {
  return Array.from({ length: 7 }, (_unused, offset) => addDays(from, offset)).flatMap((date) =>
    airings(read, promotionId, date).map((airing) => `${date}: ${airing}`),
  );
}

describe('the default world on air', () => {
  it("airs Altura's weekly shows on their networks in the opening week, from definitions", () => {
    expect(state.world.meta.startDate).toBe(START);
    const read = worldOf(false);
    const altura = promotionNamed('Altura');
    expect(week(read, altura, START)).toEqual([
      '2027-01-04: Altura Mainstage on National Signal Network (definition)',
      '2027-01-06: Altura Overclock on Kestrel Sports (definition)',
    ]);
    expect(airings(read, altura, SHOWCASE)).toEqual([
      'Altura Showcase on Turnstile Pay-Per-View (definition)',
    ]);
  });

  it('airs the same shows from the calendar once it has dated them', () => {
    const read = worldOf(true);
    const altura = promotionNamed('Altura');
    expect(week(read, altura, START)).toEqual([
      '2027-01-04: Altura Mainstage on National Signal Network (instance)',
      '2027-01-06: Altura Overclock on Kestrel Sports (instance)',
    ]);
    expect(airings(read, altura, SHOWCASE)).toEqual([
      'Altura Showcase on Turnstile Pay-Per-View (instance)',
    ]);
  });

  it('has nothing on air for Hardpan, which has no deal', () => {
    const hardpan = promotionNamed('Hardpan');
    for (const withShows of [false, true]) {
      const read = worldOf(withShows);
      expect(week(read, hardpan, START)).toEqual([]);
      expect(week(read, hardpan, addDays(START, 7))).toEqual([]);
    }
  });
});
