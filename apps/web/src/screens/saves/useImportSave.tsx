import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';
import type { InspectReport } from '@ringside/engine';
import { useOptionalEngineClient } from '@/app/engine/EngineProvider';
import { SAVE_FILE_EXTENSION } from '@/storage';
import type { ImportResult, InspectSave } from '@/storage';
import styles from './SaveSlotsScreen.module.css';

export interface ImportSave {
  /** The hidden file input. Render it once; both Import buttons open it. */
  readonly fileInput: ReactElement;
  /** Opens the file picker. Call it straight from a click, which browsers require. */
  readonly openPicker: () => void;
  /** True while a chosen file is being checked and stored. */
  readonly importing: boolean;
}

/** The engine worker's `inspectSave`, for `importSaveFile`. Rejects when there is no engine. */
function useInspectSave(): InspectSave {
  const client = useOptionalEngineClient();
  return useCallback(
    async (bytes: Uint8Array): Promise<InspectReport> => {
      if (client === null) throw new Error('The game engine is not running.');
      return client.inspectSave(bytes);
    },
    [client],
  );
}

/**
 * The `.rbsave` import flow: a hidden file input (`accept=".rbsave"`, which phones open as their
 * file picker), checked by the engine worker's `inspectSave` and stored as a new slot by
 * `runImport`. `onResult` hears how it went.
 */
export function useImportSave(
  runImport: (file: File, inspect: InspectSave) => Promise<ImportResult>,
  onResult: (result: ImportResult) => void,
): ImportSave {
  const inputRef = useRef<HTMLInputElement>(null);
  const inspect = useInspectSave();
  const [importing, setImporting] = useState(false);
  // An import that settles after the screen unmounted is not reported and leaves its state alone:
  // both would set state on an unmounted screen.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Cleared at once, so choosing the same file again still fires a change.
    input.value = '';
    if (file === undefined) return;
    setImporting(true);
    try {
      const result = await runImport(file, inspect);
      if (mounted.current) onResult(result);
    } finally {
      if (mounted.current) setImporting(false);
    }
  };

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={SAVE_FILE_EXTENSION}
      className={styles['fileInput']}
      aria-label="Save file to import"
      aria-hidden="true"
      tabIndex={-1}
      data-testid="import-save-input"
      onChange={(event) => {
        void handleChange(event);
      }}
    />
  );

  const openPicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  return { fileInput, openPicker, importing };
}
