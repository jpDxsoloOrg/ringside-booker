// Roles a worker will not take (ECO5-03). Design: docs/design/negotiation.md#reaction
import { describe, expect, it } from 'vitest';
import { neverWorkedAs, roleMismatch, WANTS_TO_WRESTLE } from '../../../src/systems/negotiation';
import { overallOf } from '../../../src/systems/workers/formulas/roleRating';
import { createEngineTunables } from '../../../src/systems/tunables';
import { aPerson } from '../../support';

const tunables = createEngineTunables();

describe('roleMismatch', () => {
  it('keeps a good wrestler in the ring', () => {
    const wrestler = aPerson({ roles: ['wrestler', 'referee'] });
    const rating = overallOf(wrestler, 'wrestler', { tunables }).value;
    const line = createEngineTunables({ 'contracts.react.refuseCrewRoleRating': rating });
    expect(roleMismatch(wrestler, 'referee', { tunables: line })).toBe(WANTS_TO_WRESTLE);
    expect(roleMismatch(wrestler, 'wrestler', { tunables: line })).toBeNull();
    const above = createEngineTunables({ 'contracts.react.refuseCrewRoleRating': rating + 1 });
    expect(roleMismatch(wrestler, 'referee', { tunables: above })).toBeNull();
  });

  it('refuses a job they have never done, counting an occasional wrestler as a wrestler', () => {
    const referee = aPerson({ roles: ['referee', 'occasionalWrestler'] });
    expect(roleMismatch(referee, 'announcer', { tunables })).toBe(
      'Has never worked as an announcer',
    );
    expect(roleMismatch(referee, 'wrestler', { tunables })).toBeNull();
    expect(roleMismatch(referee, 'referee', { tunables })).toBeNull();
    expect(neverWorkedAs('referee')).toBe('Has never worked as a referee');
  });

  it('lets anyone be offered the booker job, which is not a role people hold', () => {
    const referee = aPerson({ roles: ['referee', 'occasionalWrestler'] });
    expect(roleMismatch(referee, 'booker', { tunables })).toBeNull();
  });
});
