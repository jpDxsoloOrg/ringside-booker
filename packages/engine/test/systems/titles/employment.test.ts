// Working for a title's promotion (CRTV1-01). Design: docs/design/titles.md#holders
import { describe, expect, it } from 'vitest';
import type { PersonId } from '../../../src/core/ids';
import {
  employedForTitle,
  lastEmployedForTitleOn,
  ringNameForTitle,
} from '../../../src/systems/titles';
import { worldBuilder } from '../../support';
import { LATER, START, writeOn } from './titles-world';

/** Altura (2 wrestlers) and Altura Next, its developmental promotion (1 wrestler). */
function parentWorld() {
  const built = worldBuilder()
    .withGeography('mini')
    .withPromotion({ name: 'Altura Pro' }, (promotion) => promotion.withRoster(2))
    .withPromotion({ name: 'Altura Next' }, (promotion) => promotion.withRoster(1))
    .build();
  const parent = built.ids.promotions.A;
  const child = built.ids.promotions.B;
  if (parent === undefined || child === undefined) {
    throw new Error('missing promotions');
  }
  writeOn(built.world, START, (ctx) =>
    ctx.tx.update('promotions', child, { parentPromotionId: parent }),
  );
  return { ...built, parent, child };
}

function personAt(ids: readonly PersonId[], index: number): PersonId {
  const id = ids[index];
  if (id === undefined) {
    throw new Error('no person');
  }
  return id;
}

describe('employment for a title', () => {
  it("counts a parent promotion's workers for a developmental title, not the other way round", () => {
    const { world, ids, parent, child } = parentWorld();
    const mainRoster = personAt(ids.people, 0);
    const devRoster = personAt(ids.people, 2);
    expect(employedForTitle(world, mainRoster, child, START)).toBe(true);
    expect(employedForTitle(world, devRoster, child, START)).toBe(true);
    expect(employedForTitle(world, devRoster, parent, START)).toBe(false);
  });

  it('uses the ring name with the promotion while employed, else the default', () => {
    const { world, ids, parent } = parentWorld();
    const person = personAt(ids.people, 0);
    expect(ringNameForTitle(world, person, parent, START)).toBe(
      world.tables.employments.lookup('byPerson', person)[0]?.ringName,
    );
  });

  it('finds the last day someone worked for the promotion', () => {
    const { world, ids, parent, child } = parentWorld();
    const person = personAt(ids.people, 1);
    expect(lastEmployedForTitleOn(world, person, child)).toBeNull();
    const [, employmentId] = ids.employments;
    if (employmentId === undefined) {
      throw new Error('no employment');
    }
    writeOn(world, LATER, (ctx) =>
      ctx.tx.update('employments', employmentId, { status: 'released', endedOn: LATER }),
    );
    expect(employedForTitle(world, person, parent, LATER)).toBe(false);
    expect(lastEmployedForTitleOn(world, person, parent)).toBe(LATER);
    expect(lastEmployedForTitleOn(world, person, child)).toBe(LATER);
  });
});
