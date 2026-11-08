/**
 * Controllers: who runs a promotion or a brand (design decision D-07).
 *
 * A controller is a human player or the computer. Single-player is one human controller; hot-seat
 * brand wars and online play are more of them. Nothing in the model stores "the player": a query
 * that needs to know which promotion someone runs looks up the rows whose controller names them.
 *
 * This is the single definition of the type. The command and query API re-exports it rather than
 * declaring its own.
 */

import { z } from 'zod';
import { PLAYER_REF_TARGET, type RefSpec } from './table-def';
import { PLAYER_ID_MAX_LENGTH } from './world-meta';

/** Longest allowed player identifier, shared with `PlayerSchema.playerId` in world metadata. */
export { PLAYER_ID_MAX_LENGTH };

export const HumanControllerSchema = z.strictObject({
  kind: z.literal('human'),
  /** Opaque player identifier from `meta.players`. Not an entity ID. */
  playerId: z.string().min(1).max(PLAYER_ID_MAX_LENGTH),
});

export const ComputerControllerSchema = z.strictObject({
  kind: z.literal('computer'),
});

export const ControllerSchema = z.discriminatedUnion('kind', [
  HumanControllerSchema,
  ComputerControllerSchema,
]);

export type HumanController = z.infer<typeof HumanControllerSchema>;
export type ComputerController = z.infer<typeof ComputerControllerSchema>;
export type Controller = z.infer<typeof ControllerSchema>;
export type ControllerKind = Controller['kind'];

/**
 * The reference spec for a row's `controller.playerId`: a human controller must name a player
 * listed in `meta.players`. A computer controller (no `playerId`) and a null controller resolve to
 * nothing, so they pass.
 */
export const CONTROLLER_PLAYER_REF: RefSpec = {
  path: 'controller.playerId',
  target: PLAYER_REF_TARGET,
  nullable: false,
};
