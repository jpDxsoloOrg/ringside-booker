// The hidden learning gate (MTCH4-03). Design: docs/design/physical-toll.md#ring-learning
import { describe, expect, it } from 'vitest';
import type { DeepPartial } from '../../../support/builders/build-row';
import type { Person } from '../../../../src/model/entities/person';
import { learningRoom } from '../../../../src/systems/match/physical/learningRoom';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { worldBuilder } from '../../../support/world-builder';

const TUNABLES = createEngineTunables();

/** One person built through `worldBuilder()`, with ring work 60 unless told otherwise. */
function personWith(overrides: DeepPartial<Person>): Person {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withPromotion({}, (promotion) =>
      promotion.withRoster(1, {
        person: () => ({ attributes: { ringwork: 60 }, ...overrides }),
      }),
    )
    .build();
  const id = ids.people[0];
  if (id === undefined) throw new Error('no person');
  return world.tables.people.require(id);
}

describe('learningRoom', () => {
  it('is open with high potential and plenty of room under the ceiling', () => {
    const person = personWith({ development: { potential: 600, ceilings: { ringwork: 80 } } });
    expect(learningRoom(person, 'ringwork', TUNABLES)).toBe('open');
  });

  it('is slowing within slowingBand of the ceiling', () => {
    const person = personWith({ development: { potential: 600, ceilings: { ringwork: 65 } } });
    expect(learningRoom(person, 'ringwork', TUNABLES)).toBe('slowing');
    const justOutside = personWith({
      development: { potential: 600, ceilings: { ringwork: 65.5 } },
    });
    expect(learningRoom(justOutside, 'ringwork', TUNABLES)).toBe('open');
  });

  it('is slowing with potential below lowPotential', () => {
    const person = personWith({ development: { potential: 199, ceilings: { ringwork: 90 } } });
    expect(learningRoom(person, 'ringwork', TUNABLES)).toBe('slowing');
  });

  it('is closed at or above the ceiling', () => {
    const at = personWith({ development: { potential: 600, ceilings: { ringwork: 60 } } });
    expect(learningRoom(at, 'ringwork', TUNABLES)).toBe('closed');
    const above = personWith({ development: { potential: 600, ceilings: { ringwork: 55 } } });
    expect(learningRoom(above, 'ringwork', TUNABLES)).toBe('closed');
  });

  it('is closed with negative potential, whatever the ceiling', () => {
    const person = personWith({ development: { potential: -1, ceilings: { ringwork: 95 } } });
    expect(learningRoom(person, 'ringwork', TUNABLES)).toBe('closed');
  });

  it('gates on potential alone when the attribute has no ceiling', () => {
    const open = personWith({ development: { potential: 600, ceilings: {} } });
    expect(learningRoom(open, 'stamina', TUNABLES)).toBe('open');
    const slowing = personWith({ development: { potential: 100, ceilings: {} } });
    expect(learningRoom(slowing, 'stamina', TUNABLES)).toBe('slowing');
    const closed = personWith({ development: { potential: -400, ceilings: {} } });
    expect(learningRoom(closed, 'stamina', TUNABLES)).toBe('closed');
  });

  it('follows the tunables', () => {
    const person = personWith({ development: { potential: 600, ceilings: { ringwork: 70 } } });
    const wide = createEngineTunables({ 'match.learning.slowingBand': 10 });
    expect(learningRoom(person, 'ringwork', wide)).toBe('slowing');
    const high = createEngineTunables({ 'match.learning.lowPotential': 700 });
    expect(learningRoom(person, 'ringwork', high)).toBe('slowing');
  });
});
