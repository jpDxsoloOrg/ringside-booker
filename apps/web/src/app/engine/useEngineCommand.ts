import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommandArgs, CommandData, CommandName, CommandResult } from '@ringside/engine';
import { useEngineClient } from './EngineProvider';

export interface EngineCommandState<K extends CommandName> {
  /**
   * Issues the command for the local seat. Resolves with the engine's result, including a refusal
   * (`{ ok: false, reasons }`): game rules saying no is data, not an exception. Rejects only when
   * the engine could not be reached.
   */
  readonly run: (args: CommandArgs<K>) => Promise<CommandResult<CommandData<K>>>;
  /** True while a call is on its way. */
  readonly pending: boolean;
  /** The result of the latest call to finish, or null before the first. */
  readonly lastResult: CommandResult<CommandData<K>> | null;
}

/**
 * A command the component can issue. An applied command moves the world revision on, so every
 * mounted query refetches; a refused one changes nothing.
 */
export function useEngineCommand<K extends CommandName>(name: K): EngineCommandState<K> {
  const client = useEngineClient();
  const [pendingCount, setPendingCount] = useState(0);
  const [lastResult, setLastResult] = useState<CommandResult<CommandData<K>> | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (args: CommandArgs<K>): Promise<CommandResult<CommandData<K>>> => {
      setPendingCount((count) => count + 1);
      try {
        const { result } = await client.command(name, args);
        if (mounted.current) setLastResult(result);
        return result;
      } finally {
        if (mounted.current) setPendingCount((count) => count - 1);
      }
    },
    [client, name],
  );

  return { run, pending: pendingCount > 0, lastResult };
}
