import { useState } from 'react';
import type { StorylineDetail } from '@ringside/engine';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { Button } from '@/components/Button';
import { Panel } from '@/components/Panel';
import { TextField } from '@/components/TextField';
import { reasonsText } from './storylineText';
import styles from './SetHeatControl.module.css';

export const SET_HEAT_HINT =
  'Sandbox games only: put this story at any heat from 0 to 100 to try the warm and hot steps. It does not count as progress.';

/** Whole numbers from 0 to 100, or null for anything else. */
export function parseHeat(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const heat = Number(text.trim());
  return heat <= 100 ? heat : null;
}

/**
 * A Sandbox game's test aid on the storyline page (CRTV4-05): a number field and "Set heat". The
 * page shows it only in a Sandbox game, and the engine refuses `storylines.setHeat` anywhere else.
 */
export function SetHeatControl({ storyline }: { readonly storyline: StorylineDetail }) {
  const setHeat = useEngineCommand('storylines.setHeat');
  const [text, setText] = useState(String(Math.round(storyline.heat ?? 0)));
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const submit = async (): Promise<void> => {
    const heat = parseHeat(text);
    if (heat === null) {
      setProblem('Enter a whole number from 0 to 100.');
      return;
    }
    const result = await setHeat.run({ storylineId: storyline.id, heat });
    setProblem(result.ok ? undefined : reasonsText(result.reasons));
  };
  return (
    <Panel title="Sandbox">
      <form
        className={styles['form']}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <TextField
          label="New heat"
          value={text}
          onValueChange={setText}
          inputMode="numeric"
          hint={SET_HEAT_HINT}
          error={problem}
          className={styles['field']}
        />
        <Button type="submit" loading={setHeat.pending}>
          Set heat
        </Button>
      </form>
    </Panel>
  );
}
