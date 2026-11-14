// Shared worlds for the titles system tests (CRTV1-01). Design: docs/design/titles.md
import { addDays, type GameDate } from '../../../src/core/date';
import type { TitleId } from '../../../src/core/ids';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES, type GameWorld } from '../../../src/model/tables';
import type { ReignWriteContext } from '../../../src/systems/titles';
import { aTeam, TEST_START_DATE, worldBuilder, type BuiltWorld } from '../../support';

export const START: GameDate = TEST_START_DATE;
export const LATER: GameDate = addDays(TEST_START_DATE, 30);

/** Altura (prestige 80): 4 wrestlers, a vacant singles title, a held singles title and a tag title. */
export function titlesWorld(): BuiltWorld {
  return worldBuilder()
    .withGeography('mini')
    .withPromotion({ name: 'Altura Pro', prestige: 80 }, (promotion) =>
      promotion
        .withRoster(4)
        .withTitle({ name: 'Altura Championship' })
        .withTitle({ name: 'Altura Television Title' }, { holder: 0 })
        .withTitle({ name: 'Altura Tag Team Championship', holderCount: 2 }),
    )
    .with('a tag team of wrestlers 2 and 3', (context) => {
      const [, , third, fourth] = context.ids.people;
      if (third === undefined || fourth === undefined) {
        throw new Error('the roster has fewer than 4 people');
      }
      context.insert(
        'teams',
        aTeam({ name: 'The Night Shift', memberIds: [third, fourth] }, context.sequence),
      );
    })
    .build();
}

export function titleIdAt(built: BuiltWorld, index: number): TitleId {
  const id = built.ids.titles[index];
  if (id === undefined) {
    throw new Error(`no title at ${String(index)}`);
  }
  return id;
}

/** Runs `write` in one transaction on `date`, throwing what it throws. */
export function writeOn<T>(
  world: GameWorld,
  date: GameDate,
  write: (ctx: ReignWriteContext) => T,
): T {
  const result = world.transact('titles test write', (tx) => write({ date, tx, read: tx.view }));
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

/** The codes of every integrity problem in the world (empty when it is sound). */
export function integrityCodes(world: GameWorld): string[] {
  return checkWorld(world, TABLES).issues.map((issue) => issue.code);
}
