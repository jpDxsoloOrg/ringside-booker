// Shared fixtures for the production formula tests (ECO7-01). Design: docs/design/production.md
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import type { Production } from '../../../src/model/entities/promotion';
import { createEngineTunables, type EngineTunables } from '../../../src/systems/tunables';

/** Hardpan's production levels in the default world. */
export const HARDPAN: Production = Object.freeze({
  stage: 1,
  camera: 2,
  editing: 1,
  pyro: 0,
  music: 1,
  writing: 2,
  marketing: 1,
  backOffice: 1,
});

/** Altura's production levels in the default world. */
export const ALTURA: Production = Object.freeze({
  stage: 8,
  camera: 8,
  editing: 7,
  pyro: 8,
  music: 7,
  writing: 7,
  marketing: 8,
  backOffice: 7,
});

/** Every area at level 0. */
export const NOTHING: Production = Object.freeze({
  stage: 0,
  camera: 0,
  editing: 0,
  pyro: 0,
  music: 0,
  writing: 0,
  marketing: 0,
  backOffice: 0,
});

export function deps(overrides: TunableOverrides = {}): { tunables: EngineTunables } {
  return { tunables: createEngineTunables(overrides) };
}
