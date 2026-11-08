/**
 * Commands: intent-based changes, validated and then either fully applied or rejected with reasons.
 *
 * A command says what someone wants ("set this tunable", later "book this segment"), never how to
 * change the world. It is declared once with {@link defineCommand}, added to a system bundle and
 * called through `engine.command(name, args, issuedBy)`. The engine runs it in three stages:
 *
 * 1. **Arguments** are parsed with the command's zod schema. Bad ones come back as `invalidArgs`
 *    reasons naming the field.
 * 2. **`validate`** reads the world and returns the reasons the command is not allowed. Any reason
 *    rejects the command before a transaction is opened, so nothing changes.
 * 3. **`apply`** runs as one pipeline step (SIM-08's `runStep`, source `{ kind: 'command' }`) with
 *    its own transaction, RNG snapshot and event and trace stagings. If it throws, everything it
 *    did is rolled back, the error goes to the failure log and the caller gets an `internal`
 *    reason.
 *
 * The same path will carry the computer's decisions, so there is one rule set for people and AI.
 * Every command names the controller that issued it and is written to the command log.
 */

import type { z } from 'zod';
import type { GameWorldView } from '../../model/tables';
import { RegistryError } from '../errors';
import type { PhaseContext } from '../pipeline/context';
import type { TunableRawValue } from '../tunables/define';
import type { Controller } from './controller';
import type { CommandArgs, CommandData, CommandName } from './maps';
import { API_NAME_PATTERN } from './query';
import type { Reason } from './result';

/**
 * Changes the save's tunable overrides as part of a command. The change follows the command: it
 * is undone if the command fails. Validate the value first (with `validateOverride`); `set` throws
 * for a value the tunable does not allow.
 */
export interface TunableOverrideWriter {
  /** Sets one override. Throws `InvalidArgumentError` for an unknown key or a value out of range. */
  set(key: string, value: TunableRawValue): void;
  /** Removes one override so the default applies again. Does nothing if the key is not overridden. */
  clear(key: string): void;
}

/** What a command's `apply` receives: a step context plus who issued the command. */
export interface CommandContext extends PhaseContext {
  /** The controller that issued the command (also passed to `apply` as its third argument). */
  readonly issuedBy: Controller;
  /** The save's tunable overrides, for the commands that change them. */
  readonly tunableOverrides: TunableOverrideWriter;
}

/** What a system writes to define a command. */
export interface CommandSpec<N extends CommandName> {
  /** Checks the arguments. Its output is what `validate` and `apply` receive. */
  readonly args: z.ZodType<CommandArgs<N>>;
  /**
   * The rules: every reason the command is not allowed right now, or an empty list. Reads only;
   * it runs before any transaction is opened. Reason messages are shown to the player.
   */
  validate?(read: GameWorldView, args: CommandArgs<N>, issuedBy: Controller): Reason[];
  /**
   * Makes the change through `ctx.tx`, publishes its events and records its traces. Returns plain
   * JSON (checked in debug builds). Synchronous. Throwing rolls everything back.
   */
  apply(ctx: CommandContext, args: CommandArgs<N>, issuedBy: Controller): CommandData<N>;
}

/** A checked, frozen command definition, ready to add to a system bundle. */
export interface CommandDefinition<N extends CommandName = CommandName> {
  readonly name: N;
  readonly args: z.ZodType<CommandArgs<N>>;
  /** Always present: a spec without `validate` allows everything its arguments allow. */
  validate(read: GameWorldView, args: CommandArgs<N>, issuedBy: Controller): Reason[];
  apply(ctx: CommandContext, args: CommandArgs<N>, issuedBy: Controller): CommandData<N>;
}

/**
 * Checks a command spec and returns a frozen definition. Throws {@link RegistryError} for a name
 * that is not dot-separated camelCase words.
 */
export function defineCommand<N extends CommandName>(
  name: N,
  spec: CommandSpec<N>,
): CommandDefinition<N> {
  if (!API_NAME_PATTERN.test(name)) {
    throw new RegistryError(
      `Command name ${JSON.stringify(name)} must look like "area.verb", for example "roster.release"`,
      { command: name },
    );
  }
  return Object.freeze({
    name,
    args: spec.args,
    validate: (read: GameWorldView, args: CommandArgs<N>, issuedBy: Controller) =>
      spec.validate?.(read, args, issuedBy) ?? [],
    apply: (ctx: CommandContext, args: CommandArgs<N>, issuedBy: Controller) =>
      spec.apply(ctx, args, issuedBy),
  });
}
